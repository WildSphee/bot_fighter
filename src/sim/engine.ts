import { createMovementDice, createWeaponDice, getClass, getWeapon } from "./catalog";
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
import { add, angleTo, clamp, distance, mul, normalize, rotate90, sub } from "./vector";

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

const ROBOT_RADIUS = 36;
const WINNER_SCREEN_SECONDS = 2;

export function simulateFight(config: FightConfig): FightResult {
  const rng = createRng(`${config.seed}:${config.robots.map((robot) => robot.id).join("|")}`);
  const robots = createInitialRobots(config);
  const projectiles: ProjectileState[] = [];
  const pendingStrikes: PendingStrike[] = [];
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
      pruneEffects(effects, deathTime + (time - deathTime) * 0.5);
      captureFrame(time, robots, projectiles, effects, pendingStrikes, frames);
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
              pendingStrikes,
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

      resolveRobotCollisions(robots);
      updatePendingStrikes(pendingStrikes, robots, effects, events, damageByRobot, time);
      updateProjectiles(projectiles, robots, effects, events, damageByRobot, time, tickStep);
      rechargeShields(robots, tickStep);
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
      captureFrame(time, robots, projectiles, effects, pendingStrikes, frames);
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
      captureFrame(Number(holdTime.toFixed(4)), robots, projectiles, effects, pendingStrikes, frames);
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
  robot.angle = angleTo(robot.position, target.position);
}

function integrateRobot(robot: RobotState, config: FightConfig, dt: number) {
  const robotClass = robot.classProfile;
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

function resolveRobotCollisions(robots: RobotState[]) {
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
        const impulse = (-(1.15) * impactSpeed) / (1 / leftClass.mass + 1 / rightClass.mass);
        left.velocity = add(left.velocity, mul(normal, -impulse / leftClass.mass));
        right.velocity = add(right.velocity, mul(normal, impulse / rightClass.mass));
      } else {
        left.velocity = add(left.velocity, mul(normal, -18 / leftClass.mass));
        right.velocity = add(right.velocity, mul(normal, 18 / rightClass.mass));
      }
    }
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
    pendingStrikes,
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

  if (weapon.id === "shotgun") {
    const pelletCount = 5;
    for (let index = 0; index < pelletCount; index += 1) {
      const spread = ((index - (pelletCount - 1) / 2) * 8.5 * Math.PI) / 180;
      const pelletDirection = rotateVector(direction, spread);
      projectiles.push({
        id: `shotgun-${attacker.id}-${time.toFixed(2)}-${index}`,
        ownerId: attacker.id,
        targetId: target.id,
        weaponId: weapon.id,
        position: add(attacker.position, mul(pelletDirection, ROBOT_RADIUS + 12)),
        velocity: mul(pelletDirection, 620 + index * 18),
        damage: weapon.damage / pelletCount,
        radius: 8,
        homing: 0,
        knockback: weapon.knockback / pelletCount,
        curve: 0,
        lastTrailAt: time,
        age: 0,
        expiresAt: time + 0.48,
      });
    }
    effects.push(
      createEffect("spark", add(attacker.position, mul(direction, ROBOT_RADIUS + 22)), 36, time, "#ffd166", {
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
        applyDamage(attacker, robot, weapon, time, events, damageByRobot, effects);
      }
    }
    return;
  }

  if (weapon.id === "railgun") {
    pendingStrikes.push({
      id: `railgun-${attacker.id}-${time.toFixed(2)}`,
      weapon,
      attackerId: attacker.id,
      targetId: target.id,
      aimPosition: { ...target.position },
      createdAt: time,
      lockedAt: time + 1,
      resolvesAt: time + 1.3,
    });
    return;
  }

  if (weapon.id === "emp") {
    effects.push(
      createEffect("emp", attacker.position, weapon.radius + 96, time, "#a9fffd", {
        weaponId: weapon.id,
      })
    );
  } else {
    effects.push(
      createEffect("beam", attacker.position, 10, time, attacker.palette.glow, {
        endPosition: target.position,
        weaponId: weapon.id,
      })
    );
  }

  if (rngNext() <= 0.78) {
    applyDamage(attacker, target, weapon, time, events, damageByRobot, effects);
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
      const projectileWeapon = {
        ...getWeapon(projectile.weaponId),
        damage: projectile.damage,
        knockback: projectile.knockback,
      };
      applyDamage(owner, hitRobot, projectileWeapon, time, events, damageByRobot, effects);
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
  effects: EffectFrame[]
) {
  const targetClass = target.classProfile;
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
    const fireDirection = normalize(sub(strike.aimPosition, startPosition));
    const endPosition = add(startPosition, mul(fireDirection, strike.weapon.range));

    effects.push(
      createEffect("beam", startPosition, 30, time, "#ffdd78", {
        endPosition,
        weaponId: strike.weapon.id,
      })
    );
    events.push({ type: "sound", time, sound: "railgun" });

    if (attacker && target?.alive && pointLineDistance(target.position, startPosition, endPosition) <= ROBOT_RADIUS + 8) {
      applyDamage(attacker, target, strike.weapon, time, events, damageByRobot, effects);
      effects.push(
        createEffect("hit", target.position, strike.weapon.radius + 18, time, attacker.palette.glow, {
          weaponId: strike.weapon.id,
        })
      );
    } else {
      effects.push(
        createEffect("spark", endPosition, 24, time, "#ffdd78", {
          weaponId: strike.weapon.id,
        })
      );
    }

    pendingStrikes.splice(index, 1);
  }
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
    velocity?: Vec2;
    weaponId?: WeaponId;
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
  frames: FightFrame[]
) {
  const frameEffects = [
    ...effects,
    ...pendingStrikes
      .map((strike): EffectFrame | undefined => {
        const attacker = robots.find((robot) => robot.id === strike.attackerId);
        const target = robots.find((robot) => robot.id === strike.targetId);

        if (!attacker || time > strike.resolvesAt) {
          return undefined;
        }

        const tracking = time < strike.lockedAt && target?.alive;
        const aimPosition = tracking ? target.position : strike.aimPosition;

        return {
          id: `${strike.id}-telegraph-${time}`,
          type: "telegraph",
          position: { ...attacker.position },
          endPosition: { ...aimPosition },
          weaponId: strike.weapon.id,
          radius: 14,
          age: Math.max(0, time - strike.createdAt),
          duration: strike.resolvesAt - strike.createdAt,
          color: "#ffdd78",
        };
      })
      .filter((effect): effect is EffectFrame => effect !== undefined),
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
    movementProfiles: {
      balanced: config.movementProfiles.balanced.map((die) => ({ ...die })),
      aggressive: config.movementProfiles.aggressive.map((die) => ({ ...die })),
      evasive: config.movementProfiles.evasive.map((die) => ({ ...die })),
    },
    robots: config.robots.map((robot: RobotConfig) => ({
      ...robot,
      palette: { ...robot.palette },
      arsenal: [...robot.arsenal],
      movementDice: robot.movementDice.map((die) => ({ ...die })),
      weaponDice: robot.weaponDice.map((die) => ({ ...die })),
    })),
  };
}
