import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The suite spawns dist/karel.mjs, so the bundle has to exist and has to
    // match src/ before a single test runs. globalSetup builds it once for the
    // whole run rather than making every developer remember `pnpm build` first
    // — a stale bundle would otherwise turn into a green run that proves
    // nothing about the code in the working tree.
    globalSetup: ["tests/globalSetup.ts"],
    // Spawning a process per case is slower than an in-process import; the
    // default 5s timeout is tight on a cold filesystem.
    testTimeout: 20_000,
  },
});
