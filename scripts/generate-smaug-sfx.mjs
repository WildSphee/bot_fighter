import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "src", "audio", "generated");

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is required to generate Smaug sound effects.");
}

const effects = [
  {
    file: "smaug-fire-burst.mp3",
    duration: 1.2,
    text:
      "A massive fantasy dragon fire burst, sharp ignition whoomph, roaring flame front, hot crackle, no music, no voice.",
  },
  {
    file: "smaug-burning.mp3",
    duration: 1.1,
    text:
      "Close-up burning embers and small persistent fire crackles, dry sizzling flames, game status effect, no music, no voice.",
  },
  {
    file: "smaug-flamethrower.mp3",
    duration: 3,
    text:
      "Deep heavy flamethrower roar, continuous pressurized dragon breath fire, low rumble, turbulent flames, cinematic game sound, no music, no voice.",
  },
];

await mkdir(outputDir, { recursive: true });

for (const effect of effects) {
  const response = await globalThis.fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: effect.text,
      duration_seconds: effect.duration,
      prompt_influence: 0.55,
      model_id: "eleven_text_to_sound_v2",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to generate ${effect.file}: ${response.status} ${detail}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const outputPath = path.join(outputDir, effect.file);
  await writeFile(outputPath, bytes);
  console.log(`Generated ${path.relative(root, outputPath)} (${bytes.length} bytes)`);
}
