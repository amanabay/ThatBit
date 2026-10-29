import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: "http://localhost:4318",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/e2e-setup.ts && npm run dev",
    url: "http://localhost:4318",
    env: {
      PORT: "4318",
      DATA_DIR: ".data/e2e",
      WHISPER_BIN: ".data/e2e/fixture-transcribe.mjs",
      WHISPER_MODEL: "fixture-model-not-real-asr",
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
});
