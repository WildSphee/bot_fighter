import type { SoundEventType } from "../sim/types";

export type SoundEngine = {
  context: AudioContext;
  play: (type: SoundEventType, when?: number) => void;
  close: () => Promise<void>;
};

export function createSoundEngine(options: {
  context?: AudioContext;
  destination?: AudioNode;
  monitor?: boolean;
} = {}): SoundEngine {
  const context = options.context ?? new AudioContext();
  const output = context.createGain();
  output.gain.value = 0.38;
  output.connect(options.destination ?? context.destination);

  if (options.destination && options.monitor) {
    output.connect(context.destination);
  }

  return {
    context,
    play: (type, when = context.currentTime) => {
      if (context.state === "suspended") {
        void context.resume();
      }

      playSound(context, output, type, when);
    },
    close: () => (options.context ? Promise.resolve() : context.close()),
  };
}

function playSound(
  context: AudioContext,
  output: AudioNode,
  type: SoundEventType,
  when: number
) {
  switch (type) {
    case "boost":
      noiseBurst(context, output, when, 0.18, 520, 0.08);
      tone(context, output, when, 0.16, 110, 72, "sawtooth", 0.08);
      break;
    case "laser":
      tone(context, output, when, 0.13, 920, 180, "square", 0.11);
      break;
    case "missile":
      tone(context, output, when, 0.34, 120, 86, "sawtooth", 0.08);
      noiseBurst(context, output, when, 0.32, 300, 0.04);
      break;
    case "impact":
      noiseBurst(context, output, when, 0.12, 1100, 0.18);
      tone(context, output, when, 0.1, 180, 90, "triangle", 0.08);
      break;
    case "explosion":
      noiseBurst(context, output, when, 0.55, 180, 0.34);
      tone(context, output, when, 0.5, 96, 34, "sine", 0.2);
      break;
    case "shield":
      tone(context, output, when, 0.18, 340, 620, "sine", 0.08);
      tone(context, output, when + 0.08, 0.18, 510, 820, "sine", 0.06);
      break;
    case "emp":
      tone(context, output, when, 0.45, 70, 48, "sawtooth", 0.12);
      tone(context, output, when, 0.12, 1200, 330, "square", 0.05);
      break;
    case "winner":
      tone(context, output, when, 0.18, 330, 392, "triangle", 0.08);
      tone(context, output, when + 0.17, 0.2, 392, 523, "triangle", 0.08);
      tone(context, output, when + 0.35, 0.42, 523, 659, "triangle", 0.1);
      break;
  }
}

function tone(
  context: AudioContext,
  output: AudioNode,
  when: number,
  duration: number,
  startFrequency: number,
  endFrequency: number,
  type: OscillatorType,
  volume: number
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), when + duration);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  oscillator.connect(gain);
  gain.connect(output);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.02);
}

function noiseBurst(
  context: AudioContext,
  output: AudioNode,
  when: number,
  duration: number,
  frequency: number,
  volume: number
) {
  const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < bufferSize; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(frequency, when);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.4), when + duration);
  gain.gain.setValueAtTime(volume, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  source.start(when);
}
