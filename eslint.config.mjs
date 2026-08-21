import typescriptEslint from "typescript-eslint";

export default [
  {
    // Generated output: tsup's dist/, webpack's bundle and the tsc scratch dir.
    // Without this, `eslint .` from the workspace root lints the build.
    ignores: ["**/dist/**", "**/out/**", "**/node_modules/**", "**/.vscode-test/**"],
  },
  {
    files: ["**/*.ts"],
  },
  {
    plugins: {
      "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
    },
  },
];
