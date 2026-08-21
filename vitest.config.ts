import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    coverage: { reporter: ["text", "html"] },
  },
});
