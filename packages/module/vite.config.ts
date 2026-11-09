import { copyFileSync } from "node:fs";
import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    lib: { entry: "src/main.ts", formats: ["es"], fileName: "module" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  plugins: [
    {
      name: "foundry-module-files",
      closeBundle() {
        copyFileSync("module.json", "dist/module.json");
        copyFileSync("module.css", "dist/module.css");
      },
    },
  ],
});
