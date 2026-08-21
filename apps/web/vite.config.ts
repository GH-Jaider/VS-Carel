import { defineConfig } from "vite";

// Served from https://gh-jaider.github.io/karel/, so a production build needs
// that prefix on every asset URL. The dev server serves from the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/karel/" : "/",
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
}));
