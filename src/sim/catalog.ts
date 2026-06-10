import type {
  ArenaConfig,
  FightConfig,
  MovementId,
  MovementProfileId,
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
    arsenal: ["ray", "missile", "shotgun", "shield"],
    movementProfile: "aggressive",
    palette: {
      body: "#ef4f64",
      trim: "#242a35",
      glow: "#ffd166",
    },
  },
  {
    id: "bulwark",
    name: "Bulwark",
    hp: 165,
    speed: 48,
    armor: 0.18,
    mass: 1.25,
    shield: 26,
    arsenal: ["ray", "mine", "shield", "railgun"],
    movementProfile: "balanced",
    palette: {
      body: "#8b5cf6",
      trim: "#1d2330",
      glow: "#ffdd78",
    },
  },
  {
    id: "trickster",
    name: "Trickster",
    hp: 105,
    speed: 86,
    armor: 0.04,
    mass: 0.72,
    shield: 22,
    arsenal: ["ray", "boomerang", "emp", "railgun"],
    movementProfile: "evasive",
    palette: {
      body: "#2d9cdb",
      trim: "#1d2a2f",
      glow: "#7ef7c7",
    },
  },
];

export const MOVEMENT_PROFILES: Record<MovementProfileId, WeightedDie<MovementId>[]> = {
  balanced: [
    { id: "orbit", weight: 1 },
    { id: "boost", weight: 1 },
    { id: "backstep", weight: 1 },
    { id: "strafe-left", weight: 1 },
    { id: "strafe-right", weight: 1 },
    { id: "hold", weight: 1 },
    { id: "evade", weight: 1 },
  ],
  aggressive: [
    { id: "boost", weight: 1 },
    { id: "boost", weight: 1 },
    { id: "orbit", weight: 1 },
    { id: "strafe-left", weight: 1 },
    { id: "strafe-right", weight: 1 },
    { id: "hold", weight: 1 },
  ],
  evasive: [
    { id: "backstep", weight: 1 },
    { id: "backstep", weight: 1 },
    { id: "evade", weight: 1 },
    { id: "orbit", weight: 1 },
    { id: "strafe-left", weight: 1 },
    { id: "strafe-right", weight: 1 },
  ],
};

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
  createRobotFromClass("striker", 0),
  createRobotFromClass("trickster", 1),
];

export function createDefaultFightConfig(seed = "bot-fighter-001"): FightConfig {
  return {
    seed,
    mode: "duel",
    maxDuration: 45,
    tickRate: 60,
    previewFps: 30,
    arena: ARENAS[0],
    classes: ROBOT_CLASSES,
    robots: DEFAULT_ROBOTS,
  };
}

export function getClass(classId: string, classes = ROBOT_CLASSES): RobotClass {
  return classes.find((robotClass) => robotClass.id === classId) ?? classes[0] ?? ROBOT_CLASSES[0];
}

export function getWeapon(weaponId: WeaponId): WeaponDefinition {
  return WEAPONS.find((weapon) => weapon.id === weaponId) ?? WEAPONS[0];
}

export function createMovementDice(profile: MovementProfileId): WeightedDie<MovementId>[] {
  return MOVEMENT_PROFILES[profile].map((die) => ({ ...die }));
}

export function createWeaponDice(arsenal: WeaponId[]): WeightedDie<WeaponId>[] {
  return arsenal.map((weaponId) => ({ id: weaponId, weight: 1 }));
}

export function createRobotFromClass(
  classId: string,
  index: number,
  classes = ROBOT_CLASSES
): RobotConfig {
  const robotClass = getClass(classId, classes);

  return {
    id: `${robotClass.id}-${index + 1}`,
    name: robotClass.name,
    classId: robotClass.id,
    teamId: `team-${index + 1}`,
    palette: { ...robotClass.palette },
    arsenal: [...robotClass.arsenal],
    movementDice: createMovementDice(robotClass.movementProfile),
    weaponDice: createWeaponDice(robotClass.arsenal),
  };
}

export function syncRobotWithClass(
  robot: RobotConfig,
  classes = ROBOT_CLASSES,
  index = 0
): RobotConfig {
  const robotClass = getClass(robot.classId, classes);

  return {
    ...robot,
    name: robotClass.name,
    teamId: robot.teamId || `team-${index + 1}`,
    palette: { ...robotClass.palette },
    arsenal: [...robotClass.arsenal],
    movementDice: createMovementDice(robotClass.movementProfile),
    weaponDice: createWeaponDice(robotClass.arsenal),
  };
}
