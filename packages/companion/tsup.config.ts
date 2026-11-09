import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  splitting: false,
  bundle: true,
  noExternal: ["@foundry-mcp/shared"],
  banner: { js: "#!/usr/bin/env node" },
});
