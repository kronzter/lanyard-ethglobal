// A4.3 coordinator console: make or unmake a lead by writing the bound lanyard.perms envelope.
import { useState } from "react";
import { Text, View } from "react-native";
import { sepolia } from "viem/chains";
import { type Address } from "viem";
import { setTextData } from "@/consoles/calldata";
import { bookRegistry } from "@/consoles/observe";
import { Btn, ConsoleFrame, Field, Log, useRunner } from "@/consoles/ui";
import { useConsole } from "@/consoles/useConsole";
import { bindingChanged, decidePerms, parsePermsArgs } from "@/ens/perms-plan";
import { readRegistration, registryReadAbi } from "@/ens/registry-read";
import { PERMS_TEXT_KEY } from "@/shared/ens/permission-envelope";
import { eventConfig } from "@/shared/event.config";
import { toFullName } from "@/shared/labels";
import { styles } from "@/shell/styles";

export default function Coordinator() {
  const c = useConsole();
  const { busy, log, run } = useRunner();
  const [label, setLabel] = useState("");

  const act = (make: boolean) =>
    run(`${make ? "make" : "unmake"} lead ${label}.volunteers`, async () => {
      const { pc, live } = c;
      if (!pc || !live) throw new Error(c.problem ?? "not ready");
      const req = parsePermsArgs(["--volunteer", label, make ? "--make" : "--unmake"]);
      const registry = await bookRegistry(pc, live, "volunteers");
      const name = toFullName(`${req.label}.volunteers`, eventConfig);
      const read = () => readRegistration(pc, { chainId: sepolia.id, registry, label: req.label });
      const before = await read();
      const [resolver, current] = await Promise.all([
        pc.readContract({
          address: registry,
          abi: registryReadAbi,
          functionName: "getResolver",
          args: [req.label],
        }) as Promise<Address>,
        pc.getEnsText({ name, key: PERMS_TEXT_KEY, universalResolverAddress: live.universalResolver }),
      ]);
      const d = decidePerms({
        binding: before,
        make,
        resolver,
        staffResolver: live.staffResolver,
        current,
      });
      if (d.action === "blocked") throw new Error(d.reason);
      if (d.action === "skip") return "nothing to do: already in that state";
      const tx = await c.send({
        to: live.staffResolver,
        data: setTextData(name, PERMS_TEXT_KEY, d.value),
        what: "setText lanyard.perms",
        authority: { kind: "coordinator" },
      });
      if (bindingChanged(before, await read()))
        throw new Error(`badge was reissued or changed hands during the write (${tx.hash}); run again`);
      const back = await pc.getEnsText({
        name,
        key: PERMS_TEXT_KEY,
        universalResolverAddress: live.universalResolver,
      });
      if (back !== d.value) throw new Error(`written (${tx.hash}) but read back a different value`);
      return tx;
    });

  return (
    <ConsoleFrame title="Coordinator">
      <Text style={styles.muted}>
        Volunteer coordinator wallet only (ROLE_SET_TEXT on lanyard.perms). Wrong wallets are blocked before
        sending.
      </Text>
      <View style={styles.card}>
        <Field
          label="Volunteer label"
          value={label}
          onChange={setLabel}
          placeholder="priya"
          testID="volunteer"
        />
        <View style={styles.wrap}>
          <Btn label="Make lead" onPress={() => act(true)} disabled={busy} testID="make" />
          <Btn label="Unmake lead" onPress={() => act(false)} disabled={busy} testID="unmake" />
        </View>
      </View>
      <Log log={log} />
    </ConsoleFrame>
  );
}
