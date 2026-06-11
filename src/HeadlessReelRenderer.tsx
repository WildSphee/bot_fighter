import { useEffect, useRef, useState } from "react";
import { recordReel } from "./export/recordReel";
import { simulateFight } from "./sim/engine";
import type { FightConfig } from "./sim/types";

type RenderRequest = {
  fightConfig: FightConfig;
  soundEnabled: boolean;
};

type RenderResponse = {
  base64: string;
  mimeType: string;
  extension: "mp4" | "webm";
};

declare global {
  interface Window {
    __BOT_FIGHTER_RENDER_REEL?: (request: RenderRequest) => Promise<RenderResponse>;
  }
}

export function HeadlessReelRenderer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState("Renderer booting");

  useEffect(() => {
    window.__BOT_FIGHTER_RENDER_REEL = async ({ fightConfig, soundEnabled }) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("Headless render canvas is unavailable.");
      }

      setStatus(`Rendering ${fightConfig.seed}`);
      const result = simulateFight(fightConfig);
      const recording = await recordReel(canvas, result, soundEnabled);
      const base64 = await blobToBase64(recording.blob);
      setStatus(`Rendered ${fightConfig.seed}`);
      return {
        base64,
        mimeType: recording.mimeType,
        extension: recording.extension,
      };
    };

    setStatus("Renderer ready");
    return () => {
      delete window.__BOT_FIGHTER_RENDER_REEL;
    };
  }, []);

  return (
    <main className="headless-renderer">
      <canvas ref={canvasRef} width={900} height={1600} />
      <span>{status}</span>
    </main>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
