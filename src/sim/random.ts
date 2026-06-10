export type Rng = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: T[]) => T;
};

export function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed) || 0x6d2b79f5;

  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

export function weightedPick<T extends string>(
  rng: Rng,
  items: Array<{ id: T; weight: number }>
): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng.next() * total;

  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) {
      return item.id;
    }
  }

  return items[items.length - 1].id;
}
