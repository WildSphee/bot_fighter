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
    case "charge":
      // Sci-fi capacitor spin-up: stacked rising whines + shimmer building to
      // the shot. Spans ~0.9s to track the 1s railgun charge.
      tone(context, output, when, 0.9, 120, 1500, "sawtooth", 0.05);
      tone(context, output, when, 0.9, 240, 2300, "sine", 0.045);
      tone(context, output, when + 0.12, 0.78, 60, 760, "triangle", 0.06);
      noiseBurst(context, output, when + 0.28, 0.6, 2800, 0.03);
      break;
    case "laser":
      tone(context, output, when, 0.13, 920, 180, "square", 0.11);
      break;
    case "railgun":
      // Electromagnetic CRACK: sharp transient, descending hyper-laser zap,
      // deep EM boom, and a thin metallic ring tail.
      noiseBurst(context, output, when, 0.06, 7200, 0.5);
      tone(context, output, when, 0.3, 3200, 120, "sawtooth", 0.2);
      tone(context, output, when, 0.22, 1900, 60, "square", 0.13);
      tone(context, output, when, 0.5, 150, 30, "sine", 0.34);
      tone(context, output, when + 0.04, 0.5, 2500, 1700, "sine", 0.06);
      noiseBurst(context, output, when, 0.3, 2200, 0.18);
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
      // Layered boom: bright crack transient, mid body, deep sub drop, and a
      // filtered rumble tail so detonations actually land.
      noiseBurst(context, output, when, 0.07, 6000, 0.45);
      noiseBurst(context, output, when, 0.6, 440, 0.5);
      noiseBurst(context, output, when + 0.07, 0.7, 150, 0.3);
      tone(context, output, when, 0.7, 170, 28, "sine", 0.5);
      tone(context, output, when, 0.45, 82, 22, "triangle", 0.32);
      break;
    case "shield":
      tone(context, output, when, 0.18, 340, 620, "sine", 0.08);
      tone(context, output, when + 0.08, 0.18, 510, 820, "sine", 0.06);
      break;
    case "emp":
      tone(context, output, when, 0.45, 70, 48, "sawtooth", 0.12);
      tone(context, output, when, 0.12, 1200, 330, "square", 0.05);
      // electric crackle
      tone(context, output, when, 0.3, 2400, 140, "square", 0.06);
      noiseBurst(context, output, when, 0.34, 3200, 0.12);
      noiseBurst(context, output, when + 0.08, 0.22, 2200, 0.08);
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
