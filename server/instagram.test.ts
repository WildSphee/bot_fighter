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
    expect(fetcher.mock.calls[0][0]).toContain("https://graph.instagram.com/");
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
