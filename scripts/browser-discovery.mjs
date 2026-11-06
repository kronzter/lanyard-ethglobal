import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";

const browserNames = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "msedge",
  "chrome",
];

function executable(file, platform) {
  if (!existsSync(file)) return false;
  if (platform === "win32") return true;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findBrowser({
  platform = process.platform,
  env = process.env,
  isExecutable = (file) => executable(file, platform),
} = {}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const pathEntries = (env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const extensions =
    platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const locate = (candidate) => {
    if (pathApi.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) {
      return isExecutable(candidate) ? candidate : undefined;
    }
    for (const directory of pathEntries) {
      const names =
        platform === "win32" && !pathApi.extname(candidate)
          ? extensions.map((extension) => candidate + extension.toLowerCase())
          : [candidate];
      for (const name of names) {
        const file = pathApi.join(directory, name);
        if (isExecutable(file)) return file;
      }
    }
    return undefined;
  };

  if (env.BROWSER) return locate(env.BROWSER);

  const candidates = [...browserNames];
  if (platform === "win32") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA ?? "";
    candidates.unshift(
      pathApi.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      pathApi.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      pathApi.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      pathApi.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      ...(localAppData ? [pathApi.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")] : []),
    );
  }
  for (const candidate of candidates) {
    const found = locate(candidate);
    if (found) return found;
  }
  return undefined;
}
