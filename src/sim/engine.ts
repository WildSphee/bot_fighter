import { cloneWeapons, createMovementDice, createWeaponDice, getClass, getWeapon, getWeaponFrom } from "./catalog";
import { createRng, weightedRoll } from "./random";
import type {
  EffectFrame,
  FightConfig,
  FightEvent,
  FightFrame,
  FightResult,
  MovementId,
  ProjectileFrame,
  RobotConfig,
  RobotFrame,
  Vec2,
  WeaponDefinition,
  WeaponId,
  RobotClass,
} from "./types";
import { add, angleTo, clamp, distance, mul, normalize, rotate90, sub, ZERO } from "./vector";

type RobotState = RobotFrame & {
  arsenal: RobotConfig["arsenal"];
  movementDice: RobotConfig["movementDice"];
  weaponDice: RobotConfig["weaponDice"];
  classProfile: RobotClass;
  damageDone: number;
  nextMoveAt: number;
  nextWeaponAt: number;
  cooldowns: Partial<Record<WeaponId, number>>;
  intent: MovementId;
  moveDeviation: number;
  lastCollisionAt: number;
  lastDamagedAt: number;
};

type ProjectileState = ProjectileFrame & {
  velocity: Vec2;
  damage: number;
  radius: number;
  expiresAt: number;
  targetId?: string;
  homing: number;
  knockback: number;
  curve: number;
  lastTrailAt: number;
  acceleration: number;
  explosive: boolean;
  explosionRadius: number;
  hitRobotIds?: Set<string>;
  ellipse?: {
    origin: Vec2;
    axis: Vec2; // unit vector along the aim direction (major axis)
    side: Vec2; // unit perpendicular (minor axis), already signed by spin
    major: number;
    minor: number;
    omega: number;
    secondScale: number; // size multiplier applied to the 2nd loop
  };
};

type PendingStrike = {
  id: string;
  weapon: WeaponDefinition;
  attackerId: string;
  targetId: string;
  aimPosition: Vec2;
  createdAt: number;
  lockedAt: number;
  resolvesAt: number;
};

type BladeSwingState = {
  id: string;
  attackerId: string;
  weapon: WeaponDefinition;
  startedAt: number;
  swingStartAt: number;
  expiresAt: number;
  hitRobotIds: Set<string>;
};

type PendingShot = {
  id: string;
  weapon: WeaponDefinition;
  attackerId: string;
  targetId: string;
  fireAt: number;
  angleOffset: number;
};

type MineState = {
  id: string;
  ownerId: string;
  origin: Vec2;
  position: Vec2;
  damage: number;
  explosionRadius: number;
  triggerRadius: number;
  knockback: number;
  thrownAt: number;
  landAt: number;
  armAt: number;
  expiresAt: number;
};

const ROBOT_RADIUS = 36;
const WINNER_SCREEN_SECONDS = 2;
const RAILGUN_BEAM_LENGTH = 2600;
const ROCKET_ACCELERATION = 3.1;
const ROCKET_MAX_SPEED = 1500;
const COLLISION_DAMAGE_COOLDOWN = 0.45;
const KNOCKBACK_MULTIPLIER = 2.1;
const SHOOTER_RECOIL_MULTIPLIER = 0.23;
const EMP_RADIUS_MULTIPLIER = 1;
// Default cadences (seconds) when a config doesn't specify them. The movement
// slot and weapon list pick on these fixed beats so the on-screen reels stay in
// sync with what actually executes.
const MOVE_INTERVAL = 1;
const WEAPON_INTERVAL = 2;
// Full-strength acceleration (units/s of velocity) for the passive center pull
// at centerGravity = 1. Kept low so the drift stays subtle.
const CENTER_GRAVITY_ACCEL = 26;
// Railgun charge sequence (telegraph -> lock -> beam). The weapon roll pauses
// until the whole sequence is over instead of rolling again mid-charge.
const RAILGUN_CHARGE_SECONDS = 1;
const RAILGUN_RESOLVE_SECONDS = 0.3;
const RAILGUN_PAUSE_BUFFER = 0.5;
const BLADE_HOLD_SECONDS = 1;
// Swing twice as fast as before, then leave the blade hanging in its finished
// pose for a moment before it fades out.
const BLADE_SWING_SECONDS = 0.205;
const BLADE_LINGER_SECONDS = 0.2;
const BLAST_RIFLE_SHOT_INTERVAL = 0.03;
const SHIELD_REGEN_DELAY_SECONDS = 2;

export function simulateFight(config: FightConfig): FightResult {
  const rng = createRng(`${config.seed}:${config.robots.map((robot) => robot.id).join("|")}`);
  const weapons = config.weapons?.length ? config.weapons : cloneWeapons();
  const robots = createInitialRobots(config);
  const projectiles: ProjectileState[] = [];
  const pendingStrikes: PendingStrike[] = [];
  const bladeSwings: BladeSwingState[] = [];
  const pendingShots: PendingShot[] = [];
  const mines: MineState[] = [];
  const effects: EffectFrame[] = [];
  const frames: FightFrame[] = [];
  const events: FightEvent[] = [];
  const damageByRobot: Record<string, number> = Object.fromEntries(
    config.robots.map((robot) => [robot.id, 0])
  );
  const tickStep = 1 / config.tickRate;
  const frameStep = 1 / config.previewFps;
  const moveInterval = config.moveInterval ?? MOVE_INTERVAL;
  const weaponInterval = config.weaponInterval ?? WEAPON_INTERVAL;
  let nextFrameAt = 0;
  let winnerId: string | undefined;
  let winnerReason: "knockout" | "hp" | "damage" = "hp";
  let deathTime: number | undefined;

  for (let tick = 0; tick <= config.maxDuration * config.tickRate; tick += 1) {
    const time = Number((tick * tickStep).toFixed(4));
    const alive = robots.filter((robot) => robot.alive);

    if (alive.length <= 1 && deathTime === undefined) {
      winnerId = alive[0]?.id;
      winnerReason = "knockout";
      deathTime = time;
      events.push({
        type: "winner",
        time,
        winnerId,
        reason: winnerReason,
        sound: "winner",
      });
    }

    if (deathTime !== undefined && time >= deathTime + WINNER_SCREEN_SECONDS) {
      pruneEffects(effects, deathTime + (time - deathTime) * 0.5);
      captureFrame(time, robots, projectiles, effects, pendingStrikes, bladeSwings, mines, frames);
      break;
    }

    if (deathTime === undefined) {
      for (const robot of robots) {
        if (!robot.alive) {
          continue;
        }

        const target = selectTarget(robot, robots, config.mode);
        if (!target) {
          continue;
        }

        if (time >= robot.nextMoveAt) {
          const movementRoll = weightedRoll(rng, robot.movementDice);
          robot.intent = movementRoll.id;
          robot.moveDeviation = ((rng.next() * 20 - 10) * Math.PI) / 180;
          robot.lastMove = robot.intent;
          robot.nextMoveAt = time + moveInterval;
          events.push({
            type: "movement",
            time,
            robotId: robot.id,
            movement: robot.intent,
            roll: movementRoll.roll,
            rollTotal: movementRoll.total,
          });
        }

        applyMovement(robot, target, config, tickStep);

        if (time >= robot.nextWeaponAt) {
          // Only roll among weapons that are off cooldown, so the picked action
          // can always execute on its 2-second beat.
          const ready = robot.weaponDice.filter(
            (die) => robot.arsenal.includes(die.id) && (robot.cooldowns[die.id] ?? 0) <= time
          );

          if (ready.length === 0) {
            // Everything is still cooling down; check back shortly.
            robot.nextWeaponAt = time + 0.2;
          } else {
            const weaponRoll = weightedRoll(rng, ready);
            const weaponId = weaponRoll.id;
            const weapon = getWeaponFrom(weapons, weaponId);

            fireWeapon({
              weapon,
              attacker: robot,
              target,
              time,
              roll: weaponRoll.roll,
              rollTotal: weaponRoll.total,
              rngNext: rng.next,
              projectiles,
              pendingStrikes,
              bladeSwings,
              pendingShots,
              mines,
              arena: config.arena,
              effects,
              events,
              robots,
              damageByRobot,
            });
            robot.lastWeapon = weaponId;
            robot.cooldowns[weaponId] = time + weapon.cooldown;
            // Railgun pauses the roll until its charge + strike resolves;
            // everything else advances on the steady 2-second beat.
            robot.nextWeaponAt =
              weaponId === "railgun"
                ? time + RAILGUN_CHARGE_SECONDS + RAILGUN_RESOLVE_SECONDS + RAILGUN_PAUSE_BUFFER
                : time + weaponInterval;
          }
        }
      }

      for (const robot of robots) {
        integrateRobot(robot, config, tickStep);
      }

      resolveRobotCollisions(robots, effects, events, damageByRobot, time);
      updatePendingStrikes(pendingStrikes, robots, effects, events, damageByRobot, time);
      updatePendingShots(pendingShots, robots, projectiles, effects, time);
      updateBladeSwings(bladeSwings, robots, projectiles, effects, events, damageByRobot, time);
      updateProjectiles(projectiles, robots, config.arena, effects, events, damageByRobot, time, tickStep);
      updateMines(mines, robots, effects, events, damageByRobot, time);
      rechargeShields(robots, tickStep, time);
      pruneEffects(effects, time);
    } else {
      const slowTime = deathTime + (time - deathTime) * 0.5;
      const slowStep = tickStep * 0.5;
      for (const robot of robots) {
        integrateRobot(robot, config, slowStep);
      }
      updateProjectileVisuals(projectiles, effects, slowTime, slowStep);
      pruneEffects(effects, slowTime);
    }

    if (time + 0.0001 >= nextFrameAt) {
      captureFrame(time, robots, projectiles, effects, pendingStrikes, bladeSwings, mines, frames);
      nextFrameAt += frameStep;
    }
  }

  if (!events.some((event) => event.type === "winner")) {
    winnerId = chooseWinnerByScore(robots);
    winnerReason = "hp";
    const time = config.maxDuration;
    events.push({ type: "winner", time, winnerId, reason: winnerReason, sound: "winner" });
    for (let holdTime = time; holdTime <= time + WINNER_SCREEN_SECONDS + 0.0001; holdTime += frameStep) {
      pruneEffects(effects, holdTime);
      captureFrame(Number(holdTime.toFixed(4)), robots, projectiles, effects, pendingStrikes, bladeSwings, mines, frames);
    }
  }

  return {
    config,
    frames,
    events,
    winnerId,
    duration: frames[frames.length - 1]?.time ?? config.maxDuration,
    damageByRobot,
  };
}

function createInitialRobots(config: FightConfig): RobotState[] {
  const center = { x: config.arena.width / 2, y: config.arena.height / 2 };
  const radius = Math.min(config.arena.width, config.arena.height) * 0.3;

  return config.robots.map((robot, index) => {
    const robotClass = getClass(robot.classId, config.classes);
    const angle = (Math.PI * 2 * index) / config.robots.length - Math.PI / 2;
    const position = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
    const initialDirection = normalize(
      add(
        mul(normalize(sub(center, position)), 0.65),
        mul(rotate90(normalize(sub(center, position)), index % 2 === 0 ? 1 : -1), 0.35)
      )
    );

    return {
      ...robot,
      name: robotClass.name,
      palette: { ...robotClass.palette },
      arsenal: [...robotClass.arsenal],
      movementDice: createMovementDice(robotClass.movementProfile, config.movementProfiles),
      weaponDice: createWeaponDice(robotClass.arsenal),
      position,
      velocity: mul(initialDirection, robotClass.speed * 0.42),
      angle,
      hp: robotClass.hp,
      maxHp: robotClass.hp,
      shield: robotClass.shield,
      maxShield: robotClass.shield,
      alive: true,
      lastMove: "hold",
      damageDone: 0,
      classProfile: robotClass,
      nextMoveAt: 0,
      nextWeaponAt: 0.35 + index * 0.2,
      cooldowns: {},
      intent: "hold",
      moveDeviation: ((index % 2 === 0 ? 7 : -7) * Math.PI) / 180,
      lastCollisionAt: -1,
      lastDamagedAt: -Infinity,
    };
  });
}

function selectTarget(
  robot: RobotState,
  robots: RobotState[],
  mode: FightConfig["mode"]
): RobotState | undefined {
  return robots
    .filter((target) => {
      if (!target.alive || target.id === robot.id) {
        return false;
      }

      return mode === "free-for-all" || target.teamId !== robot.teamId;
    })
    .sort((left, right) => distance(robot.position, left.position) - distance(robot.position, right.position))[0];
}

function applyMovement(
  robot: RobotState,
  target: RobotState,
  config: FightConfig,
  dt: number
) {
  const robotClass = robot.classProfile;
  const toward = normalize(sub(target.position, robot.position));
  const sideMultiplier = robot.intent === "strafe-left" ? 1 : -1;
  const side = rotate90(toward, sideMultiplier);
  const boundaryVector = normalize(
    sub({ x: config.arena.width / 2, y: config.arena.height / 2 }, robot.position)
  );

  const movementVector: Record<MovementId, Vec2> = {
    orbit: normalize(add(mul(toward, 0.25), side)),
    boost: toward,
    backstep: mul(toward, -1),
    "strafe-left": side,
    "strafe-right": side,
    hold: { x: 0, y: 0 },
    evade: normalize(add(mul(toward, -0.45), side)),
  };

  const nearWall =
    robot.position.x < 90 ||
    robot.position.y < 90 ||
    robot.position.x > config.arena.width - 90 ||
    robot.position.y > config.arena.height - 90;
  const vector = rotateVector(nearWall ? boundaryVector : movementVector[robot.intent], robot.moveDeviation);
  robot.velocity = add(robot.velocity, mul(vector, robotClass.speed * dt));
  const turnSpeed = Number.isFinite(robotClass.turnSpeed) ? robotClass.turnSpeed : 3;
  const rotFactor = Number.isFinite(robotClass.rotationSpeed) ? robotClass.rotationSpeed : 1;
  robot.angle = turnToward(robot.angle, angleTo(robot.position, target.position), turnSpeed * dt * rotFactor);
}

function turnToward(current: number, desired: number, maxStep: number): number {
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const step = clamp(delta, -maxStep, maxStep);
  return current + step;
}

function integrateRobot(robot: RobotState, config: FightConfig, dt: number) {
  const robotClass = robot.classProfile;

  // Passive center gravity: a gentle pull toward the arena middle layered on top
  // of the bot's own movement. Affects bots only — never projectiles.
  const pull = config.centerGravity ?? 0;
  if (pull > 0) {
    const center = { x: config.arena.width / 2, y: config.arena.height / 2 };
    const toward = normalize(sub(center, robot.position));
    robot.velocity = add(robot.velocity, mul(toward, pull * CENTER_GRAVITY_ACCEL * dt));
  }

  robot.velocity = mul(robot.velocity, config.arena.drag);
  robot.position = add(robot.position, mul(robot.velocity, dt * 60));

  const minX = ROBOT_RADIUS;
  const minY = ROBOT_RADIUS;
  const maxX = config.arena.width - ROBOT_RADIUS;
  const maxY = config.arena.height - ROBOT_RADIUS;
  const clampedX = clamp(robot.position.x, minX, maxX);
  const clampedY = clamp(robot.position.y, minY, maxY);

  if (clampedX !== robot.position.x) {
    robot.velocity.x *= -0.8 / robotClass.mass;
  }

  if (clampedY !== robot.position.y) {
    robot.velocity.y *= -0.8 / robotClass.mass;
  }

  robot.position = { x: clampedX, y: clampedY };
}

function resolveRobotCollisions(
  robots: RobotState[],
  effects: EffectFrame[],
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  time: number
) {
  for (let leftIndex = 0; leftIndex < robots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < robots.length; rightIndex += 1) {
      const left = robots[leftIndex];
      const right = robots[rightIndex];

      if (!left.alive || !right.alive) {
        continue;
      }

      const delta = sub(right.position, left.position);
      const gap = distance(left.position, right.position);
      const minGap = ROBOT_RADIUS * 2;

      if (gap <= 0.001 || gap >= minGap) {
        continue;
      }

      const normal = normalize(delta);
      const overlap = minGap - gap;
      const leftClass = left.classProfile;
      const rightClass = right.classProfile;
      const totalMass = leftClass.mass + rightClass.mass;

      left.position = add(left.position, mul(normal, (-overlap * rightClass.mass) / totalMass));
      right.position = add(right.position, mul(normal, (overlap * leftClass.mass) / totalMass));

      const relativeVelocity = sub(right.velocity, left.velocity);
      const impactSpeed = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y;

      if (impactSpeed < 0) {
        const impulse = (-(2.2) * impactSpeed) / (1 / leftClass.mass + 1 / rightClass.mass);
        left.velocity = add(left.velocity, mul(normal, -impulse / leftClass.mass));
        right.velocity = add(right.velocity, mul(normal, impulse / rightClass.mass));

        const hardEnough = -impactSpeed > 0.9;
        const ready =
          time - left.lastCollisionAt >= COLLISION_DAMAGE_COOLDOWN &&
          time - right.lastCollisionAt >= COLLISION_DAMAGE_COOLDOWN;
        if (hardEnough && ready) {
          const contact = add(left.position, mul(normal, ROBOT_RADIUS));
          const leftImpact = Number.isFinite(leftClass.impactDamage) ? leftClass.impactDamage : 0;
          const rightImpact = Number.isFinite(rightClass.impactDamage) ? rightClass.impactDamage : 0;
          applyCollisionDamage(left, right, leftImpact, time, events, damageByRobot, effects);
          applyCollisionDamage(right, left, rightImpact, time, events, damageByRobot, effects);
          effects.push(createEffect("spark", contact, 30, time, "#fff4cf"));
          left.lastCollisionAt = time;
          right.lastCollisionAt = time;
        }
      } else {
        left.velocity = add(left.velocity, mul(normal, -34 / leftClass.mass));
        right.velocity = add(right.velocity, mul(normal, 34 / rightClass.mass));
      }
    }
  }
}

function applyCollisionDamage(
  attacker: RobotState,
  target: RobotState,
  rawDamage: number,
  time: number,
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  effects: EffectFrame[]
) {
  if (rawDamage <= 0) {
    return;
  }

  const targetClass = target.classProfile;
  const shieldAbsorb = Math.min(target.shield, rawDamage * 0.6);
  target.shield -= shieldAbsorb;
  const damage = Math.max(1, (rawDamage - shieldAbsorb) * (1 - targetClass.armor));
  target.hp = Math.max(0, target.hp - damage);
  target.lastDamagedAt = time;
  attacker.damageDone += damage;
  damageByRobot[attacker.id] += damage;

  const direction = normalize(sub(target.position, attacker.position));
  events.push({ type: "sound", time, sound: "impact" });
  events.push({
    type: "collision",
    time,
    attackerId: attacker.id,
    targetId: target.id,
    damage: Number(damage.toFixed(2)),
  });
  addDamageToast(effects, target.position, damage, time);
  addDamageBits(effects, target.position, direction, target.palette, time, "ray", 5);

  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    effects.push(createEffect("explosion", target.position, 170, time, target.palette.glow));
    addDamageBits(effects, target.position, direction, target.palette, time, "ray", 40);
    events.push({ type: "death", time, robotId: target.id, killerId: attacker.id, sound: "explosion" });
  }
}

function fireWeapon(input: {
  weapon: WeaponDefinition;
  attacker: RobotState;
  target: RobotState;
  time: number;
  roll: number;
  rollTotal: number;
  rngNext: () => number;
  projectiles: ProjectileState[];
  pendingStrikes: PendingStrike[];
  bladeSwings: BladeSwingState[];
  pendingShots: PendingShot[];
  mines: MineState[];
  arena: FightConfig["arena"];
  effects: EffectFrame[];
  events: FightEvent[];
  robots: RobotState[];
  damageByRobot: Record<string, number>;
}): boolean {
  const {
    weapon,
    attacker,
    target,
    time,
    roll,
    rollTotal,
    rngNext,
    projectiles,
    pendingStrikes,
    bladeSwings,
    pendingShots,
    effects,
    events,
    damageByRobot,
  } = input;
  const targetDistance = distance(attacker.position, target.position);

  // Weapons fire along the bot's current facing, not straight at the target,
  // so the bot's (slow) rotation determines whether a shot actually connects.
  const direction = { x: Math.cos(attacker.angle), y: Math.sin(attacker.angle) };
  effects.push(
    createEffect("muzzle", add(attacker.position, mul(direction, ROBOT_RADIUS + 8)), weapon.radius + 16, time, attacker.palette.glow, {
      weaponId: weapon.id,
    })
  );

  events.push({
    type: "weapon",
    time,
    robotId: attacker.id,
    targetId: target.id,
    weaponId: weapon.id,
    roll,
    rollTotal,
    sound: weapon.sound,
  });

  if (weapon.kind === "defense") {
    attacker.shield = clamp(attacker.shield + 22.4, 0, attacker.maxShield + 34);
    effects.push(
      createEffect("shield", attacker.position, weapon.radius + 16, time, attacker.palette.glow, {
        weaponId: weapon.id,
      })
    );
    return true;
  }

  if (weapon.id === "rocket") {
    projectiles.push({
      id: `rocket-${attacker.id}-${time.toFixed(2)}`,
      ownerId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      position: add(attacker.position, mul(direction, ROBOT_RADIUS + 6)),
      velocity: mul(direction, weapon.projectileSpeed),
      damage: weapon.damage,
      radius: weapon.radius,
      homing: 0,
      knockback: weapon.knockback,
      curve: 0,
      lastTrailAt: time,
      age: 0,
      expiresAt: time + 5,
      acceleration: ROCKET_ACCELERATION,
      explosive: true,
      explosionRadius: weapon.radius + 78,
    });
    effects.push(
      createEffect("spark", add(attacker.position, mul(direction, ROBOT_RADIUS + 16)), weapon.radius + 20, time, "#ff8f4f", {
        weaponId: weapon.id,
      })
    );
    return true;
  }

  if (weapon.id === "boomerang") {
    // Fixed elliptical path: a big stretched loop elongated along the aim
    // direction. Traced parametrically so it closes back on the launch point.
    const spin = rngNext() > 0.5 ? 1 : -1;
    const period = 1.4; // seconds per loop
    const loops = 2;
    const major = 500; // forward reach (along aim)
    const minor = 260; // side width (perpendicular)
    const omega = (Math.PI * 2) / period;
    const start = add(attacker.position, mul(direction, ROBOT_RADIUS));
    projectiles.push({
      id: `boomerang-${attacker.id}-${time.toFixed(2)}`,
      ownerId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      position: { ...start },
      velocity: mul(direction, weapon.projectileSpeed),
      damage: weapon.damage,
      radius: weapon.radius,
      homing: 0,
      knockback: weapon.knockback,
      curve: 0,
      lastTrailAt: time,
      age: 0,
      expiresAt: time + period * loops,
      acceleration: 0,
      explosive: false,
      explosionRadius: 0,
      ellipse: {
        origin: start,
        axis: { ...direction },
        side: rotate90(direction, spin),
        major,
        minor,
        omega,
        secondScale: 0.55,
      },
    });
    effects.push(
      createEffect("spark", add(attacker.position, mul(direction, ROBOT_RADIUS + 18)), weapon.radius + 24, time, "#d7f8ff", {
        weaponId: weapon.id,
      })
    );
    return true;
  }

  if (weapon.id === "blade") {
    bladeSwings.push({
      id: `blade-${attacker.id}-${time.toFixed(2)}`,
      attackerId: attacker.id,
      weapon,
      startedAt: time,
      swingStartAt: time + BLADE_HOLD_SECONDS,
      expiresAt: time + BLADE_HOLD_SECONDS + BLADE_SWING_SECONDS + BLADE_LINGER_SECONDS,
      hitRobotIds: new Set(),
    });
    return true;
  }

  if (weapon.id === "blast-rifle") {
    for (let index = 0; index < 4; index += 1) {
      const spread = ((rngNext() * 27 - 13.5) * Math.PI) / 180;
      pendingShots.push({
        id: `blast-rifle-${attacker.id}-${time.toFixed(2)}-${index}`,
        weapon,
        attackerId: attacker.id,
        targetId: target.id,
        fireAt: time + index * BLAST_RIFLE_SHOT_INTERVAL,
        angleOffset: spread,
      });
    }
    return true;
  }

  if (weapon.kind === "projectile") {
    const arcSign = rngNext() > 0.5 ? 1 : -1;
    const side = rotate90(direction, arcSign);
    const arcStrength = weapon.id === "missile" ? 170 + rngNext() * 120 : 45;
    const speed = weapon.projectileSpeed * (weapon.id === "missile" ? 1.08 : 1);
    projectiles.push({
      id: `${weapon.id}-${attacker.id}-${time.toFixed(2)}`,
      ownerId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      position: add(attacker.position, mul(direction, ROBOT_RADIUS)),
      velocity: add(mul(direction, speed), mul(side, arcStrength)),
      damage: weapon.damage,
      radius: weapon.radius,
      homing: weapon.homing,
      knockback: weapon.knockback,
      curve: arcSign * (weapon.id === "missile" ? 235 : 65),
      lastTrailAt: time,
      age: 0,
      expiresAt: time + (weapon.id === "missile" ? 3 : 4.2),
      acceleration: 0,
      explosive: false,
      explosionRadius: 0,
    });
    effects.push(
      createEffect("spark", add(attacker.position, mul(direction, ROBOT_RADIUS + 18)), weapon.radius + 24, time, "#ffdd78", {
        weaponId: weapon.id,
      })
    );
    return true;
  }

  if (weapon.id === "shotgun") {
    const pelletCount = 7;
    // Keep the original total cone width (was 5 pellets * 8.5° steps = 34°).
    const spreadStepDeg = 34 / (pelletCount - 1);
    applyShooterKnockback(attacker, direction, weapon);
    for (let index = 0; index < pelletCount; index += 1) {
      const spread = ((index - (pelletCount - 1) / 2) * spreadStepDeg * Math.PI) / 180;
      const pelletDirection = rotateVector(direction, spread);
      projectiles.push({
        id: `shotgun-${attacker.id}-${time.toFixed(2)}-${index}`,
        ownerId: attacker.id,
        targetId: target.id,
        weaponId: weapon.id,
        position: add(attacker.position, mul(pelletDirection, ROBOT_RADIUS + 12)),
        // 2x pellet speed; shorter lifetime so total travel only grows ~20%.
        velocity: mul(pelletDirection, 2 * (620 + index * 18)),
        damage: weapon.damage / pelletCount,
        radius: 8,
        homing: 0,
        knockback: weapon.knockback / pelletCount,
        curve: 0,
        lastTrailAt: time,
        age: 0,
        expiresAt: time + 0.288,
        acceleration: 0,
        explosive: false,
        explosionRadius: 0,
        hitRobotIds: new Set(),
      });
    }
    effects.push(
      createEffect("spark", add(attacker.position, mul(direction, ROBOT_RADIUS + 22)), 36, time, "#ffd166", {
        weaponId: weapon.id,
      })
    );
    return true;
  }

  if (weapon.kind === "field") {
    // Toss the mine onto the ground a short distance ahead of the bot (in its
    // facing direction), then it arms over 1.5s before it can detonate.
    const tossDistance = 80 + rngNext() * 50;
    const landing = clampToArena(
      add(attacker.position, mul(direction, tossDistance)),
      input.arena,
      weapon.radius
    );
    const landAt = time + 0.4;
    input.mines.push({
      id: `mine-${attacker.id}-${time.toFixed(2)}`,
      ownerId: attacker.id,
      origin: { ...attacker.position },
      position: landing,
      damage: weapon.damage,
      // +50% blast so it covers the (also +50%) trigger radius — otherwise a bot
      // could trip the mine from outside the damage zone and take no damage.
      explosionRadius: (weapon.radius + 70) * 1.5,
      // +50% trigger radius so mines catch passing bots more reliably.
      triggerRadius: (weapon.radius + 24) * 1.5,
      knockback: weapon.knockback,
      thrownAt: time,
      landAt,
      armAt: landAt + 1.5,
      expiresAt: landAt + 1.5 + 14,
    });
    return true;
  }

  if (weapon.id === "railgun") {
    pendingStrikes.push({
      id: `railgun-${attacker.id}-${time.toFixed(2)}`,
      weapon,
      attackerId: attacker.id,
      targetId: target.id,
      aimPosition: { ...target.position },
      createdAt: time,
      lockedAt: time + RAILGUN_CHARGE_SECONDS,
      resolvesAt: time + RAILGUN_CHARGE_SECONDS + RAILGUN_RESOLVE_SECONDS,
    });
    return true;
  }

  if (weapon.id === "emp") {
    // EMP is an omnidirectional pulse around the bot; use the weapon.range
    // as the effective blast radius so range updates actually matter.
    const baseReach = Number.isFinite(weapon.range) ? weapon.range : weapon.radius + 96;
    const empReach = baseReach * EMP_RADIUS_MULTIPLIER;
    effects.push(
      createEffect("emp", attacker.position, empReach, time, "#a9fffd", {
        weaponId: weapon.id,
      })
    );
    addElectricParticles(effects, attacker.position, time, empReach);
    for (const robot of input.robots) {
      if (robot.id !== attacker.id && robot.alive && distance(robot.position, attacker.position) <= empReach) {
        applyDamage(attacker, robot, weapon, time, events, damageByRobot, effects);
        effects.push(
          createEffect("emp", robot.position, Math.min(120, empReach * 0.08), time, attacker.palette.glow, {
            weaponId: weapon.id,
          })
        );
      }
    }
    return true;
  }

  // Instant beam weapons (ray, etc.) fire straight along the bot's facing.
  const beamEnd = add(attacker.position, mul(direction, weapon.range));
  effects.push(
    createEffect("beam", attacker.position, 10, time, attacker.palette.glow, {
      endPosition: beamEnd,
      weaponId: weapon.id,
    })
  );

  const onLine =
    pointLineDistance(target.position, attacker.position, beamEnd) <= ROBOT_RADIUS + 10 &&
    targetDistance <= weapon.range;

  if (onLine) {
    applyDamage(attacker, target, weapon, time, events, damageByRobot, effects);
    effects.push(
      createEffect("hit", target.position, weapon.radius + 12, time, attacker.palette.glow, {
        weaponId: weapon.id,
      })
    );
  } else {
    effects.push(
      createEffect("spark", beamEnd, 18, time, attacker.palette.glow, {
        weaponId: weapon.id,
      })
    );
  }

  return true;
}

function updateProjectiles(
  projectiles: ProjectileState[],
  robots: RobotState[],
  arena: FightConfig["arena"],
  effects: EffectFrame[],
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  time: number,
  dt: number
) {
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    const owner = robots.find((robot) => robot.id === projectile.ownerId);
    const target = robots.find((robot) => robot.id === projectile.targetId);

    projectile.age += dt;

    if (projectile.acceleration > 0) {
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
      const nextSpeed = Math.min(ROCKET_MAX_SPEED, speed * (1 + projectile.acceleration * dt));
      if (speed > 0.001) {
        projectile.velocity = mul(projectile.velocity, nextSpeed / speed);
      }
    }

    if (projectile.ellipse) {
      // Follow a fixed stretched-circle path parametrically (boomerang). It
      // runs two loops; the second loop is smaller. Both loops pass through
      // the launch point at the seam (theta = 2pi), so the scale change is
      // seamless.
      const e = projectile.ellipse;
      const theta = projectile.age * e.omega;
      const loopScale = theta < Math.PI * 2 ? 1 : e.secondScale;
      const major = e.major * loopScale;
      const minor = e.minor * loopScale;
      const reach = major * (1 - Math.cos(theta));
      const swing = minor * Math.sin(theta);
      projectile.position = {
        x: e.origin.x + e.axis.x * reach + e.side.x * swing,
        y: e.origin.y + e.axis.y * reach + e.side.y * swing,
      };
      // Velocity (tangent) drives the rendered facing of the blade.
      projectile.velocity = {
        x: (e.axis.x * major * Math.sin(theta) + e.side.x * minor * Math.cos(theta)) * e.omega,
        y: (e.axis.y * major * Math.sin(theta) + e.side.y * minor * Math.cos(theta)) * e.omega,
      };
    } else {
      if (projectile.curve !== 0 && projectile.age < 1.15) {
        const side = rotate90(normalize(projectile.velocity), projectile.curve > 0 ? 1 : -1);
        projectile.velocity = add(
          projectile.velocity,
          mul(side, Math.abs(projectile.curve) * dt * (1 - projectile.age / 1.15))
        );
      }

      if (target?.alive && projectile.homing > 0) {
        const desired = normalize(sub(target.position, projectile.position));
        projectile.velocity = normalize(add(projectile.velocity, mul(desired, projectile.homing * 720)));
        projectile.velocity = mul(projectile.velocity, getWeapon(projectile.weaponId).projectileSpeed);
      }

      projectile.position = add(projectile.position, mul(projectile.velocity, dt));
    }

    if (time - projectile.lastTrailAt >= 0.045) {
      projectile.lastTrailAt = time;
      effects.push(
        createEffect(
          projectile.weaponId === "missile" ? "spark" : "trail",
          projectile.position,
          projectile.weaponId === "missile" ? projectile.radius + 8 : projectile.radius,
          time,
          projectile.weaponId === "missile" ? "#ff8f4f" : "#a9fffd",
          { weaponId: projectile.weaponId }
        )
      );
    }

    const hitWall =
      projectile.explosive &&
      (projectile.position.x <= projectile.radius ||
        projectile.position.y <= projectile.radius ||
        projectile.position.x >= arena.width - projectile.radius ||
        projectile.position.y >= arena.height - projectile.radius);

    if (hitWall) {
      detonateRocket(projectile, owner, robots, effects, events, damageByRobot, time);
      projectiles.splice(index, 1);
      continue;
    }

    const hitRobot = robots.find(
      (robot) =>
        robot.alive &&
        robot.id !== projectile.ownerId &&
        !projectile.hitRobotIds?.has(robot.id) &&
        distance(robot.position, projectile.position) <= projectile.radius + ROBOT_RADIUS
    );

    if (owner && hitRobot) {
      if (projectile.explosive) {
        detonateRocket(projectile, owner, robots, effects, events, damageByRobot, time);
      } else {
        const projectileWeapon = {
          ...getWeapon(projectile.weaponId),
          damage: projectile.damage,
          knockback: projectile.knockback,
        };
        applyDamage(owner, hitRobot, projectileWeapon, time, events, damageByRobot, effects, projectile.velocity);
        effects.push(
          createEffect(projectile.weaponId === "shotgun" ? "spark" : "explosion", projectile.position, projectile.radius + 32, time, owner.palette.glow, {
            weaponId: projectile.weaponId,
          })
        );
      }
      if (projectile.weaponId === "shotgun") {
        projectile.hitRobotIds?.add(hitRobot.id);
      } else {
        projectiles.splice(index, 1);
        continue;
      }
    }

    if (time >= projectile.expiresAt) {
      if (projectile.explosive) {
        detonateRocket(projectile, owner, robots, effects, events, damageByRobot, time);
      } else if (projectile.weaponId === "missile") {
        // Small flare puff when a homing missile burns out without a hit.
        effects.push(
          createEffect("muzzle", projectile.position, projectile.radius + 10, time, "#ff8f4f", {
            weaponId: "missile",
          })
        );
      }
      projectiles.splice(index, 1);
    }
  }
}

function detonateRocket(
  projectile: ProjectileState,
  owner: RobotState | undefined,
  robots: RobotState[],
  effects: EffectFrame[],
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  time: number
) {
  effects.push(
    createEffect("explosion", projectile.position, projectile.explosionRadius + 30, time, "#ff8f4f", {
      weaponId: "rocket",
    })
  );
  events.push({ type: "sound", time, sound: "explosion" });
  addDamageBits(effects, projectile.position, { x: 0, y: -1 }, { body: "#ff8f4f", trim: "#ffdd78", glow: "#ffffff" }, time, "rocket", 18);

  if (!owner) {
    return;
  }

  for (const robot of robots) {
    if (!robot.alive || robot.id === projectile.ownerId) {
      continue;
    }

    const gap = distance(robot.position, projectile.position);
    if (gap > projectile.explosionRadius) {
      continue;
    }

    const falloff = Math.max(0.4, 1 - gap / projectile.explosionRadius);
    const splashWeapon = {
      ...getWeapon("rocket"),
      damage: projectile.damage * falloff,
      knockback: projectile.knockback * falloff,
    };
    // Blast shoves each robot radially outward from the explosion centre.
    applyDamage(owner, robot, splashWeapon, time, events, damageByRobot, effects, sub(robot.position, projectile.position));
  }
}

function updateMines(
  mines: MineState[],
  robots: RobotState[],
  effects: EffectFrame[],
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  time: number
) {
  for (let index = mines.length - 1; index >= 0; index -= 1) {
    const mine = mines[index];
    const armed = time >= mine.armAt;

    let detonate = time >= mine.expiresAt;

    if (armed && !detonate) {
      detonate = robots.some(
        (robot) =>
          robot.alive &&
          robot.id !== mine.ownerId &&
          distance(robot.position, mine.position) <= mine.triggerRadius + ROBOT_RADIUS
      );
    }

    if (!detonate) {
      continue;
    }

    const owner = robots.find((robot) => robot.id === mine.ownerId);
    effects.push(
      createEffect("explosion", mine.position, mine.explosionRadius + 30, time, "#ff8f4f", {
        weaponId: "mine",
      })
    );
    events.push({ type: "sound", time, sound: "explosion" });
    addDamageBits(effects, mine.position, { x: 0, y: -1 }, { body: "#f6c85f", trim: "#ff8f4f", glow: "#ffffff" }, time, "mine", 16);

    if (owner) {
      for (const robot of robots) {
        if (!robot.alive || robot.id === mine.ownerId) {
          continue;
        }
        const gap = distance(robot.position, mine.position);
        if (gap > mine.explosionRadius) {
          continue;
        }
        const falloff = Math.max(0.45, 1 - gap / mine.explosionRadius);
        const splashWeapon = {
          ...getWeapon("mine"),
          damage: mine.damage * falloff,
          knockback: mine.knockback * falloff,
        };
        // Blast shoves each robot radially outward from the mine.
        applyDamage(owner, robot, splashWeapon, time, events, damageByRobot, effects, sub(robot.position, mine.position));
      }
    }

    mines.splice(index, 1);
  }
}

function clampToArena(point: Vec2, arena: FightConfig["arena"], margin: number): Vec2 {
  return {
    x: clamp(point.x, margin, arena.width - margin),
    y: clamp(point.y, margin, arena.height - margin),
  };
}

function updateProjectileVisuals(
  projectiles: ProjectileState[],
  effects: EffectFrame[],
  time: number,
  dt: number
) {
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    projectile.age += dt;
    projectile.position = add(projectile.position, mul(projectile.velocity, dt));

    if (time - projectile.lastTrailAt >= 0.06) {
      projectile.lastTrailAt = time;
      effects.push(
        createEffect(
          projectile.weaponId === "missile" ? "spark" : "trail",
          projectile.position,
          projectile.weaponId === "missile" ? projectile.radius + 8 : projectile.radius,
          time,
          projectile.weaponId === "missile" ? "#ff8f4f" : "#a9fffd",
          { weaponId: projectile.weaponId }
        )
      );
    }

    if (time >= projectile.expiresAt) {
      projectiles.splice(index, 1);
    }
  }
}

function applyDamage(
  attacker: RobotState,
  target: RobotState,
  weapon: WeaponDefinition,
  time: number,
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  effects: EffectFrame[],
  // The direction the hit actually travelled (projectile velocity, or the
  // outward blast vector for explosions). Knockback follows this so a rocket
  // hitting from behind shoves the target forward. Falls back to pushing the
  // target away from the attacker when no impact direction is supplied.
  impactDirection?: Vec2
) {
  const targetClass = target.classProfile;
  const shieldAbsorb = Math.min(target.shield, weapon.damage * 0.7);
  target.shield -= shieldAbsorb;
  const damage = Math.max(1, (weapon.damage - shieldAbsorb) * (1 - targetClass.armor));
  target.hp = Math.max(0, target.hp - damage);
  target.lastDamagedAt = time;
  attacker.damageDone += damage;
  damageByRobot[attacker.id] += damage;

  let direction = impactDirection ? normalize(impactDirection) : ZERO;
  if (direction.x === 0 && direction.y === 0) {
    direction = normalize(sub(target.position, attacker.position));
  }
  target.velocity = add(target.velocity, mul(direction, (weapon.knockback * KNOCKBACK_MULTIPLIER) / targetClass.mass));

  events.push({
    type: "hit",
    time,
    attackerId: attacker.id,
    targetId: target.id,
    weaponId: weapon.id,
    damage: Number(damage.toFixed(2)),
    sound: "impact",
  });
  addDamageToast(effects, target.position, damage, time);
  addDamageBits(effects, target.position, direction, target.palette, time, weapon.id, 7);

  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    effects.push(
      createEffect("explosion", target.position, 170, time, target.palette.glow, {
        weaponId: weapon.id,
      })
    );
    addDamageBits(effects, target.position, direction, target.palette, time, weapon.id, 40);
    events.push({
      type: "death",
      time,
      robotId: target.id,
      killerId: attacker.id,
      sound: "explosion",
    });
  }
}

function updatePendingStrikes(
  pendingStrikes: PendingStrike[],
  robots: RobotState[],
  effects: EffectFrame[],
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  time: number
) {
  for (let index = pendingStrikes.length - 1; index >= 0; index -= 1) {
    const strike = pendingStrikes[index];
    const attacker = robots.find((robot) => robot.id === strike.attackerId);
    const target = robots.find((robot) => robot.id === strike.targetId);

    if (time < strike.lockedAt) {
      if (target?.alive) {
        strike.aimPosition = { ...target.position };
      }
      continue;
    }

    if (time < strike.resolvesAt) {
      continue;
    }

    const startPosition = attacker?.position ?? strike.aimPosition;
    const fireDirection = attacker
      ? { x: Math.cos(attacker.angle), y: Math.sin(attacker.angle) }
      : normalize(sub(strike.aimPosition, startPosition));
    const endPosition = add(startPosition, mul(fireDirection, RAILGUN_BEAM_LENGTH));

    effects.push(
      createEffect("beam", startPosition, 30, time, "#36e0ff", {
        endPosition,
        weaponId: strike.weapon.id,
      })
    );
    events.push({ type: "sound", time, sound: "railgun" });
    if (attacker) {
      applyShooterKnockback(attacker, fireDirection, strike.weapon);
    }

    if (attacker && target?.alive && pointLineDistance(target.position, startPosition, endPosition) <= ROBOT_RADIUS + 8) {
      applyDamage(attacker, target, strike.weapon, time, events, damageByRobot, effects);
      effects.push(
        createEffect("hit", target.position, strike.weapon.radius + 18, time, attacker.palette.glow, {
          weaponId: strike.weapon.id,
        })
      );
    } else {
      effects.push(
        createEffect("spark", endPosition, 24, time, "#36e0ff", {
          weaponId: strike.weapon.id,
        })
      );
    }

    pendingStrikes.splice(index, 1);
  }
}

function updatePendingShots(
  pendingShots: PendingShot[],
  robots: RobotState[],
  projectiles: ProjectileState[],
  effects: EffectFrame[],
  time: number
) {
  for (let index = pendingShots.length - 1; index >= 0; index -= 1) {
    const shot = pendingShots[index];
    if (time < shot.fireAt) {
      continue;
    }

    const attacker = robots.find((robot) => robot.id === shot.attackerId);
    if (!attacker?.alive) {
      pendingShots.splice(index, 1);
      continue;
    }

    const direction = rotateVector({ x: Math.cos(attacker.angle), y: Math.sin(attacker.angle) }, shot.angleOffset);
    const side = rotate90(direction, shot.angleOffset > 0 ? 1 : -1);
    projectiles.push({
      id: shot.id,
      ownerId: attacker.id,
      targetId: shot.targetId,
      weaponId: shot.weapon.id,
      position: add(attacker.position, mul(direction, ROBOT_RADIUS + 10)),
      velocity: add(mul(direction, shot.weapon.projectileSpeed), mul(side, 42)),
      damage: shot.weapon.damage,
      radius: shot.weapon.radius,
      homing: 0,
      knockback: shot.weapon.knockback,
      curve: 0,
      lastTrailAt: time,
      age: 0,
      expiresAt: time + 3.2,
      acceleration: 0,
      explosive: false,
      explosionRadius: 0,
    });
    effects.push(
      createEffect("muzzle", add(attacker.position, mul(direction, ROBOT_RADIUS + 18)), shot.weapon.radius + 18, time, "#2bbcff", {
        weaponId: shot.weapon.id,
      })
    );
    pendingShots.splice(index, 1);
  }
}

function updateBladeSwings(
  bladeSwings: BladeSwingState[],
  robots: RobotState[],
  projectiles: ProjectileState[],
  effects: EffectFrame[],
  events: FightEvent[],
  damageByRobot: Record<string, number>,
  time: number
) {
  for (let index = bladeSwings.length - 1; index >= 0; index -= 1) {
    const swing = bladeSwings[index];
    if (time >= swing.expiresAt) {
      bladeSwings.splice(index, 1);
      continue;
    }

    if (time < swing.swingStartAt) {
      continue;
    }

    const attacker = robots.find((robot) => robot.id === swing.attackerId);
    if (!attacker?.alive) {
      bladeSwings.splice(index, 1);
      continue;
    }

    // Once the swing finishes the blade only lingers visually — stop dealing
    // damage and deflecting projectiles during that tail.
    if (time > swing.swingStartAt + BLADE_SWING_SECONDS) {
      continue;
    }

    const bladeReach = swing.weapon.range;
    for (let projectileIndex = projectiles.length - 1; projectileIndex >= 0; projectileIndex -= 1) {
      const projectile = projectiles[projectileIndex];
      if (
        projectile.ownerId !== attacker.id &&
        distance(projectile.position, attacker.position) <= bladeReach + projectile.radius
      ) {
        effects.push(
          createEffect("spark", projectile.position, projectile.radius + 20, time, "#ff0055", {
            weaponId: swing.weapon.id,
          })
        );
        events.push({ type: "sound", time, sound: "shield-break" });
        projectiles.splice(projectileIndex, 1);
      }
    }

    for (const target of robots) {
      if (
        target.alive &&
        target.id !== attacker.id &&
        !swing.hitRobotIds.has(target.id) &&
        distance(target.position, attacker.position) <= bladeReach + ROBOT_RADIUS
      ) {
        swing.hitRobotIds.add(target.id);
        applyDamage(attacker, target, swing.weapon, time, events, damageByRobot, effects);
        effects.push(
          createEffect("hit", target.position, swing.weapon.radius * 0.36, time, "#ff0055", {
            weaponId: swing.weapon.id,
          })
        );
      }
    }
  }
}

function applyShooterKnockback(
  attacker: RobotState,
  fireDirection: Vec2,
  weapon: WeaponDefinition
) {
  const recoil = (weapon.knockback * KNOCKBACK_MULTIPLIER * SHOOTER_RECOIL_MULTIPLIER) / attacker.classProfile.mass;
  attacker.velocity = add(attacker.velocity, mul(normalize(fireDirection), -recoil));
}

function addDamageToast(
  effects: EffectFrame[],
  position: Vec2,
  damage: number,
  time: number
) {
  effects.push(
    createEffect("damage-text", position, 0, time, "#ffdd78", {
      label: `-${Math.max(1, Math.round(damage))}`,
    })
  );
}

function addDamageBits(
  effects: EffectFrame[],
  position: Vec2,
  impactDirection: Vec2,
  palette: RobotConfig["palette"],
  time: number,
  weaponId: WeaponId,
  count: number
) {
  const colors = [palette.body, palette.trim, palette.glow, "#ffffff"];
  const baseDirection = normalize(impactDirection);

  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.sin(index * 12.989 + time) * 0.32;
    const outward = normalize(
      add({ x: Math.cos(angle), y: Math.sin(angle) }, mul(baseDirection, 0.8))
    );
    const speed = count > 12 ? 170 + (index % 7) * 28 : 95 + (index % 5) * 18;
    const offset = mul(outward, 8 + (index % 4) * 4);

    effects.push(
      createEffect("bit", add(position, offset), 5 + (index % 4), time, colors[index % colors.length], {
        velocity: mul(outward, speed),
        weaponId,
        spin: (index % 2 === 0 ? 1 : -1) * (2.5 + index * 0.17),
        variant: index % 3,
      })
    );
  }
}

function addElectricParticles(
  effects: EffectFrame[],
  position: Vec2,
  time: number,
  radius: number
) {
  const colors = ["#a9fffd", "#7ef7c7", "#d7f8ff", "#ffffff", "#36e0ff"];
  const arcCount = 24;

  for (let index = 0; index < arcCount; index += 1) {
    const angle = (Math.PI * 2 * index) / arcCount + Math.sin(index * 9.17 + time) * 0.12;
    const reach = radius * (0.28 + (index % 5) * 0.11);
    const midReach = reach * (0.48 + (index % 4) * 0.08);
    const jitter = rotate90({ x: Math.cos(angle), y: Math.sin(angle) }, index % 2 === 0 ? 1 : -1);
    const middle = {
      x: position.x + Math.cos(angle) * midReach + jitter.x * (18 + (index % 3) * 10),
      y: position.y + Math.sin(angle) * midReach + jitter.y * (18 + (index % 3) * 10),
    };
    const tip = {
      x: position.x + Math.cos(angle) * reach,
      y: position.y + Math.sin(angle) * reach,
    };
    effects.push(
      createEffect("beam", position, index % 3 === 0 ? 6 : 4, time, colors[index % colors.length], {
        endPosition: middle,
        weaponId: "emp",
      })
    );
    effects.push(
      createEffect("beam", middle, index % 3 === 0 ? 5 : 3, time, colors[(index + 2) % colors.length], {
        endPosition: tip,
        weaponId: "emp",
      })
    );
    effects.push(
      createEffect("bit", tip, 5 + (index % 4), time, colors[index % colors.length], {
        velocity: { x: Math.cos(angle) * (190 + (index % 5) * 42), y: Math.sin(angle) * (190 + (index % 5) * 42) },
        weaponId: "emp",
        spin: (index % 2 === 0 ? 1 : -1) * (7 + index * 0.08),
        variant: index % 3,
      })
    );
  }
}

function rechargeShields(robots: RobotState[], dt: number, time: number) {
  for (const robot of robots) {
    if (robot.alive && robot.shield < robot.maxShield && robot.lastDamagedAt + SHIELD_REGEN_DELAY_SECONDS <= time) {
      robot.shield = clamp(robot.shield + dt * 1.15, 0, robot.maxShield);
    }
  }
}

function pruneEffects(effects: EffectFrame[], time: number) {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    const parts = effect.id.split("-");
    effect.age = time - Number(parts[parts.length - 1] ?? time);
    if (effect.age > effect.duration) {
      effects.splice(index, 1);
    }
  }
}

function createEffect(
  type: EffectFrame["type"],
  position: Vec2,
  radius: number,
  time: number,
  color: string,
  options: {
    endPosition?: Vec2;
    velocity?: Vec2;
    weaponId?: WeaponId;
    label?: string;
    spin?: number;
    variant?: number;
  } = {}
): EffectFrame {
  const durationByType: Record<EffectFrame["type"], number> = {
    beam: 0.24,
    bit: 0.95,
    cone: 0.32,
    emp: 0.44,
    explosion: 0.55,
    hit: 0.3,
    mine: 0.65,
    muzzle: 0.22,
    shield: 0.38,
    spark: 0.28,
    blade: BLADE_HOLD_SECONDS + BLADE_SWING_SECONDS + BLADE_LINGER_SECONDS,
    "damage-text": 0.5,
    telegraph: 0.5,
    trail: 0.34,
  };

  return {
    id: `${type}-${options.weaponId ?? "fx"}-${time}`,
    type,
    position: { ...position },
    endPosition: options.endPosition ? { ...options.endPosition } : undefined,
    velocity: options.velocity ? { ...options.velocity } : undefined,
    weaponId: options.weaponId,
    radius,
    age: 0,
    duration: durationByType[type],
    color,
    label: options.label,
    spin: options.spin,
    variant: options.variant,
  };
}

function captureFrame(
  time: number,
  robots: RobotState[],
  projectiles: ProjectileState[],
  effects: EffectFrame[],
  pendingStrikes: PendingStrike[],
  bladeSwings: BladeSwingState[],
  mines: MineState[],
  frames: FightFrame[]
) {
  const frameEffects = [
    ...effects,
    ...pendingStrikes
      .map((strike): EffectFrame | undefined => {
        const attacker = robots.find((robot) => robot.id === strike.attackerId);

        if (!attacker || time > strike.resolvesAt) {
          return undefined;
        }

        const aimDirection = { x: Math.cos(attacker.angle), y: Math.sin(attacker.angle) };
        const aimPosition = add(attacker.position, mul(aimDirection, RAILGUN_BEAM_LENGTH));

        return {
          id: `${strike.id}-telegraph-${time}`,
          type: "telegraph",
          position: { ...attacker.position },
          endPosition: { ...aimPosition },
          weaponId: strike.weapon.id,
          radius: 14,
          age: Math.max(0, time - strike.createdAt),
          duration: strike.resolvesAt - strike.createdAt,
          color: "#36e0ff",
        };
      })
      .filter((effect): effect is EffectFrame => effect !== undefined),
    ...bladeSwings
      .map((swing): EffectFrame | undefined => {
        const attacker = robots.find((robot) => robot.id === swing.attackerId);
        if (!attacker || time > swing.expiresAt) {
          return undefined;
        }

        const swingProgress = clamp(
          (time - swing.swingStartAt) / Math.max(0.001, BLADE_SWING_SECONDS),
          0,
          1
        );
        return {
          id: `${swing.id}-fx-${time}`,
          type: "blade",
          position: { ...attacker.position },
          endPosition: undefined,
          weaponId: swing.weapon.id,
          radius: swing.weapon.range,
          age: time - swing.startedAt,
          duration: swing.expiresAt - swing.startedAt,
          color: "#ff0055",
          spin: attacker.angle + swingProgress * Math.PI * 2,
          variant: time < swing.swingStartAt ? 0 : 1,
        };
      })
      .filter((effect): effect is EffectFrame => effect !== undefined),
    ...mines.map((mine): EffectFrame => {
      // During the toss the mine slides from the bot to its landing spot;
      // after that it sits and arms. variant encodes the phase for the
      // renderer: 0 = in-flight, 1 = arming, 2 = armed.
      const flightT = clamp((time - mine.thrownAt) / Math.max(0.001, mine.landAt - mine.thrownAt), 0, 1);
      const flying = time < mine.landAt;
      const armed = time >= mine.armAt;
      const position = flying
        ? {
            x: mine.origin.x + (mine.position.x - mine.origin.x) * flightT,
            y: mine.origin.y + (mine.position.y - mine.origin.y) * flightT,
          }
        : mine.position;

      return {
        id: `${mine.id}-fx-${time}`,
        type: "mine",
        position: { ...position },
        weaponId: "mine",
        radius: mine.triggerRadius,
        age: time - mine.thrownAt,
        duration: mine.expiresAt - mine.thrownAt,
        color: armed ? "#ff8f4f" : "#f6c85f",
        variant: flying ? 0 : armed ? 2 : 1,
        spin: mine.armAt - time, // seconds until armed (negative once armed)
      };
    }),
  ];

  frames.push({
    time,
    robots: robots.map((robot) => ({
      id: robot.id,
      name: robot.name,
      teamId: robot.teamId,
      classId: robot.classId,
      palette: { ...robot.palette },
      position: { ...robot.position },
      velocity: { ...robot.velocity },
      angle: robot.angle,
      hp: Number(robot.hp.toFixed(2)),
      maxHp: robot.maxHp,
      shield: Number(robot.shield.toFixed(2)),
      maxShield: robot.maxShield,
      alive: robot.alive,
      lastMove: robot.lastMove,
      lastWeapon: robot.lastWeapon,
    })),
    projectiles: projectiles.map((projectile) => ({
      id: projectile.id,
      ownerId: projectile.ownerId,
      weaponId: projectile.weaponId,
      position: { ...projectile.position },
      velocity: { ...projectile.velocity },
      radius: projectile.radius,
      age: projectile.age,
    })),
    effects: frameEffects.map((effect) => ({
      ...effect,
      position: { ...effect.position },
      endPosition: effect.endPosition ? { ...effect.endPosition } : undefined,
      velocity: effect.velocity ? { ...effect.velocity } : undefined,
    })),
  });
}

function rotateVector(vector: Vec2, radians: number): Vec2 {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine,
  };
}

function pointLineDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const line = sub(end, start);
  const lineLengthSquared = line.x * line.x + line.y * line.y;

  if (lineLengthSquared <= 0.001) {
    return distance(point, start);
  }

  const t = clamp(((point.x - start.x) * line.x + (point.y - start.y) * line.y) / lineLengthSquared, 0, 1);
  const projection = {
    x: start.x + line.x * t,
    y: start.y + line.y * t,
  };

  return distance(point, projection);
}

function chooseWinnerByScore(robots: RobotState[]): string | undefined {
  return [...robots].sort((left, right) => {
    const leftScore = left.hp + left.shield * 0.4 + left.damageDone * 0.2;
    const rightScore = right.hp + right.shield * 0.4 + right.damageDone * 0.2;
    return rightScore - leftScore;
  })[0]?.id;
}

export function cloneFightConfig(config: FightConfig): FightConfig {
  return {
    ...config,
    arena: { ...config.arena },
    classes: config.classes.map((robotClass) => ({
      ...robotClass,
      palette: { ...robotClass.palette },
      arsenal: [...robotClass.arsenal],
    })),
    movementProfiles: Object.fromEntries(
      Object.entries(config.movementProfiles).map(([profileId, dice]) => [
        profileId,
        dice.map((die) => ({ ...die })),
      ])
    ) as FightConfig["movementProfiles"],
    weapons: (config.weapons ?? []).map((weapon) => ({ ...weapon })),
    robots: config.robots.map((robot: RobotConfig) => ({
      ...robot,
      palette: { ...robot.palette },
      arsenal: [...robot.arsenal],
      movementDice: robot.movementDice.map((die) => ({ ...die })),
      weaponDice: robot.weaponDice.map((die) => ({ ...die })),
    })),
  };
}
