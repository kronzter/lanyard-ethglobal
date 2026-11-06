const quote = (files) => files.map((f) => JSON.stringify(f)).join(" ");

export default {
  "*.{ts,tsx,mts,mjs,js}": (files) => [
    `eslint --fix --no-warn-ignored ${quote(files)}`,
    `prettier --write --ignore-unknown ${quote(files)}`,
  ],
  "*.{json,md,yml,yaml}": (files) => `prettier --write --ignore-unknown ${quote(files)}`,
  "contracts/**/*.sol": (files) => `forge fmt --root contracts ${quote(files)}`,
};
