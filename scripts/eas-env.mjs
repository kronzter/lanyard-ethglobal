// Copies the two app settings EAS cloud builds cannot see (.env is git-ignored) into the EAS
// project's `preview` environment: the Sepolia RPC URL and the Reown (wallet connect) project ID.
// Both are EXPO_PUBLIC values that end up inside the APK anyway. Values are never printed.
// Run once with `pnpm demo:eas-env`, then `pnpm app:apk`.
import { spawnSync } from "node:child_process";

const names = ["EXPO_PUBLIC_SEPOLIA_RPC_URL", "EXPO_PUBLIC_REOWN_PROJECT_ID"];
let failed = false;
for (const name of names) {
  const value = process.env[name];
  if (!value) {
    console.log(`${name}: missing from .env`);
    failed = true;
    continue;
  }
  const r = spawnSync(
    "npx",
    [
      "eas-cli",
      "env:create",
      "preview",
      "--name",
      name,
      "--value",
      value,
      "--visibility",
      "plaintext",
      "--force",
      "--non-interactive",
    ],
    { shell: true, encoding: "utf8" },
  );
  const ok = r.status === 0;
  failed ||= !ok;
  console.log(`${name}: ${ok ? "set in EAS preview" : "failed"}`);
  if (!ok)
    console.log(
      `${r.stderr ?? ""}${r.stdout ?? ""}`
        .split(value)
        .join("<value>")
        .trim()
        .split("\n")
        .slice(-3)
        .join("\n"),
    );
}
process.exitCode = failed ? 1 : 0;
