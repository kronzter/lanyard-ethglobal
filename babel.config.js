// valtio (inside Reown AppKit) uses import.meta, which Expo SDK 53+ only transforms when asked.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
  };
};
