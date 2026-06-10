import type {
  ArenaConfig,
  FightConfig,
  MovementId,
  RobotClass,
  RobotConfig,
  WeaponDefinition,
  WeaponId,
  WeightedDie,
} from "./types";

export const ARENAS: ArenaConfig[] = [
  {
    id: "neon-box",
    name: "Neon Box",
    width: 900,
    height: 1600,
    boundaryDamage: 4,
    drag: 0.91,
  },
];

export const ROBOT_CLASSES: RobotClass[] = [
  {
    id: "striker",
    name: "Striker",
    hp: 120,
    speed: 72,
    armor: 0.08,
    mass: 0.85,
    shield: 18,
  },
  {
    id: "bulwark",
    name: "Bulwark",
    hp: 165,
    speed: 48,
    armor: 0.18,
    mass: 1.25,
    shield: 26,
  },
  {
    id: "trickster",
    name: "Trickster",
    hp: 105,
    speed: 86,
    armor: 0.04,
    mass: 0.72,
    shield: 22,
  },
];

export const MOVEMENT_DICE: WeightedDie<MovementId>[] = [
  { id: "orbit", weight: 20 },
  { id: "boost", weight: 18 },
  { id: "backstep", weight: 13 },
  { id: "strafe-left", weight: 15 },
  { id: "strafe-right", weight: 15 },
  { id: "hold", weight: 7 },
  { id: "evade", weight: 12 },
];

export const WEAPONS: WeaponDefinition[] = [
  {
    id: "ray",
    name: "Ray Gun",
    kind: "instant",
    range: 620,
    damage: 13,
    projectileSpeed: 0,
    cooldown: 1.2,
    radius: 8,
    homing: 0,
    knockback: 24,
    rarity: "common",
    sound: "laser",
  },
  {
    id: "missile",
    name: "Homing Missile",
    kind: "projectile",
    range: 760,
    damage: 24,
    projectileSpeed: 360,
    cooldown: 2.2,
    radius: 18,
    homing: 0.12,
    knockback: 44,
    rarity: "uncommon",
    sound: "missile",
  },
  {
    id: "boomerang",
    name: "Boomerang Blade",
    kind: "projectile",
    range: 520,
    damage: 18,
    projectileSpeed: 235,
    cooldown: 1.7,
    radius: 14,
    homing: 0.025,
    knockback: 32,
    rarity: "uncommon",
    sound: "laser",
  },
  {
    id: "shotgun",
    name: "Shotgun Burst",
    kind: "instant",
    range: 360,
    damage: 21,
    projectileSpeed: 0,
    cooldown: 1.6,
    radius: 20,
    homing: 0,
    knockback: 54,
    rarity: "common",
    sound: "impact",
  },
  {
    id: "mine",
    name: "Mine Drop",
    kind: "field",
    range: 180,
    damage: 30,
    projectileSpeed: 0,
    cooldown: 2.8,
    radius: 34,
    homing: 0,
    knockback: 70,
    rarity: "rare",
    sound: "missile",
  },
  {
    id: "shield",
    name: "Energy Shield",
    kind: "defense",
    range: 0,
    damage: 0,
    projectileSpeed: 0,
    cooldown: 4.2,
    radius: 44,
    homing: 0,
    knockback: 0,
    rarity: "common",
    sound: "shield",
  },
  {
    id: "emp",
    name: "EMP Pulse",
    kind: "instant",
    range: 300,
    damage: 16,
    projectileSpeed: 0,
    cooldown: 3.4,
    radius: 72,
    homing: 0,
    knockback: 22,
    rarity: "rare",
    sound: "emp",
  },
  {
    id: "railgun",
    name: "Railgun",
    kind: "instant",
    range: 820,
    damage: 32,
    projectileSpeed: 0,
    cooldown: 3,
    radius: 10,
    homing: 0,
    knockback: 88,
    rarity: "rare",
    sound: "laser",
  },
];

export const DEFAULT_ROBOTS: RobotConfig[] = [
  {
    id: "nova",
    name: "Nova",
    classId: "striker",
    teamId: "red",
    palette: {
      body: "#ef4f64",
      trim: "#242a35",
      glow: "#ffd166",
    },
    arsenal: ["ray", "missile", "shotgun", "shield"],
    movementDice: MOVEMENT_DICE,
    weaponDice: [
      { id: "ray", weight: 28 },
      { id: "missile", weight: 20 },
      { id: "shotgun", weight: 18 },
      { id: "shield", weight: 10 },
    ],
  },
  {
    id: "bolt",
    name: "Bolt",
    classId: "trickster",
    teamId: "blue",
    palette: {
      body: "#2d9cdb",
      trim: "#1d2a2f",
      glow: "#7ef7c7",
    },
    arsenal: ["ray", "boomerang", "emp", "railgun"],
    movementDice: MOVEMENT_DICE,
    weaponDice: [
      { id: "ray", weight: 24 },
      { id: "boomerang", weight: 21 },
      { id: "emp", weight: 13 },
      { id: "railgun", weight: 10 },
    ],
  },
];

export function createDefaultFightConfig(seed = "bot-fighter-001"): FightConfig {
  return {
    seed,
    mode: "duel",
    maxDuration: 45,
    tickRate: 60,
    previewFps: 30,
    arena: ARENAS[0],
    robots: DEFAULT_ROBOTS,
  };
}

export function getClass(classId: string): RobotClass {
  return ROBOT_CLASSES.find((robotClass) => robotClass.id === classId) ?? ROBOT_CLASSES[0];
}

export function getWeapon(weaponId: WeaponId): WeaponDefinition {
  return WEAPONS.find((weapon) => weapon.id === weaponId) ?? WEAPONS[0];
}
