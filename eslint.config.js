import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import tailwindcss from "eslint-plugin-tailwindcss";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      parser: tsParser,
    },
  },
  ts.configs.recommended,
  react.configs.recommended,
  tailwindcss.configs.recommended,
  {
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
];