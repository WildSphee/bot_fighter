import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { createSoundEngine } from "../audio/sfx";
import {
  REEL_INTRO_SECONDS,
  drawFightFrame,
  drawReelIntroFrame,
  getReelIntroNames,
} from "../render/drawFight";
import type { FightResult } from "../sim/types";
import type { ReelRecording } from "./recordReel";

const AUDIO_SAMPLE_RATE = 48_000;
const VIDEO_BITRATE = 12_000_000;
const AUDIO_BITRATE = 128_000;
// Decay tail so the final sound effects are not clipped by the render length.
const AUDIO_TAIL_SECONDS = 2;
// H.264 codec strings to probe, highest level first, so steeper frame rates and
// resolutions are preferred when the platform supports them.
const AVC_CODECS = ["avc1.640034", "avc1.64002A", "avc1.640028", "avc1.4D4028"];

/**
 * Deterministic, offline reel export. Unlike the realtime MediaRecorder path,
 * every frame is rendered and handed to a WebCodecs encoder with an explicit
 * timestamp, so the output has perfectly even frame spacing regardless of how
 * long each frame takes to draw — no wall-clock pacing, no dropped frames.
 */
export function supportsOfflineEncode(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  );
}

export async function encodeReelOffline(
  canvas: HTMLCanvasElement,
  result: FightResult,
  includeSound: boolean,
  onProgress?: (fraction: number) => void
): Promise<ReelRecording> {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available for recording.");
  }

  const fps = result.config.previewFps;
  const width = canvas.width;
  const height = canvas.height;

  const audioBuffer = includeSound ? await renderAudioTrack(result) : undefined;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    audio: audioBuffer
      ? { codec: "aac", numberOfChannels: 1, sampleRate: AUDIO_SAMPLE_RATE }
      : undefined,
    fastStart: "in-memory",
  });

  let encodeError: unknown;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error;
    },
  });
  videoEncoder.configure({
    codec: await pickAvcCodec(width, height, fps),
    width,
    height,
    bitrate: VIDEO_BITRATE,
    framerate: fps,
  });

  const introNames = getReelIntroNames(result);
  const introFrames = Math.round(fps * REEL_INTRO_SECONDS);
  const totalFrames = introFrames + result.frames.length;
  const frameDuration = 1_000_000 / fps; // microseconds
  let lastPercent = -1;
  onProgress?.(0);
  for (let index = 0; index < totalFrames; index += 1) {
    if (encodeError) {
      break;
    }

    // Lead with the "class vs class" intro card, then the fight frames, so the
    // exported reel opens exactly like the preview does.
    if (index < introFrames) {
      drawReelIntroFrame(context, result, introNames);
    } else {
      drawFightFrame(context, result.frames[index - introFrames], result);
    }
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(index * frameDuration),
      duration: Math.round(frameDuration),
    });
    // One keyframe per second keeps the file seekable without bloating it.
    videoEncoder.encode(frame, { keyFrame: index % fps === 0 });
    frame.close();

    // Throttle progress to whole-percent steps so we don't flood React state.
    const percent = Math.floor(((index + 1) / totalFrames) * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress?.((index + 1) / totalFrames);
    }

    // Bound memory and let the visible canvas repaint to show progress.
    if (videoEncoder.encodeQueueSize > 8) {
      await drainQueue(videoEncoder);
    }
  }

  await videoEncoder.flush();
  if (encodeError) {
    throw encodeError;
  }

  if (audioBuffer) {
    await encodeAudioTrack(muxer, audioBuffer);
  }

  muxer.finalize();
  onProgress?.(1);

  return {
    blob: new Blob([muxer.target.buffer], { type: "video/mp4" }),
    mimeType: "video/mp4",
    extension: "mp4",
  };
}

async function pickAvcCodec(width: number, height: number, fps: number): Promise<string> {
  for (const codec of AVC_CODECS) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: VIDEO_BITRATE,
      framerate: fps,
    });
    if (support.supported) {
      return codec;
    }
  }
  // Fall back to the most broadly supported level and let configure() decide.
  return AVC_CODECS[AVC_CODECS.length - 1];
}

function drainQueue(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (encoder.encodeQueueSize <= 4) {
        resolve();
        return;
      }
      // setTimeout(0) yields a macrotask so the encoder can drain and the
      // canvas can paint; it does not affect frame timing (that is carried by
      // each frame's explicit timestamp).
      setTimeout(check, 0);
    };
    check();
  });
}

async function renderAudioTrack(result: FightResult): Promise<AudioBuffer> {
  // Leading silence covers the intro card; offset every sound by the same amount
  // so the fight audio lines up with the fight frames that follow the intro.
  const length = Math.ceil(
    (REEL_INTRO_SECONDS + result.duration + AUDIO_TAIL_SECONDS) * AUDIO_SAMPLE_RATE
  );
  const offline = new OfflineAudioContext(1, length, AUDIO_SAMPLE_RATE);
  const engine = createSoundEngine({
    context: offline as unknown as AudioContext,
    destination: offline.destination,
  });
  await engine.ready;

  for (const event of result.events) {
    if ("sound" in event) {
      engine.play(event.sound, event.time + REEL_INTRO_SECONDS);
    }
  }

  return offline.startRendering();
}

async function encodeAudioTrack(
  muxer: Muxer<ArrayBufferTarget>,
  audioBuffer: AudioBuffer
): Promise<void> {
  let encodeError: unknown;
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      encodeError = error;
    },
  });
  audioEncoder.configure({
    codec: "mp4a.40.2",
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: AUDIO_BITRATE,
  });

  const samples = audioBuffer.getChannelData(0);
  const chunkFrames = AUDIO_SAMPLE_RATE / 2; // ~0.5s per AudioData chunk
  for (let offset = 0; offset < samples.length; offset += chunkFrames) {
    if (encodeError) {
      break;
    }

    const count = Math.min(chunkFrames, samples.length - offset);
    const audioData = new AudioData({
      format: "f32-planar",
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfFrames: count,
      numberOfChannels: 1,
      timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1_000_000),
      data: samples.subarray(offset, offset + count),
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }

  await audioEncoder.flush();
  if (encodeError) {
    throw encodeError;
  }
}
