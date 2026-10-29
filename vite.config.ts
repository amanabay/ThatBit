import { resolve } from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/web",
  server: {
    fs: {
      allow: [resolve("apps/web"), resolve("shared"), resolve("node_modules")],
      deny: [
        resolve(process.env.DATA_DIR ?? ".data") + "/**",
        "**/.data/**",
        "**/.env*",
        "**/apps/server/**",
        "**/.git/**",
        "**/*token*.json",
      ],
    },
  },
  build: { outDir: "../../dist", emptyOutDir: true },
});
