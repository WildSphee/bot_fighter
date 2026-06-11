import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { buildFfmpegArgs, normalizeReelVideo } from "./videoNormalize";

describe("reel video normalization", () => {
  it("builds Instagram-friendly ffmpeg arguments", () => {
    const args = buildFfmpegArgs("/tmp/input.mp4", "/tmp/output.mp4");
    const joined = args.join(" ");

    expect(args).toContain("libx264");
    expect(args).toContain("+faststart");
    expect(args).toContain("yuv420p");
    expect(args).toContain("aac");
    expect(args).toContain("128k");
    expect(args).toContain("48000");
    expect(joined).toContain("fps=60");
    expect(joined).toContain("scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(joined).toContain("out_color_matrix=bt709");
    expect(joined).toContain("out_range=tv");
    expect(joined).toContain("pad=1080:1920");
    expect(joined).toContain("format=yuv420p");
    expect(joined).toContain("-g 60");
    expect(joined).toContain("-keyint_min 60");
    expect(joined).toContain("-sc_threshold 0");
    expect(joined).toContain("-color_primaries bt709");
    expect(joined).toContain("-color_trc bt709");
    expect(joined).toContain("-colorspace bt709");
    expect(joined).toContain("-color_range tv");
  });

  it("returns normalized mp4 bytes from the ffmpeg output path", async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => {
      await writeFile(args[args.length - 1], Buffer.from("normalized"));
    });

    const result = await normalizeReelVideo(Buffer.from("raw"), "video/mp4", { runner });

    expect(result).toEqual({
      video: Buffer.from("normalized"),
      contentType: "video/mp4",
    });
    expect(runner.mock.calls[0][0]).toContain("ffmpeg");
    expect(runner.mock.calls[0][1]).toContain("-i");
  });
});
