#!/usr/bin/env node
// P0.5-R8 smoke check: serve the static web export the way a static host would (assets served
// normally, every other path rewritten to index.html) and prove a public team URL loads by
// direct navigation and on reload. `--render` also renders it in headless Chromium when one is
// available locally (CI runs the server-level check only).
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import handler from "serve-handler";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const TEAM_PATH = "/teams/zkpay";
const fail = (msg) => {
  console.error(`smoke-web-deeplink: FAIL ${msg}`);
  process.exit(1);
};
if (!existsSync(path.join(dist, "index.html"))) fail("dist/index.html missing; run `pnpm web:export` first");
if (!existsSync(path.join(dist, "serve.json")))
  fail("dist/serve.json missing; public/serve.json was not exported");

const config = { public: dist, ...JSON.parse(readFileSync(path.join(dist, "serve.json"), "utf8")) };
const server = http.createServer((req, res) => handler(req, res, config));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const index = readFileSync(path.join(dist, "index.html"), "utf8");
  for (const attempt of ["direct navigation", "reload"]) {
    const res = await fetch(base + TEAM_PATH);
    const body = await res.text();
    if (res.status !== 200) fail(`${TEAM_PATH} (${attempt}) returned ${res.status}`);
    if (body !== index) fail(`${TEAM_PATH} (${attempt}) did not serve the app shell`);
  }
  const script = /src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(index)?.[1];
  if (!script) fail("no app bundle referenced from index.html");
  const asset = await fetch(base + script);
  const type = asset.headers.get("content-type") ?? "";
  if (asset.status !== 200 || !type.includes("javascript"))
    fail(`bundle ${script} not served as JavaScript (${asset.status} ${type})`);
  console.log(
    `smoke-web-deeplink: ${TEAM_PATH} serves the app shell on direct navigation and reload; assets served normally`,
  );

  if (process.argv.includes("--render")) {
    const browser = ["chromium", "chromium-browser", "google-chrome"].find((b) => {
      try {
        execFileSync("which", [b], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    });
    if (!browser) fail("--render needs chromium on PATH");
    // Async on purpose: the static server runs in this process, so a sync spawn would deadlock it.
    const { stdout: dom } = await promisify(execFile)(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--virtual-time-budget=15000",
        "--dump-dom",
        base + TEAM_PATH,
      ],
      { encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024 },
    );
    for (const expected of ["zkPay", "zkpay.mumbai2026.lanyard.eth", "ETHGlobal", "/teams/zkpay"]) {
      if (!dom.includes(expected)) fail(`rendered page is missing ${JSON.stringify(expected)}`);
    }
    if (/connect wallet/i.test(dom)) fail("public team page asks for a wallet");
    console.log(`smoke-web-deeplink: ${TEAM_PATH} renders in ${browser} with no wallet prompt`);
  }
} finally {
  server.close();
}
