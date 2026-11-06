// Metro config. The only change from Expo's default: TypeScript sources shipped inside packages
// (ox, pulled in by the wagmi connectors) import their siblings as "./x.js"; map those to "./x.ts".
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
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
