import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname ?? "", "src"),
    },
  },
});