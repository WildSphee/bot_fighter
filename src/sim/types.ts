export type Vec2 = {
  x: number;
  y: number;
};

export type ArenaConfig = {
  id: string;
  name: string;
  width: number;
  height: number;
  boundaryDamage: number;
  drag: number;
};

export type RobotClass = {
  id: string;
  name: string;
  hp: number;
  speed: number;
  armor: number;
  mass: number;
  shield: number;
};

export type MovementId =
  | "orbit"
  | "boost"
  | "backstep"
  | "strafe-left"
  | "strafe-right"
  | "hold"
  | "evade";

export type WeaponId =
  | "ray"
  | "missile"
  | "boomerang"
  | "shotgun"
  | "mine"
  | "shield"
  | "emp"
  | "railgun";

export type WeightedDie<T extends string> = {
  id: T;
  weight: number;
};

export type WeaponDefinition = {
  id: WeaponId;
  name: string;
  kind: "instant" | "projectile" | "field" | "defense";
  range: number;
  damage: number;
  projectileSpeed: number;
  cooldown: number;
  radius: number;
  homing: number;
  knockback: number;
  rarity: "common" | "uncommon" | "rare";
  sound: SoundEventType;
};

export type RobotConfig = {
  id: string;
  name: string;
  classId: string;
  teamId: string;
  palette: {
    body: string;
    trim: string;
    glow: string;
  };
  arsenal: WeaponId[];
  movementDice: WeightedDie<MovementId>[];
  weaponDice: WeightedDie<WeaponId>[];
};

export type FightConfig = {
  seed: string;
  mode: "duel" | "team" | "free-for-all";
  maxDuration: number;
  tickRate: number;
  previewFps: number;
  arena: ArenaConfig;
  robots: RobotConfig[];
};

export type RobotFrame = {
  id: string;
  name: string;
  teamId: string;
  classId: string;
  palette: RobotConfig["palette"];
  position: Vec2;
  velocity: Vec2;
  angle: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  alive: boolean;
  lastMove: MovementId;
  lastWeapon?: WeaponId;
};

export type ProjectileFrame = {
  id: string;
  ownerId: string;
  weaponId: WeaponId;
  position: Vec2;
  radius: number;
  age: number;
};

export type EffectFrame = {
  id: string;
  type: "hit" | "explosion" | "shield" | "emp" | "trail";
  position: Vec2;
  radius: number;
  age: number;
  duration: number;
  color: string;
};

export type FightFrame = {
  time: number;
  robots: RobotFrame[];
  projectiles: ProjectileFrame[];
  effects: EffectFrame[];
};

export type SoundEventType =
  | "boost"
  | "laser"
  | "missile"
  | "impact"
  | "explosion"
  | "shield"
  | "emp"
  | "winner";

export type FightEvent =
  | {
      type: "movement";
      time: number;
      robotId: string;
      movement: MovementId;
      roll: number;
      rollTotal: number;
    }
  | {
      type: "weapon";
      time: number;
      robotId: string;
      targetId?: string;
      weaponId: WeaponId;
      roll: number;
      rollTotal: number;
      sound: SoundEventType;
    }
  | {
      type: "hit";
      time: number;
      attackerId: string;
      targetId: string;
      weaponId: WeaponId;
      damage: number;
      sound: SoundEventType;
    }
  | {
      type: "death";
      time: number;
      robotId: string;
      killerId?: string;
      sound: SoundEventType;
    }
  | {
      type: "winner";
      time: number;
      winnerId?: string;
      reason: "knockout" | "hp" | "damage";
      sound: SoundEventType;
    };

export type FightResult = {
  config: FightConfig;
  frames: FightFrame[];
  events: FightEvent[];
  winnerId?: string;
  duration: number;
  damageByRobot: Record<string, number>;
};
