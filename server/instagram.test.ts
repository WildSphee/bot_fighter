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
};

describe("instagram publishing helpers", () => {
  it("requires OPENAI_API_KEY for caption generation", async () => {
    await expect(generateReelCaption(summary, { env: {} })).rejects.toMatchObject({
      message: "OPENAI_API_KEY is not configured.",
      status: 500,
    });
  });

  it("builds a caption prompt from fight summary details", () => {
    const prompt = buildCaptionPrompt(summary);

    expect(prompt).toContain("Winner: Striker");
    expect(prompt).toContain("Bots: Striker vs Bulwark");
    expect(prompt).toContain("Underdog comeback score: 35");
    expect(prompt).toContain("9.8s Striker hit Bulwark with Rocket for 42");
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

  it("polls a reel container until finished and publishes it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", uri: "https://upload.example/reel" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }));

    const result = await publishInstagramReel(Buffer.from("mp4"), "caption", "video/mp4", {
      env: instagramEnv,
      fetcher,
      wait: async () => undefined,
      pollDelayMs: 1,
    });

    expect(result).toEqual({ mediaId: "media-1", containerId: "container-1", status: "published" });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls[0][0]).toContain("/1789/media");
    expect(fetcher.mock.calls[1][0]).toBe("https://upload.example/reel");
    expect(fetcher.mock.calls[4][0]).toContain("/1789/media_publish");
  });

  it("fails when Instagram reports an errored container", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "ERROR" }));

    await expect(
      publishInstagramReel(Buffer.from("mp4"), "caption", "video/mp4", {
        env: instagramEnv,
        fetcher,
        wait: async () => undefined,
      })
    ).rejects.toMatchObject({
      message: "Instagram container status is ERROR.",
      status: 502,
    });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
