// Metro config. Changes from Expo's default:
// 1. TypeScript sources shipped inside packages (ox, pulled in by the wagmi connectors) import their
//    siblings as "./x.js"; map those to "./x.ts".
// 2. Don't watch folders that are never app code. `web:export` rewrites hundreds of chunks in dist/
//    and Foundry fills contracts/; watching them floods live reload and hits EMFILE on Windows.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Match either path separator: Metro may hand us Windows or POSIX paths.
const pathPattern = (p) =>
  p
    .split(/[\\/]/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\\\/]");
const ignored = ["dist", "contracts", ".lanyard", "reference", ".playwright-mcp"].map(
  (dir) => new RegExp(`^${pathPattern(path.join(__dirname, dir))}[\\\\/].*`),
);
const blockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(blockList) ? blockList : blockList ? [blockList] : []),
  ...ignored,
];
const resolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const next = resolve ?? context.resolveRequest;
  if (moduleName.startsWith(".") && moduleName.endsWith(".js") && /\.tsx?$/.test(context.originModulePath)) {
    try {
      return next(context, moduleName, platform);
    } catch {
      return next(context, moduleName.replace(/\.js$/, ""), platform);
    }
  }
  return next(context, moduleName, platform);
};

module.exports = config;
