import { defineConfig } from "vitest/config";

// The two node:test scripts under scripts/tests/*.mjs are exercised separately
// (node --test) and must not be collected by `vitest run`. Scoping the include
// to the vitest TypeScript suites keeps `pnpm test` green without touching the
// node:test coverage.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
