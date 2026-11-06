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
    files: ["scripts/**", "cli/**", "fixtures/**", "e2e/**", "*.config.*", "*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
);
