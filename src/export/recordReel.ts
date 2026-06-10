import { createSoundEngine } from "../audio/sfx";
import { drawFightFrame } from "../render/drawFight";
import type { FightEvent, FightResult, SoundEventType } from "../sim/types";

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

export async function recordReel(
  canvas: HTMLCanvasElement,
  result: FightResult,
  includeSound: boolean
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
  const recorder = new MediaRecorder(mediaStream, { mimeType });
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

  let lastEventTime = -0.01;
  for (const frame of result.frames) {
    drawFightFrame(context, frame, result);
    if (soundEngine) {
      playFrameSounds(result.events, lastEventTime, frame.time, soundEngine.play);
    }
    lastEventTime = frame.time;
    await wait(1000 / fps);
  }

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
