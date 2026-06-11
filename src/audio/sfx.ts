import smaugBurningUrl from "./generated/smaug-burning.mp3?url";
import smaugFireBurstUrl from "./generated/smaug-fire-burst.mp3?url";
import smaugFlamethrowerUrl from "./generated/smaug-flamethrower.mp3?url";
import type { SoundEventType } from "../sim/types";

export type SoundEngine = {
  context: AudioContext;
  play: (type: SoundEventType, when?: number) => void;
  ready: Promise<void>;
  close: () => Promise<void>;
};

const SAMPLE_URLS: Partial<Record<SoundEventType, string>> = {
  burning: smaugBurningUrl,
  "fire-burst": smaugFireBurstUrl,
  flamethrower: smaugFlamethrowerUrl,
};

const SAMPLE_BASE_VOLUME: Partial<Record<SoundEventType, number>> = {
  flamethrower: 0.78,
};

const SOUND_VOLUME_MULTIPLIER: Partial<Record<SoundEventType, number>> = {
  flamethrower: 0.8,
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
  const sampleBuffers: Partial<Record<SoundEventType, AudioBuffer>> = {};
  const ready = preloadSamples(context, sampleBuffers);

  if (options.destination && options.monitor) {
    output.connect(context.destination);
  }

  return {
    context,
    play: (type, when = context.currentTime) => {
      // OfflineAudioContext (used for deterministic export rendering) has no
      // resume(); only nudge real contexts that are parked by autoplay policy.
      if (context.state === "suspended" && typeof context.resume === "function") {
        void context.resume();
      }

      playSoundOrSample(type, when);
    },
    ready,
    close: () => (options.context ? Promise.resolve() : context.close()),
  };

  function playSoundOrSample(type: SoundEventType, when: number) {
    const sample = sampleBuffers[type];
    if (sample) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = sample;
      gain.gain.value = (SAMPLE_BASE_VOLUME[type] ?? 0.68) * (SOUND_VOLUME_MULTIPLIER[type] ?? 1);
      source.connect(gain);
      gain.connect(output);
      source.start(when);
      return;
    }

    const scaledOutput = context.createGain();
    scaledOutput.gain.value = SOUND_VOLUME_MULTIPLIER[type] ?? 1;
    scaledOutput.connect(output);
    playSound(context, scaledOutput, type, when);
  }
}

async function preloadSamples(
  context: AudioContext,
  sampleBuffers: Partial<Record<SoundEventType, AudioBuffer>>
): Promise<void> {
  await Promise.all(
    Object.entries(SAMPLE_URLS).map(async ([type, url]) => {
      if (!url) {
        return;
      }

      const response = await fetch(url);
      if (!response.ok) {
        return;
      }

      const data = await response.arrayBuffer();
      sampleBuffers[type as SoundEventType] = await context.decodeAudioData(data.slice(0));
    })
  );
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
      // Capacitor spin-up: lower coil rise with muted static sparks.
      tone(context, output, when, 0.95, 70, 360, "sawtooth", 0.045);
      tone(context, output, when + 0.06, 0.9, 220, 980, "sine", 0.04);
      tone(context, output, when + 0.18, 0.72, 520, 1300, "triangle", 0.028);
      tone(context, output, when + 0.42, 0.42, 160, 520, "square", 0.022);
      noiseBurst(context, output, when + 0.24, 0.12, 1400, 0.03);
      noiseBurst(context, output, when + 0.48, 0.1, 1900, 0.032);
      noiseBurst(context, output, when + 0.7, 0.09, 2400, 0.034);
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
      // Energy boomerang: percussive throw, airy spin, returning shimmer.
      noiseBurst(context, output, when, 0.035, 4200, 0.12);
      tone(context, output, when, 0.1, 260, 620, "sawtooth", 0.07);
      tone(context, output, when + 0.035, 0.24, 740, 1760, "triangle", 0.06);
      tone(context, output, when + 0.12, 0.34, 1760, 540, "sine", 0.055);
      tone(context, output, when + 0.28, 0.22, 920, 1460, "triangle", 0.04);
      noiseBurst(context, output, when + 0.18, 0.28, 1800, 0.04);
      break;

    case "blade":
      // Neon blade: unsheathe hum, circular slash, tiny retract click.
      tone(context, output, when, 0.22, 180, 920, "sawtooth", 0.075);
      tone(context, output, when + 0.18, 0.74, 720, 1040, "sine", 0.045);
      noiseBurst(context, output, when + 0.95, 0.08, 5200, 0.22);
      tone(context, output, when + 0.95, 0.2, 1800, 360, "square", 0.09);
      tone(context, output, when + 1.1, 0.22, 440, 120, "triangle", 0.055);
      noiseBurst(context, output, when + 1.65, 0.035, 2600, 0.08);
      break;

    case "blast-rifle":
      // Four-shot laser rifle burst: fast heavy bolts with unstable EDM bite.
      for (let index = 0; index < 4; index += 1) {
        const shotAt = when + index * 0.04;
        noiseBurst(context, output, shotAt, 0.026, 7600, 0.15);
        tone(context, output, shotAt, 0.09, 2100, 540, "square", 0.075);
        tone(context, output, shotAt + 0.018, 0.12, 920, 220, "sawtooth", 0.06);
      }
      tone(context, output, when, 0.5, 130, 46, "triangle", 0.08);
      break;

    case "shotgun":
      // EDM scatter cannon: hard pump transient, pellet cracks, bright synth tail.
      noiseBurst(context, output, when, 0.032, 8200, 0.34);
      noiseBurst(context, output, when + 0.018, 0.04, 5600, 0.24);
      noiseBurst(context, output, when + 0.045, 0.055, 3600, 0.16);
      tone(context, output, when, 0.16, 230, 54, "sawtooth", 0.15);
      tone(context, output, when + 0.015, 0.1, 96, 38, "triangle", 0.12);
      tone(context, output, when + 0.052, 0.18, 1800, 480, "square", 0.045);
      tone(context, output, when + 0.1, 0.22, 920, 1320, "sine", 0.03);
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
      // Electric EMP: high-voltage snap, crackling arcs, stepped power drain.
      noiseBurst(context, output, when, 0.028, 9200, 0.28);
      noiseBurst(context, output, when + 0.018, 0.05, 6400, 0.2);
      tone(context, output, when, 0.07, 3600, 520, "square", 0.095);
      tone(context, output, when + 0.025, 0.08, 5200, 760, "sawtooth", 0.06);
      tone(context, output, when + 0.055, 0.09, 2800, 420, "square", 0.075);
      tone(context, output, when + 0.11, 0.08, 4600, 620, "square", 0.055);
      noiseBurst(context, output, when + 0.07, 0.2, 5200, 0.16);
      noiseBurst(context, output, when + 0.18, 0.18, 3600, 0.12);
      noiseBurst(context, output, when + 0.32, 0.16, 2400, 0.09);
      tone(context, output, when, 0.62, 120, 34, "sawtooth", 0.14);
      tone(context, output, when + 0.12, 0.14, 72, 52, "square", 0.07);
      tone(context, output, when + 0.26, 0.14, 58, 42, "square", 0.06);
      tone(context, output, when + 0.4, 0.18, 48, 24, "triangle", 0.08);
      break;

    case "glass-break":
      // Alchemist flask: brittle glass crack plus a small liquid splash.
      noiseBurst(context, output, when, 0.018, 9200, 0.24);
      noiseBurst(context, output, when + 0.018, 0.05, 6200, 0.16);
      noiseBurst(context, output, when + 0.055, 0.12, 2600, 0.08);
      tone(context, output, when, 0.08, 1900, 620, "triangle", 0.045);
      tone(context, output, when + 0.035, 0.11, 1280, 360, "sine", 0.035);
      break;

    case "leaf":
      // Druid minions: dry leaves rushing forward with a soft twig snap.
      noiseBurst(context, output, when, 0.12, 3400, 0.055);
      noiseBurst(context, output, when + 0.07, 0.2, 1800, 0.045);
      noiseBurst(context, output, when + 0.18, 0.16, 950, 0.035);
      tone(context, output, when + 0.035, 0.08, 360, 210, "triangle", 0.025);
      tone(context, output, when + 0.18, 0.06, 520, 300, "square", 0.018);
      break;

    case "boulder":
      // Druid rock bloom: heavy stone rise and dull ground impact.
      noiseBurst(context, output, when, 0.06, 900, 0.16);
      noiseBurst(context, output, when + 0.045, 0.22, 260, 0.14);
      tone(context, output, when, 0.34, 82, 36, "sawtooth", 0.11);
      tone(context, output, when + 0.06, 0.24, 48, 28, "triangle", 0.09);
      noiseBurst(context, output, when + 0.18, 0.18, 1200, 0.045);
      break;

    case "fire":
      // Dragon fire: a hot ignition snap with a low rolling burn underneath.
      noiseBurst(context, output, when, 0.045, 5200, 0.2);
      noiseBurst(context, output, when + 0.025, 0.72, 580, 0.14);
      noiseBurst(context, output, when + 0.14, 0.48, 1450, 0.08);
      tone(context, output, when, 0.5, 124, 46, "sawtooth", 0.1);
      tone(context, output, when + 0.06, 0.34, 74, 38, "triangle", 0.07);
      break;

    case "fire-burst":
      // Flame Line ignition: a sharp whoomph with a broad hot front.
      noiseBurst(context, output, when, 0.035, 7600, 0.28);
      noiseBurst(context, output, when + 0.018, 0.34, 980, 0.2);
      noiseBurst(context, output, when + 0.07, 0.52, 420, 0.12);
      tone(context, output, when, 0.24, 92, 34, "sawtooth", 0.18);
      tone(context, output, when + 0.028, 0.2, 210, 58, "triangle", 0.08);
      break;

    case "burning":
      // Status burn: smaller ember crackles, kept short so repeated ticks layer cleanly.
      noiseBurst(context, output, when, 0.035, 4200, 0.08);
      noiseBurst(context, output, when + 0.04, 0.08, 1800, 0.055);
      noiseBurst(context, output, when + 0.11, 0.12, 820, 0.045);
      tone(context, output, when + 0.02, 0.16, 190, 82, "triangle", 0.035);
      break;

    case "flamethrower":
      // Deep sustained flamethrower: sub-pressure plus turbulent high fire.
      noiseBurst(context, output, when, 0.06, 6400, 0.16);
      noiseBurst(context, output, when + 0.03, 1.15, 620, 0.24);
      noiseBurst(context, output, when + 0.18, 0.95, 1350, 0.12);
      noiseBurst(context, output, when + 0.55, 0.62, 260, 0.14);
      tone(context, output, when, 1.05, 78, 42, "sawtooth", 0.18);
      tone(context, output, when + 0.08, 0.88, 46, 32, "triangle", 0.14);
      tone(context, output, when + 0.16, 0.7, 132, 66, "sawtooth", 0.06);
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
