import { getClass, getWeapon } from "./catalog";
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
} from "./types";
import { add, angleTo, clamp, distance, mul, normalize, rotate90, sub } from "./vector";

type RobotState = RobotFrame & {
  arsenal: RobotConfig["arsenal"];
  movementDice: RobotConfig["movementDice"];
  weaponDice: RobotConfig["weaponDice"];
  damageDone: number;
  nextMoveAt: number;
  nextWeaponAt: number;
  cooldowns: Partial<Record<WeaponId, number>>;
  intent: MovementId;
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
};

const ROBOT_RADIUS = 36;
const WINNER_SCREEN_SECONDS = 1;

export function simulateFight(config: FightConfig): FightResult {
  const rng = createRng(`${config.seed}:${config.robots.map((robot) => robot.id).join("|")}`);
  const robots = createInitialRobots(config);
  const projectiles: ProjectileState[] = [];
  const effects: EffectFrame[] = [];
  const frames: FightFrame[] = [];
  const events: FightEvent[] = [];
  const damageByRobot: Record<string, number> = Object.fromEntries(
    config.robots.map((robot) => [robot.id, 0])
  );
  const tickStep = 1 / config.tickRate;
  const frameStep = 1 / config.previewFps;
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
      captureFrame(time, robots, projectiles, effects, frames);
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
          robot.lastMove = robot.intent;
          robot.nextMoveAt = time + 0.85 + rng.next() * 0.95;
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
          const weaponRoll = weightedRoll(
            rng,
            robot.weaponDice.filter((die) => robot.arsenal.includes(die.id))
          );
          const weaponId = weaponRoll.id;
          const weapon = getWeapon(weaponId);

          if ((robot.cooldowns[weaponId] ?? 0) <= time) {
            fireWeapon({
              weapon,
              attacker: robot,
              target,
              time,
              roll: weaponRoll.roll,
              rollTotal: weaponRoll.total,
              rngNext: rng.next,
              projectiles,
              effects,
              events,
              robots,
              damageByRobot,
            });
            robot.lastWeapon = weaponId;
            robot.cooldowns[weaponId] = time + weapon.cooldown;
            robot.nextWeaponAt = time + 0.7 + rng.next() * 0.8;
          } else {
            robot.nextWeaponAt = time + 0.25;
          }
        }
      }

      for (const robot of robots) {
        integrateRobot(robot, config, tickStep);
      }

      updateProjectiles(projectiles, robots, effects, events, damageByRobot, time, tickStep);
      rechargeShields(robots, tickStep);
      pruneEffects(effects, time);
    }

    if (time + 0.0001 >= nextFrameAt) {
      captureFrame(time, robots, projectiles, effects, frames);
      nextFrameAt += frameStep;
    }
  }

  if (!events.some((event) => event.type === "winner")) {
    winnerId = chooseWinnerByScore(robots);
    winnerReason = "hp";
    const time = config.maxDuration;
    events.push({ type: "winner", time, winnerId, reason: winnerReason, sound: "winner" });
    captureFrame(time, robots, projectiles, effects, frames);
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
    const robotClass = getClass(robot.classId);
    const angle = (Math.PI * 2 * index) / config.robots.length - Math.PI / 2;
    const position = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };

    return {
      ...robot,
      position,
      velocity: { x: 0, y: 0 },
      angle,
      hp: robotClass.hp,
      maxHp: robotClass.hp,
      shield: robotClass.shield,
      maxShield: robotClass.shield,
      alive: true,
      lastMove: "hold",
      damageDone: 0,
      nextMoveAt: 0,
      nextWeaponAt: 0.35 + index * 0.2,
      cooldowns: {},
      intent: "hold",
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
  const robotClass = getClass(robot.classId);
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
  const vector = nearWall ? boundaryVector : movementVector[robot.intent];
  robot.velocity = add(robot.velocity, mul(vector, robotClass.speed * dt));
  robot.angle = angleTo(robot.position, target.position);
}

function integrateRobot(robot: RobotState, config: FightConfig, dt: number) {
  const robotClass = getClass(robot.classId);
  robot.velocity = mul(robot.velocity, config.arena.drag);
  robot.position = add(robot.position, mul(robot.velocity, dt * 60));

  const minX = ROBOT_RADIUS;
  const minY = ROBOT_RADIUS;
  const maxX = config.arena.width - ROBOT_RADIUS;
  const maxY = config.arena.height - ROBOT_RADIUS;
  const clampedX = clamp(robot.position.x, minX, maxX);
  const clampedY = clamp(robot.position.y, minY, maxY);

  if (clampedX !== robot.position.x) {
    robot.velocity.x *= -0.55 / robotClass.mass;
  }

  if (clampedY !== robot.position.y) {
    robot.velocity.y *= -0.55 / robotClass.mass;
  }

  robot.position = { x: clampedX, y: clampedY };
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
  effects: EffectFrame[];
  events: FightEvent[];
  robots: RobotState[];
  damageByRobot: Record<string, number>;
}) {
  const {
    weapon,
    attacker,
    target,
    time,
    roll,
    rollTotal,
    rngNext,
    projectiles,
    effects,
    events,
    damageByRobot,
  } = input;
  const targetDistance = distance(attacker.position, target.position);

  if (weapon.kind !== "defense" && targetDistance > weapon.range) {
    return;
  }

  const direction = normalize(sub(target.position, attacker.position));
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
    attacker.shield = clamp(attacker.shield + 28, 0, attacker.maxShield + 34);
    effects.push(
      createEffect("shield", attacker.position, weapon.radius + 16, time, attacker.palette.glow, {
        weaponId: weapon.id,
      })
    );
    return;
  }

  if (weapon.kind === "projectile") {
    const arcSign = rngNext() > 0.5 ? 1 : -1;
    const side = rotate90(direction, arcSign);
    const arcStrength =
      weapon.id === "missile" ? 170 + rngNext() * 120 : weapon.id === "boomerang" ? 105 : 45;
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
      curve: arcSign * (weapon.id === "missile" ? 235 : weapon.id === "boomerang" ? -155 : 65),
      lastTrailAt: time,
      age: 0,
      expiresAt: time + (weapon.id === "missile" ? 3 : 4.2),
    });
    effects.push(
      createEffect("spark", add(attacker.position, mul(direction, ROBOT_RADIUS + 18)), weapon.radius + 24, time, "#ffdd78", {
        weaponId: weapon.id,
      })
    );
    return;
  }

  if (weapon.kind === "field") {
    effects.push(
      createEffect("mine", add(attacker.position, mul(direction, -24)), weapon.radius + 28, time, "#f6c85f", {
        weaponId: weapon.id,
      })
    );
    effects.push(
      createEffect("explosion", attacker.position, weapon.radius + 52, time + 0.1, "#ff8f4f", {
        weaponId: weapon.id,
      })
    );
    for (const robot of input.robots) {
      if (robot.id !== attacker.id && robot.alive && distance(robot.position, attacker.position) < weapon.radius + 70) {
        applyDamage(attacker, robot, weapon, time, events, damageByRobot);
      }
    }
    return;
  }

  if (weapon.id === "shotgun") {
    effects.push(
      createEffect("cone", attacker.position, 96, time, "#ffd166", {
        endPosition: target.position,
        weaponId: weapon.id,
      })
    );
  } else if (weapon.id === "emp") {
    effects.push(
      createEffect("emp", attacker.position, weapon.radius + 96, time, "#a9fffd", {
        weaponId: weapon.id,
      })
    );
  } else {
    effects.push(
      createEffect("beam", attacker.position, weapon.id === "railgun" ? 18 : 10, time, weapon.id === "railgun" ? "#ffdd78" : attacker.palette.glow, {
        endPosition: target.position,
        weaponId: weapon.id,
      })
    );
  }

  const accuracy = weapon.id === "railgun" ? 0.86 : 0.78;
  if (rngNext() <= accuracy) {
    applyDamage(attacker, target, weapon, time, events, damageByRobot);
    effects.push(
      createEffect(weapon.id === "emp" ? "emp" : "hit", target.position, weapon.radius + 12, time, attacker.palette.glow, {
        weaponId: weapon.id,
      })
    );
  }
}

function updateProjectiles(
  projectiles: ProjectileState[],
  robots: RobotState[],
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

    const hitRobot = robots.find(
      (robot) =>
        robot.alive &&
        robot.id !== projectile.ownerId &&
        distance(robot.position, projectile.position) <= projectile.radius + ROBOT_RADIUS
    );

    if (owner && hitRobot) {
      applyDamage(owner, hitRobot, getWeapon(projectile.weaponId), time, events, damageByRobot);
      effects.push(
        createEffect("explosion", projectile.position, projectile.radius + 32, time, owner.palette.glow, {
          weaponId: projectile.weaponId,
        })
      );
      projectiles.splice(index, 1);
      continue;
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
  damageByRobot: Record<string, number>
) {
  const targetClass = getClass(target.classId);
  const shieldAbsorb = Math.min(target.shield, weapon.damage * 0.7);
  target.shield -= shieldAbsorb;
  const damage = Math.max(1, (weapon.damage - shieldAbsorb) * (1 - targetClass.armor));
  target.hp = Math.max(0, target.hp - damage);
  attacker.damageDone += damage;
  damageByRobot[attacker.id] += damage;

  const direction = normalize(sub(target.position, attacker.position));
  target.velocity = add(target.velocity, mul(direction, weapon.knockback / targetClass.mass));

  events.push({
    type: "hit",
    time,
    attackerId: attacker.id,
    targetId: target.id,
    weaponId: weapon.id,
    damage: Number(damage.toFixed(2)),
    sound: "impact",
  });

  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    events.push({
      type: "death",
      time,
      robotId: target.id,
      killerId: attacker.id,
      sound: "explosion",
    });
  }
}

function rechargeShields(robots: RobotState[], dt: number) {
  for (const robot of robots) {
    if (robot.alive) {
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
    weaponId?: WeaponId;
  } = {}
): EffectFrame {
  const durationByType: Record<EffectFrame["type"], number> = {
    beam: 0.24,
    cone: 0.32,
    emp: 0.44,
    explosion: 0.55,
    hit: 0.3,
    mine: 0.65,
    muzzle: 0.22,
    shield: 0.38,
    spark: 0.28,
    trail: 0.34,
  };

  return {
    id: `${type}-${options.weaponId ?? "fx"}-${time}`,
    type,
    position: { ...position },
    endPosition: options.endPosition ? { ...options.endPosition } : undefined,
    weaponId: options.weaponId,
    radius,
    age: 0,
    duration: durationByType[type],
    color,
  };
}

function captureFrame(
  time: number,
  robots: RobotState[],
  projectiles: ProjectileState[],
  effects: EffectFrame[],
  frames: FightFrame[]
) {
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
    effects: effects.map((effect) => ({
      ...effect,
      position: { ...effect.position },
    })),
  });
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
    robots: config.robots.map((robot: RobotConfig) => ({
      ...robot,
      palette: { ...robot.palette },
      arsenal: [...robot.arsenal],
      movementDice: robot.movementDice.map((die) => ({ ...die })),
      weaponDice: robot.weaponDice.map((die) => ({ ...die })),
    })),
  };
}
