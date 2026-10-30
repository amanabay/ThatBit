import { resolve } from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/web",
  server: {
    // Runtime reports use our authenticated, sanitized diagnostics endpoint.
    forwardConsole: false,
    hmr: { port: Number(process.env.VITE_HMR_PORT ?? 24678) },
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
