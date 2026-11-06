// The shell's session: which wallet is connected, at which Sepolia block its roles were read, the
// roles found and the one the user is acting as (P0.5-R6). A real wallet is bridged in by
// WalletBridge (R3); mock mode can also connect a fixture wallet chosen in the dev picker.
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { providers } from "@/providers";
import type { AtBlock } from "@/shared/interfaces/ens-reader";
import type { Address } from "@/shared/types/primitives";
import { type ShellRole, roleKey, rolesFor } from "./roles";

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; roles: ShellRole[] }
  | { state: "failed"; message: string };

export type Session = {
  address: Address | null;
  at: AtBlock | null;
  lookup: Lookup;
  active: ShellRole | null;
  connect(address: Address, at: AtBlock): void;
  disconnect(): void;
  choose(role: ShellRole): void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<{ address: Address; at: AtBlock } | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) {
      setLookup({ state: "idle" });
      return;
    }
    let current = true;
    setLookup({ state: "loading" });
    (async () => rolesFor(wallet.address, providers.identityDirectory(), wallet.at, providers.config))()
      .then((roles) => {
        if (!current) return;
        setLookup({ state: "ready", roles });
        // Keep the previous choice when it still applies; pick the only role automatically.
        setActiveKey((prev) =>
          prev && roles.some((r) => roleKey(r) === prev)
            ? prev
            : roles.length === 1
              ? roleKey(roles[0]!)
              : null,
        );
      })
      .catch((e: unknown) => {
        if (current) setLookup({ state: "failed", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      current = false;
    };
  }, [wallet]);

  const session = useMemo<Session>(() => {
    const roles = lookup.state === "ready" ? lookup.roles : [];
    return {
      address: wallet?.address ?? null,
      at: wallet?.at ?? null,
      lookup,
      active: roles.find((r) => roleKey(r) === activeKey) ?? null,
      connect: (address, at) => setWallet({ address, at }),
      disconnect: () => {
        setWallet(null);
        setActiveKey(null);
      },
      choose: (role) => setActiveKey(roleKey(role)),
    };
  }, [wallet, lookup, activeKey]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}
