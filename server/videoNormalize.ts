import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bundledFfmpegPath from "ffmpeg-static";
import { ApiRequestError } from "./apiError";

type CommandRunner = (command: string, args: string[]) => Promise<void>;

type NormalizeOptions = {
  runner?: CommandRunner;
  ffmpegPath?: string;
};

export type NormalizedVideo = {
  video: Buffer;
  contentType: "video/mp4";
};

export async function normalizeReelVideo(
  video: Buffer,
  contentType: string,
  options: NormalizeOptions = {}
): Promise<NormalizedVideo> {
  const directory = await mkdtemp(join(tmpdir(), "bot-fighter-reel-"));
  const inputPath = join(directory, `input${extensionForContentType(contentType)}`);
  const outputPath = join(directory, "normalized.mp4");

  try {
    await writeFile(inputPath, video);
    await (options.runner ?? runCommand)(readFfmpegPath(options), buildFfmpegArgs(inputPath, outputPath));
    return {
      video: await readFile(outputPath),
      contentType: "video/mp4",
    };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error;
    }
    throw new ApiRequestError("Instagram reel video normalization failed.", 502, normalizeVideoError(error));
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function readFfmpegPath(options: NormalizeOptions) {
  return options.ffmpegPath ?? process.env.FFMPEG_PATH ?? bundledFfmpegPath ?? "ffmpeg";
}

export function buildFfmpegArgs(inputPath: string, outputPath: string) {
  return [
    "-y",
    "-i",
    inputPath,
    "-vf",
    // The browser hands us full-range RGB (from the canvas/VP9 capture). swscale's
    // default RGB->YUV matrix is bt601, but we tag the file bt709 below; that
    // mismatch is what tints the reel yellow/green on a phone. Pin the conversion
    // matrix and range explicitly so the pixels match the metadata.
    "fps=60,scale=1080:1920:force_original_aspect_ratio=decrease:out_color_matrix=bt709:out_range=tv,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-maxrate",
    "10000k",
    "-bufsize",
    "20000k",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-color_range",
    "tv",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  ];
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 6000) {
        stderr = stderr.slice(-6000);
      }
    });

    child.on("error", (error) => {
      reject(new ApiRequestError("ffmpeg is not available for reel normalization.", 500, normalizeVideoError(error)));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new ApiRequestError("ffmpeg failed to normalize Instagram reel video.", 502, {
          exitCode: code,
          stderr: stderr.trim(),
        })
      );
    });
  });
}

function extensionForContentType(contentType: string) {
  if (contentType.includes("webm")) {
    return ".webm";
  }
  if (contentType.includes("quicktime")) {
    return ".mov";
  }
  return ".mp4";
}

function normalizeVideoError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return error;
}
