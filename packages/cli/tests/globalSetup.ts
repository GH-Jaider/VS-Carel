/**
 * Build the CLI bundle before the black-box suite runs.
 *
 * The tests execute dist/karel.mjs as a real program, which means the artifact
 * under test is a build output rather than the sources vitest can see. Building
 * here — with the same esbuild invocation as `pnpm build` — keeps the two in
 * step: `pnpm --filter @karel/cli test` is enough on a clean checkout, and a
 * source edit can never be validated against yesterday's bundle.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default function setup(): void {
  const esbuild = join(packageRoot, "node_modules", ".bin", "esbuild");
  if (!existsSync(esbuild)) {
    throw new Error(`esbuild not found at ${esbuild}; run 'pnpm install' first`);
  }

  execFileSync(
    esbuild,
    ["src/main.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=dist/karel.mjs"],
    { cwd: packageRoot, stdio: "inherit" }
  );
}
