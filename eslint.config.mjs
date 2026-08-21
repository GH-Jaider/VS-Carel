import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Generated output: tsup's dist/ and webpack's bundle. Without this,
    // `eslint .` from the workspace root lints the build.
    ignores: ["**/dist/**", "**/out/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // A leading underscore is the codebase's marker for a binding that
      // exists only to satisfy a signature (VS Code provider callbacks) or a
      // destructuring shape. Keeps the rule sharp everywhere else.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
    },
  },
  {
    // Webview code runs in the VS Code webview sandbox: a browser, not the
    // extension host, so it gets DOM globals plus the webview-only bridge.
    files: ["packages/*/media/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        acquireVsCodeApi: "readonly",
      },
    },
  },
  {
    // Build config consumed by webpack through require(), not by a bundler.
    files: ["**/webpack.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
  }
);
