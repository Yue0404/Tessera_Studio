import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2024",
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "project-validator",
              test: /packages[\\/]formats[\\/]src[\\/]project-validator\.generated\.ts$/,
              priority: 20,
              includeDependenciesRecursively: false,
            },
            {
              name: "fragment-validator",
              test: /packages[\\/]formats[\\/]src[\\/]fragment-validator\.generated\.ts$/,
              priority: 20,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
});
