import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // ZIP 解析仅在用户导入包时动态进入；提前预构建，避免首次导入触发 Vite 整页重载并中断事务。
  optimizeDeps: {
    include: ["@tessera/module-runtime > @zip.js/zip.js"],
  },
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
              includeDependenciesRecursively: true,
            },
            {
              name: "fragment-validator",
              test: /packages[\\/]formats[\\/]src[\\/]fragment-validator\.generated\.ts$/,
              priority: 20,
              includeDependenciesRecursively: true,
            },
          ],
        },
      },
    },
  },
});
