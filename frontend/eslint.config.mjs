// ESLint v9 flat config — primary purpose: catch undefined references (e.g. missing
// lucide-react named imports) at build time so they never reach the browser as runtime errors.
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  { ignores: ["build/**", "node_modules/**", "public/**", "**/*.config.js"] },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2024,
        ...globals.node,
        process: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      // Crucial: catches missing imports (lucide icons, lodash helpers, etc.)
      "no-undef": "error",
      // Catches undefined JSX components — e.g. <FileDown /> when FileDown isn't imported.
      "react/jsx-no-undef": "error",
      // JSX names also count as "used" so they don't get flagged as imports without users
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      // The rest are kept loose — we only added this config to catch undefined references.
      "no-unused-vars": "off",
      "no-empty": "off",
    },
  },
];
