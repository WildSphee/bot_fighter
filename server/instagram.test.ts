import { describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  buildCaptionPrompt,
  generateReelCaption,
  normalizeRemoteError,
  publishInstagramReel,
  type ReelCaptionSummary,
} from "./instagram";

const summary: ReelCaptionSummary = {
  seed: "fight-test",
  winnerName: "Striker",
  duration: 12.4,
  botNames: ["Striker", "Bulwark"],
  damage: [
    { name: "Striker", dealt: 121 },
    { name: "Bulwark", dealt: 84 },
  ],
  underdogScore: 35,
  highlights: [{ time: 9.8, text: "Striker hit Bulwark with Rocket for 42" }],
};

const instagramEnv = {
  INSTAGRAM_APP_ID: "app",
  INSTAGRAM_APP_SECRET: "secret",
  INSTAGRAM_ACCOUNT_ID: "1789",
  INSTAGRAM_ACCOUNT_TOKEN: "token",
  INSTAGRAM_POST_LOG: "0",
};
const r2Env = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET: "bucket",
  R2_PUBLIC_BASE_URL: "https://cdn.example.com",
};
const testEnv = {
  ...instagramEnv,
  ...r2Env,
};

describe("instagram publishing helpers", () => {
  it("requires OPENAI_API_KEY for caption generation", async () => {
    await expect(generateReelCaption(summary, { env: {} })).rejects.toMatchObject({
      message: "OPENAI_API_KEY is not configured.",
      status: 500,
    });
  });

  it("builds a caption prompt from the editable caption style", () => {
    const prompt = buildCaptionPrompt(summary);

    expect(prompt).toContain("You are writing an instagram caption");
    expect(prompt).toContain("Striker vs Bulwark - Who will win?");
    expect(prompt).toContain("random fun fact");
  });

  it("defaults caption generation to gpt-5.5 when no model is configured", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ output_text: "Caption #botfight" }));

    await generateReelCaption(summary, {
      env: { OPENAI_API_KEY: "key", OPENAI_MODEL: "" },
      fetcher,
    });

    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
      max_output_tokens: number;
      model: string;
    };
    expect(request.model).toBe("gpt-5.5");
    expect(request.max_output_tokens).toBe(660);
  });

  it("normalizes remote API errors", () => {
    const error = normalizeRemoteError(
      { error: { message: "Invalid OAuth token" } },
      401,
      "Instagram failed."
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.message).toBe("Invalid OAuth token");
    expect(error.status).toBe(401);
  });

  it("hosts a reel, creates a video_url container, polls until finished, and publishes it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }));
    const storage = createStorage();
    const scheduleCleanup = vi.fn();
    const normalizeVideo = createNormalizeVideo();

    const result = await publishInstagramReel(Buffer.from("mp4"), "caption", "video/mp4", {
      env: testEnv,
      fetcher,
      storage,
      scheduleCleanup,
      normalizeVideo,
      wait: async () => undefined,
      pollDelayMs: 1,
    });

    expect(result).toEqual({ mediaId: "media-1", containerId: "container-1", status: "published" });
    expect(normalizeVideo).toHaveBeenCalledWith(Buffer.from("mp4"), "video/mp4");
    expect(storage.uploadVideo).toHaveBeenCalledWith(Buffer.from("normalized-mp4"), "video/mp4");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][0]).toContain("https://graph.instagram.com/");
    expect(fetcher.mock.calls[0][0]).toContain("/1789/media");
    expect(String(fetcher.mock.calls[3][0])).toContain("/1789/media_publish");
    expect(scheduleCleanup).toHaveBeenCalledOnce();
    expect(scheduleCleanup.mock.calls[0][1]).toBe(24 * 60 * 60 * 1000);

    const containerBody = fetcher.mock.calls[0][1]?.body as URLSearchParams;
    expect(containerBody.get("media_type")).toBe("REELS");
    expect(containerBody.get("video_url")).toBe("https://cdn.example.com/instagram-reels/test.mp4");
    expect(containerBody.has("upload_type")).toBe(false);
  });

  it("logs Instagram posting attempts with secrets redacted", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }));
    const storage = createStorage();
    const normalizeVideo = createNormalizeVideo();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await publishInstagramReel(Buffer.from("mp4"), "caption", "video/mp4", {
      env: { ...testEnv, INSTAGRAM_POST_LOG: "1" },
      fetcher,
      logger,
      storage,
      normalizeVideo,
      scheduleCleanup: vi.fn(),
      wait: async () => undefined,
    });

    const output = logger.info.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Creating Instagram reel container.");
    expect(output).toContain('"access_token":"[redacted]"');
    expect(output).not.toContain('"access_token":"token"');
    expect(output).not.toContain("OAuth token");
    expect(output).not.toContain("secret-key");
    expect(output).not.toContain("access-key");
  });

  it("requires R2 configuration when no storage is injected", async () => {
    const fetcher = vi.fn();

    await expect(
      publishInstagramReel(Buffer.from("mp4"), "caption", "video/mp4", {
        env: instagramEnv,
        fetcher,
      })
    ).rejects.toMatchObject({
      message: "Missing Cloudflare R2 configuration: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.",
      status: 500,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not call Instagram when R2 upload fails", async () => {
    const fetcher = vi.fn();
    const storage = createStorage();
    storage.uploadVideo.mockRejectedValueOnce(new ApiRequestError("Cloudflare R2 video upload failed.", 502));
    const normalizeVideo = createNormalizeVideo();

    await expect(
      publishInstagramReel(Buffer.from("mp4"), "caption", "video/mp4", {
        env: testEnv,
        fetcher,
        storage,
        normalizeVideo,
      })
    ).rejects.toMatchObject({
      message: "Cloudflare R2 video upload failed.",
      status: 502,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.deleteVideo).not.toHaveBeenCalled();
  });

  it("fails when Instagram reports an errored container", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "ERROR" }));
    const storage = createStorage();
    const scheduleCleanup = vi.fn();
    const normalizeVideo = createNormalizeVideo();

    await expect(
      publishInstagramReel(Buffer.from("mp4"), "caption", "video/mp4", {
        env: testEnv,
        fetcher,
        storage,
        scheduleCleanup,
        normalizeVideo,
        wait: async () => undefined,
      })
    ).rejects.toMatchObject({
      message: "Instagram container status is ERROR.",
      status: 502,
    });
    expect(scheduleCleanup).toHaveBeenCalledOnce();
  });
});

function createStorage() {
  return {
    uploadVideo: vi.fn().mockResolvedValue({
      key: "instagram-reels/test.mp4",
      url: "https://cdn.example.com/instagram-reels/test.mp4",
    }),
    deleteVideo: vi.fn().mockResolvedValue(undefined),
  };
}

function createNormalizeVideo() {
  return vi.fn().mockResolvedValue({
    video: Buffer.from("normalized-mp4"),
    contentType: "video/mp4" as const,
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
