import { ApiRequestError } from "./apiError";
import type { ScheduledReelJob } from "./instagramSchedule";

type Env = Record<string, string | undefined>;

type RenderedReelPayload = {
  base64: string;
  mimeType: string;
  extension: string;
};

const DEFAULT_RENDER_URL = "http://localhost:5173/?scheduler-render=1";

export async function renderScheduledReel(
  job: ScheduledReelJob,
  env: Env = process.env
): Promise<{ video: Buffer; contentType: string }> {
  const renderUrl = env.SCHEDULER_RENDER_URL?.trim() || DEFAULT_RENDER_URL;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 1600 },
    });
    await page.goto(renderUrl, { waitUntil: "networkidle" });
    await page.waitForFunction("typeof window.__BOT_FIGHTER_RENDER_REEL === 'function'", undefined, {
      timeout: 30_000,
    });
    const payload = await page.evaluate(
      async ({ fightConfig, soundEnabled }) =>
        (
          globalThis as typeof globalThis & {
            __BOT_FIGHTER_RENDER_REEL?: (input: {
              fightConfig: ScheduledReelJob["fightConfig"];
              soundEnabled: boolean;
            }) => Promise<RenderedReelPayload>;
          }
        ).__BOT_FIGHTER_RENDER_REEL?.({ fightConfig, soundEnabled }),
      {
        fightConfig: job.fightConfig,
        soundEnabled: job.soundEnabled,
      }
    );

    if (!payload?.base64 || payload.extension !== "mp4") {
      throw new ApiRequestError("Scheduled renderer did not return an MP4 reel.", 502, payload);
    }

    return {
      video: Buffer.from(payload.base64, "base64"),
      contentType: payload.mimeType || "video/mp4",
    };
  } finally {
    await browser.close();
  }
}
