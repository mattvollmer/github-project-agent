import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    reporters: ["dot"],
    include: ["tests/**/*.spec.ts"],
    globals: false,
  },
  esbuild: {
    target: "node18",
  },
});
