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
      // Short thruster burst: airy ignition + low afterburner.
      noiseBurst(context, output, when, 0.08, 1800, 0.08);
      noiseBurst(context, output, when + 0.035, 0.22, 520, 0.055);
      tone(context, output, when, 0.2, 130, 58, "sawtooth", 0.07);
      tone(context, output, when + 0.018, 0.15, 260, 110, "triangle", 0.04);
      break;

    case "charge":
      // Bigger capacitor spin-up: low engine rise + high coil whine + sparks.
      tone(context, output, when, 0.95, 80, 520, "sawtooth", 0.045);
      tone(context, output, when + 0.06, 0.9, 420, 2100, "sine", 0.045);
      tone(context, output, when + 0.18, 0.72, 1200, 2800, "triangle", 0.035);
      tone(context, output, when + 0.42, 0.42, 220, 880, "square", 0.025);
      noiseBurst(context, output, when + 0.24, 0.12, 2600, 0.035);
      noiseBurst(context, output, when + 0.48, 0.1, 3400, 0.04);
      noiseBurst(context, output, when + 0.7, 0.09, 4200, 0.045);
      break;

    case "laser":
    case "ray":
      // Clean sci-fi ray gun: bright snap + falling pew + glassy tail.
      noiseBurst(context, output, when, 0.025, 6800, 0.12);
      tone(context, output, when, 0.12, 1800, 540, "square", 0.075);
      tone(context, output, when + 0.015, 0.16, 2600, 900, "sine", 0.045);
      tone(context, output, when + 0.04, 0.18, 1200, 2200, "triangle", 0.035);
      break;

    case "boomerang":
      // Energy boomerang: throw shimmer + returning wobble.
      tone(context, output, when, 0.13, 520, 1320, "triangle", 0.06);
      tone(context, output, when + 0.1, 0.18, 1320, 620, "sine", 0.055);
      tone(context, output, when + 0.2, 0.2, 680, 1180, "triangle", 0.04);
      tone(context, output, when + 0.32, 0.18, 1180, 480, "sine", 0.035);
      noiseBurst(context, output, when + 0.02, 0.12, 2600, 0.035);
      noiseBurst(context, output, when + 0.24, 0.16, 1800, 0.025);
      break;

    case "shotgun":
      // Robotic scatter blast: multiple staggered cracks + low kick.
      noiseBurst(context, output, when, 0.045, 5200, 0.26);
      noiseBurst(context, output, when + 0.018, 0.05, 3800, 0.18);
      noiseBurst(context, output, when + 0.04, 0.06, 2400, 0.13);
      tone(context, output, when, 0.13, 180, 70, "sawtooth", 0.13);
      tone(context, output, when + 0.015, 0.09, 90, 42, "triangle", 0.12);
      break;

    case "mine":
      // Mine arm / proximity pulse: sinister beep then small mechanical click.
      tone(context, output, when, 0.08, 720, 720, "sine", 0.055);
      tone(context, output, when + 0.12, 0.08, 920, 920, "sine", 0.045);
      tone(context, output, when + 0.24, 0.1, 520, 180, "square", 0.05);
      noiseBurst(context, output, when + 0.25, 0.035, 2600, 0.08);
      break;

    case "missile":
      // Missile launch: ignition pop + smoky thrust tail.
      noiseBurst(context, output, when, 0.045, 3600, 0.16);
      noiseBurst(context, output, when + 0.02, 0.38, 520, 0.08);
      tone(context, output, when, 0.32, 160, 74, "sawtooth", 0.09);
      tone(context, output, when + 0.06, 0.25, 95, 62, "triangle", 0.055);
      break;

    case "rocket":
      // Heavier missile: bigger launch thump + longer combustion.
      noiseBurst(context, output, when, 0.06, 4200, 0.22);
      noiseBurst(context, output, when + 0.035, 0.5, 380, 0.12);
      tone(context, output, when, 0.42, 120, 48, "sawtooth", 0.13);
      tone(context, output, when + 0.03, 0.28, 68, 34, "triangle", 0.1);
      break;

    case "railgun":
      // Electromagnetic cannon: violent crack + hyper-fast energy drop + sub boom.
      noiseBurst(context, output, when, 0.035, 8200, 0.42);
      noiseBurst(context, output, when + 0.018, 0.08, 4800, 0.22);
      tone(context, output, when, 0.16, 4200, 180, "sawtooth", 0.16);
      tone(context, output, when + 0.015, 0.12, 2600, 90, "square", 0.09);
      tone(context, output, when, 0.42, 155, 28, "sine", 0.28);
      tone(context, output, when + 0.045, 0.32, 2600, 1500, "sine", 0.045);
      noiseBurst(context, output, when + 0.06, 0.22, 1600, 0.12);
      break;

    case "impact":
      // Metal-on-metal hit: hard tick + short body + low dent.
      noiseBurst(context, output, when, 0.035, 5600, 0.18);
      noiseBurst(context, output, when + 0.012, 0.09, 1800, 0.12);
      tone(context, output, when, 0.08, 260, 95, "triangle", 0.085);
      tone(context, output, when + 0.02, 0.07, 900, 380, "square", 0.035);
      break;

    case "explosion":
      // Actual explosion shape: initial crack, mid blast, sub drop, dirty rumble tail.
      noiseBurst(context, output, when, 0.045, 7200, 0.46);
      noiseBurst(context, output, when + 0.035, 0.18, 1800, 0.32);
      noiseBurst(context, output, when + 0.08, 0.62, 360, 0.38);
      noiseBurst(context, output, when + 0.18, 0.85, 120, 0.24);
      tone(context, output, when, 0.72, 210, 32, "sine", 0.42);
      tone(context, output, when + 0.035, 0.55, 96, 24, "triangle", 0.3);
      tone(context, output, when + 0.12, 0.4, 62, 20, "sawtooth", 0.12);
      break;

    case "shield":
      // Shield activation: soft energy bloom, not just a beep.
      tone(context, output, when, 0.16, 260, 680, "sine", 0.075);
      tone(context, output, when + 0.06, 0.2, 520, 980, "triangle", 0.055);
      tone(context, output, when + 0.13, 0.24, 980, 620, "sine", 0.045);
      noiseBurst(context, output, when + 0.04, 0.12, 3200, 0.035);
      break;

    case "shield-hit":
      // Shield absorbs a hit: glassy ping + energy ripple.
      noiseBurst(context, output, when, 0.025, 6200, 0.1);
      tone(context, output, when, 0.12, 1180, 620, "sine", 0.08);
      tone(context, output, when + 0.05, 0.18, 860, 430, "triangle", 0.055);
      tone(context, output, when + 0.11, 0.16, 1400, 900, "sine", 0.035);
      break;

    case "shield-break":
      // Shield collapse: brittle crackle + falling power-down.
      noiseBurst(context, output, when, 0.08, 7200, 0.2);
      noiseBurst(context, output, when + 0.06, 0.16, 3600, 0.12);
      tone(context, output, when, 0.34, 980, 120, "sawtooth", 0.08);
      tone(context, output, when + 0.04, 0.28, 620, 80, "square", 0.055);
      break;

    case "emp":
      // Electric EMP: high-voltage snap, unstable buzz, low power drain.
      noiseBurst(context, output, when, 0.035, 7600, 0.2);
      tone(context, output, when, 0.08, 2400, 360, "square", 0.075);
      tone(context, output, when + 0.04, 0.11, 1800, 460, "square", 0.06);
      tone(context, output, when + 0.09, 0.12, 3200, 280, "square", 0.05);
      noiseBurst(context, output, when + 0.08, 0.16, 4200, 0.11);
      noiseBurst(context, output, when + 0.2, 0.2, 2200, 0.08);
      tone(context, output, when, 0.5, 90, 38, "sawtooth", 0.12);
      tone(context, output, when + 0.16, 0.34, 54, 28, "triangle", 0.08);
      break;

    case "winner":
      // Short victory flourish: cleaner and more game-like.
      tone(context, output, when, 0.14, 392, 392, "triangle", 0.075);
      tone(context, output, when + 0.13, 0.14, 523, 523, "triangle", 0.075);
      tone(context, output, when + 0.26, 0.16, 659, 659, "triangle", 0.08);
      tone(context, output, when + 0.42, 0.34, 784, 1046, "sine", 0.075);
      tone(context, output, when + 0.48, 0.28, 392, 523, "sine", 0.045);
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
