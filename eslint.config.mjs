import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import lanyard from "./scripts/eslint/boundaries.mjs";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "web-build/**",
      ".expo/**",
      "expo-env.d.ts",
      "android/**",
      "ios/**",
      "coverage/**",
      "spike/**",
      "contracts/**",
      "plans/**",
      ".agents/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { lanyard },
    rules: {
      "lanyard/boundaries": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["app/**", "src/**"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The rules are pure (B2.2-R1, R6): no clock, randomness, timers or network inside.
    files: ["src/rules/**"],
    ignores: ["src/rules/test/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "fetch",
          "XMLHttpRequest",
          "WebSocket",
          "setTimeout",
          "setInterval",
          "setImmediate",
          "performance",
          "crypto",
          "process",
        ].map((name) => ({ name, message: "src/rules is pure: no clocks, randomness, timers or network." })),
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "src/rules is pure: take time from the evaluation context.",
        },
        { object: "Math", property: "random", message: "src/rules is pure: no randomness." },
        { object: "globalThis", message: "src/rules is pure: no ambient globals." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "src/rules is pure: take time from the evaluation context.",
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: "src/rules is pure: take time from the evaluation context.",
        },
      ],
    },
  },
  {
    files: ["scripts/**", "cli/**", "fixtures/**", "e2e/**", "*.config.*", "*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["metro.config.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
