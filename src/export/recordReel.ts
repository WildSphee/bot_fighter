import { createSoundEngine } from "../audio/sfx";
import {
  REEL_INTRO_SECONDS,
  drawFightFrame,
  drawReelIntroFrame,
  getReelIntroNames,
} from "../render/drawFight";
import type { FightEvent, FightResult, SoundEventType } from "../sim/types";
import { encodeReelOffline, supportsOfflineEncode } from "./encodeReelOffline";

export type ReelRecording = {
  blob: Blob;
  mimeType: string;
  extension: "mp4" | "webm";
};

const MIME_TYPES = [
  "video/mp4;codecs=h264",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm",
];

/**
 * Prefer the deterministic offline encoder (even frame spacing, no dropped
 * frames). Fall back to realtime MediaRecorder capture when WebCodecs is
 * unavailable or the offline encode fails for any reason.
 */
export async function recordReel(
  canvas: HTMLCanvasElement,
  result: FightResult,
  includeSound: boolean,
  onProgress?: (fraction: number) => void
): Promise<ReelRecording> {
  if (supportsOfflineEncode()) {
    try {
      return await encodeReelOffline(canvas, result, includeSound, onProgress);
    } catch (error) {
      console.warn("Offline reel encode failed; falling back to realtime capture.", error);
    }
  }

  return recordReelRealtime(canvas, result, includeSound, onProgress);
}

async function recordReelRealtime(
  canvas: HTMLCanvasElement,
  result: FightResult,
  includeSound: boolean,
  onProgress?: (fraction: number) => void
): Promise<ReelRecording> {
  const mimeType =
    MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";
  const extension = mimeType.includes("mp4") ? "mp4" : "webm";
  const fps = result.config.previewFps;
  const canvasStream = canvas.captureStream(fps);
  const audioContext = includeSound ? new AudioContext() : undefined;
  const destination = audioContext?.createMediaStreamDestination();
  const soundEngine =
    audioContext && destination
      ? createSoundEngine({ context: audioContext, destination })
      : undefined;
  const mediaStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(destination?.stream.getAudioTracks() ?? []),
  ]);
  const recorder = new MediaRecorder(mediaStream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: BlobPart[] = [];
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available for recording.");
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(500);

  // Lead with the "class vs class" intro card (silent, matching the preview),
  // then play the fight frames so the recording opens like the preview does.
  const introNames = getReelIntroNames(result);
  const introFrames = Math.round(fps * REEL_INTRO_SECONDS);
  const totalFrames = introFrames + result.frames.length;

  let lastEventTime = -0.01;
  let lastPercent = -1;
  onProgress?.(0);
  for (let index = 0; index < introFrames; index += 1) {
    drawReelIntroFrame(context, result, introNames);

    const percent = Math.floor(((index + 1) / totalFrames) * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress?.((index + 1) / totalFrames);
    }

    await wait(1000 / fps);
  }
  for (let index = 0; index < result.frames.length; index += 1) {
    const frame = result.frames[index];
    drawFightFrame(context, frame, result);
    if (soundEngine) {
      playFrameSounds(result.events, lastEventTime, frame.time, soundEngine.play);
    }
    lastEventTime = frame.time;

    const percent = Math.floor(((introFrames + index + 1) / totalFrames) * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress?.((introFrames + index + 1) / totalFrames);
    }

    await wait(1000 / fps);
  }
  onProgress?.(1);

  recorder.stop();
  for (const track of mediaStream.getTracks()) {
    track.stop();
  }
  await stopped;
  await soundEngine?.close();
  await audioContext?.close().catch(() => undefined);

  return {
    blob: new Blob(chunks, { type: mimeType }),
    mimeType,
    extension,
  };
}

function playFrameSounds(
  events: FightEvent[],
  after: number,
  beforeOrAt: number,
  play: (type: SoundEventType) => void
) {
  for (const event of events) {
    if ("sound" in event && event.time > after && event.time <= beforeOrAt) {
      play(event.sound);
    }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
