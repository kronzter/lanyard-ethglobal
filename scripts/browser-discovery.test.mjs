import { describe, expect, it } from "vitest";
import { findBrowser } from "./browser-discovery.mjs";

const opts = (platform, env = {}, files = []) => ({
  platform,
  env,
  isExecutable: (file) => files.includes(file),
});

describe("browser discovery", () => {
  it("accepts an explicit Windows executable path containing spaces", () => {
    const executable = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
    expect(findBrowser(opts("win32", { BROWSER: executable }, [executable]))).toBe(executable);
  });
  it("finds Chrome in a common Windows install location", () => {
    const executable = String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`;
    expect(findBrowser(opts("win32", {}, [executable]))).toBe(executable);
  });
  it("searches Windows PATH using platform separators and executable suffixes", () => {
    const executable = String.raw`D:\Apps\Chromium\chrome.exe`;
    expect(
      findBrowser(
        opts("win32", { PATH: String.raw`C:\tools;D:\Apps\Chromium`, PATHEXT: ".COM;.EXE;.BAT" }, [
          executable,
        ]),
      ),
    ).toBe(executable);
  });
  it("retains POSIX PATH lookup", () => {
    expect(findBrowser(opts("linux", { PATH: "/opt/bin:/usr/bin" }, ["/usr/bin/chromium"]))).toBe(
      "/usr/bin/chromium",
    );
  });
  it("returns undefined when no browser exists", () => {
    expect(findBrowser(opts("linux", { PATH: "/empty" }, []))).toBeUndefined();
  });
});
