#!/usr/bin/env node
// Runs the pinned canonical-encoding and score-cipher vectors in a headless browser and fails
// on any mismatch.
// The same checkVectors code runs under vitest on Node; together they show canonical bytes and
// hashes agree across runtimes (the Hermes leg runs with spike S11 on a dev build).
// Uses `chromium` locally and `google-chrome` on the GitHub ubuntu runner, or $BROWSER.
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { findBrowser } from "./browser-discovery.mjs";

const root = path.resolve(import.meta.dirname, "..");
const fail = (msg) => {
  console.error(`vectors-browser: FAIL ${msg}`);
  process.exit(1);
};

const browser = findBrowser();
if (!browser) fail("no headless browser found; set BROWSER to an executable path or command");

const bundle = await build({
  entryPoints: [path.join(root, "src/shared/test/vectors/browser-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  logLevel: "silent",
});
const script = bundle.outputFiles[0].text;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>loading</body><script>${script.replace(/<\/script/gi, "<\\/script")}</script></html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  // Async on purpose: the server runs in this process, so a sync spawn would deadlock it.
  const { stdout } = await promisify(execFile)(
    browser,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=10000",
      "--dump-dom",
      `http://127.0.0.1:${server.address().port}/`,
    ],
    { encoding: "utf8", timeout: 90_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const match = /VECTORS:(.*):END/s.exec(stdout);
  if (!match) fail(`the page did not report results (got: ${stdout.slice(0, 200)})`);
  const report = JSON.parse(
    match[1]
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
  if (report.failures.length > 0)
    fail(`${report.failures.length} mismatch(es):\n${JSON.stringify(report.failures, null, 2)}`);
  console.log(
    `vectors-browser: all ${report.count} canonical and ${report.cipherCount} score-cipher vectors match in ${browser} (${report.userAgent.split(" ").find((p) => /Chrome\//.test(p)) ?? "browser"})`,
  );
} finally {
  server.close();
}
