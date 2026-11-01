import type { Page } from "@playwright/test";
import { CaptureStart } from "../../shared/contracts/capture.ts";
export async function generatedCapture(page: Page) {
  await page.route("**/api/creator/captures", async (route) => {
    const body = CaptureStart.parse(route.request().postDataJSON());
    await route.continue({
      postData: JSON.stringify({ ...body, fixture: true }),
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const drawing = canvas.getContext("2d");
        const stream = canvas.captureStream(15);
        const audio = new AudioContext();
        const sine = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        sine.frequency.value = 440;
        sine.connect(destination);
        sine.start();
        for (const track of destination.stream.getAudioTracks())
          stream.addTrack(track);
        const timer = setInterval(() => {
          if (drawing) {
            drawing.fillStyle = "#244f3c";
            drawing.fillRect(0, 0, 640, 360);
            drawing.fillStyle = "white";
            drawing.font = "24px sans-serif";
            drawing.fillText("GENERATED CAPTURE FIXTURE", 30, 80);
            drawing.fillText(String(performance.now()), 30, 140);
          }
        }, 60);
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          clearInterval(timer);
          void audio.close();
        });
        return stream;
      },
    });
  });
}
