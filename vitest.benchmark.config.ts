import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/benchmarks/**/*.test.ts"],
  },
});
