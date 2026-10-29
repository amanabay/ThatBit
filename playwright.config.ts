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
    command: "node --import tsx scripts/e2e-setup.ts && npm run dev:local",
    url: "http://localhost:4318",
    env: {
      PORT: "4318",
      LOCAL_READER_PORT: "4321",
      READER_DATA_DIR: ".data/e2e/reader",
      DATA_DIR: ".data/e2e",
      TWITCH_CLIENT_ID: "",
      TWITCH_CHANNEL: "",
      OBS_RECORD_DIR: "",
      OBS_PASSWORD: "",
      WHISPER_BIN: ".data/e2e/fixture-transcribe.mjs",
      WHISPER_MODEL: "fixture-model-not-real-asr",
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
});
