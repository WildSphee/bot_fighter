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
  impactDamage: number;
  turnSpeed: number;
  rotationSpeed: number;
  arsenal: WeaponId[];
  movementProfile: MovementProfileId;
  palette: {
    body: string;
    trim: string;
    glow: string;
  };
};

export type MovementId =
  | "orbit"
  | "boost"
  | "backstep"
  | "strafe-left"
  | "strafe-right"
  | "hold"
  | "evade";

export type MovementProfileId =
  | "balanced"
  | "aggressive"
  | "evasive"
  | "stationary"
  | "flanker"
  | "charger";

export type MovementProfileMap = Record<MovementProfileId, WeightedDie<MovementId>[]>;

export type WeaponId =
  | "ray"
  | "missile"
  | "boomerang"
  | "blade"
  | "blast-rifle"
  | "shotgun"
  | "mine"
  | "shield"
  | "emp"
  | "railgun"
  | "rocket"
  | "flash-bloom"
  | "thorn-minions"
  | "gold-flask"
  | "transmutation-circle";

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
  // Seconds between movement rolls and weapon rolls (tunable from Setup).
  moveInterval: number;
  weaponInterval: number;
  // Passive 0..1 pull that draws bots (not projectiles) toward arena center.
  centerGravity: number;
  arena: ArenaConfig;
  classes: RobotClass[];
  movementProfiles: MovementProfileMap;
  weapons: WeaponDefinition[];
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
  velocity: Vec2;
  radius: number;
  age: number;
};

export type EffectFrame = {
  id: string;
  type:
    | "hit"
    | "explosion"
    | "shield"
    | "emp"
    | "trail"
    | "beam"
    | "cone"
    | "muzzle"
    | "spark"
    | "mine"
    | "bit"
    | "blade"
    | "damage-text"
    | "telegraph"
    | "puddle"
    | "rock";
  position: Vec2;
  endPosition?: Vec2;
  velocity?: Vec2;
  weaponId?: WeaponId;
  radius: number;
  age: number;
  duration: number;
  color: string;
  label?: string;
  spin?: number;
  variant?: number;
};

export type FightFrame = {
  time: number;
  robots: RobotFrame[];
  projectiles: ProjectileFrame[];
  effects: EffectFrame[];
};

export type SoundEventType =
  | "boost"
  | "charge"
  | "laser"
  | "ray"
  | "boomerang"
  | "blade"
  | "blast-rifle"
  | "shotgun"
  | "mine"
  | "railgun"
  | "missile"
  | "rocket"
  | "impact"
  | "explosion"
  | "shield"
  | "shield-hit"
  | "shield-break"
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
      type: "collision";
      time: number;
      attackerId: string;
      targetId: string;
      damage: number;
    }
  | {
      type: "death";
      time: number;
      robotId: string;
      killerId?: string;
      sound: SoundEventType;
    }
  | {
      type: "sound";
      time: number;
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
