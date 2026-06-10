import { ROBOT_CLASSES, WEAPONS } from "../sim/catalog";
import type {
  ArenaConfig,
  EffectFrame,
  FightEvent,
  FightFrame,
  FightResult,
  MovementId,
  RobotClass,
  RobotFrame,
  Vec2,
  WeaponId,
} from "../sim/types";

const TOP_BAR_HEIGHT = 168;
const ACTION_BAR_HEIGHT = 330;
const EXPANDED_ACTION_BAR_HEIGHT = 470;
const FIELD_PADDING_X = 64;
const FIELD_GAP_TOP = 28;
const FIELD_GAP_BOTTOM = 44;
const ROBOT_RADIUS = 38;
// How long the movement slot / weapon list visibly spins after each pick before
// locking onto the result. Matches the half-second display window in the brief.
const SLOT_SPIN_SECONDS = 0.5;

type Layout = {
  width: number;
  height: number;
  topBar: Rect;
  arena: Rect;
  actionBar: Rect;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function drawFightFrame(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  result: FightResult
) {
  const layout = createLayout(context, frame.robots.length);

  context.clearRect(0, 0, layout.width, layout.height);
  drawBackground(context, layout, frame.time, result.config.classes);
  drawTopBar(context, frame, result, layout);
  drawArena(context, result.config.arena, layout);

  context.save();
  clipRect(context, layout.arena);
  drawEffects(context, frame, result.config.arena, layout);
  drawProjectiles(context, frame, result.config.arena, layout);
  drawRobots(context, frame, result.config.arena, layout);
  context.restore();

  drawArenaFrame(context, layout);
  drawRailgunOverlay(context, frame, result.config.arena, layout);

  drawFloatingActions(context, frame, result, layout);
  drawActionBar(context, frame, result, layout);
  drawWinnerCard(context, frame, result, layout);
}

function createLayout(context: CanvasRenderingContext2D, robotCount: number): Layout {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const actionBarHeight = actionBarHeightForRobotCount(robotCount);
  const actionBarY = height - actionBarHeight;
  const arenaY = TOP_BAR_HEIGHT + FIELD_GAP_TOP;

  return {
    width,
    height,
    topBar: { x: 0, y: 0, width, height: TOP_BAR_HEIGHT },
    arena: {
      x: FIELD_PADDING_X,
      y: arenaY,
      width: width - FIELD_PADDING_X * 2,
      height: actionBarY - FIELD_GAP_BOTTOM - arenaY,
    },
    actionBar: { x: 0, y: actionBarY, width, height: actionBarHeight },
  };
}

function actionBarHeightForRobotCount(robotCount: number): number {
  return robotCount > 3 ? EXPANDED_ACTION_BAR_HEIGHT : ACTION_BAR_HEIGHT;
}

function drawBackground(context: CanvasRenderingContext2D, layout: Layout, time: number, classes: RobotClass[]) {
  const gradient = context.createLinearGradient(0, 0, layout.width, layout.height);
  gradient.addColorStop(0, "#0e1b22");
  gradient.addColorStop(0.5, "#221a2b");
  gradient.addColorStop(1, "#2d231f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, layout.width, layout.height);

  const avgRotationSpeed = classes.length > 0 ? classes.reduce((sum, c) => sum + c.rotationSpeed, 0) / classes.length : 0.16;
  drawBackgroundCubes(context, layout, time, avgRotationSpeed);

  context.save();
  context.globalAlpha = 0.28;
  context.fillStyle = "#ffdd78";
  context.fillRect(0, layout.topBar.height - 4, layout.width, 4);
  context.fillStyle = "#2fffc8";
  context.fillRect(0, layout.actionBar.y, layout.width, 4);
  context.restore();
}

function drawBackgroundCubes(context: CanvasRenderingContext2D, layout: Layout, time: number, rotationSpeed: number) {
  const cubeCount = 18;

  context.save();
  context.globalAlpha = 0.22;
  context.lineWidth = 2.5;

  for (let index = 0; index < cubeCount; index += 1) {
    const drift = (time * 0.045 + index * 0.071) % 1;
    const baseX = ((index * 197) % layout.width) + Math.sin(index * 1.8) * 34;
    const baseY = ((index * 311) % layout.height) + Math.cos(index * 1.3) * 44;
    const x = (baseX + (drift - 0.5) * 90 + layout.width) % layout.width;
    const y = (baseY + (drift - 0.5) * 150 + layout.height) % layout.height;
    const size = 28 + drift * 88 + (index % 3) * 12;

    context.save();
    context.translate(x, y);
    context.rotate(time * rotationSpeed + index * 0.7);
    context.strokeStyle = index % 2 === 0 ? "#8ae9ff" : "#ffdd78";
    context.shadowBlur = 10;
    context.shadowColor = context.strokeStyle;
    context.strokeRect(-size / 2, -size / 2, size, size);
    context.strokeRect(-size / 2 + size * 0.18, -size / 2 - size * 0.18, size, size);
    context.beginPath();
    context.moveTo(-size / 2, -size / 2);
    context.lineTo(-size / 2 + size * 0.18, -size / 2 - size * 0.18);
    context.moveTo(size / 2, -size / 2);
    context.lineTo(size / 2 + size * 0.18, -size / 2 - size * 0.18);
    context.moveTo(size / 2, size / 2);
    context.lineTo(size / 2 + size * 0.18, size / 2 - size * 0.18);
    context.stroke();
    context.restore();
  }

  context.restore();
}

function drawTopBar(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  result: FightResult,
  layout: Layout
) {
  context.save();
  context.fillStyle = "rgba(7, 12, 17, 0.78)";
  context.fillRect(layout.topBar.x, layout.topBar.y, layout.topBar.width, layout.topBar.height);

  context.fillStyle = "#fff7e6";
  context.font = "900 36px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("WHO WILL WIN?", layout.width / 2, 44);

  const slots = topSlots(frame.robots, layout);
  frame.robots.slice(0, 4).forEach((robot, index) => {
    drawTopRobotStatus(context, robot, slots[index], index % 2 === 1, frame.time, result.events);
  });

  context.restore();
}

function topSlots(robots: RobotFrame[], layout: Layout): Rect[] {
  if (robots.length <= 2) {
    return [
      { x: 28, y: 22, width: 300, height: 118 },
      { x: layout.width - 328, y: 22, width: 300, height: 118 },
    ];
  }

  return robots.slice(0, 4).map((_, index) => ({
    x: index % 2 === 0 ? 24 : layout.width - 294,
    y: index < 2 ? 18 : 88,
    width: 270,
    height: 64,
  }));
}

function drawTopRobotStatus(
  context: CanvasRenderingContext2D,
  robot: RobotFrame,
  rect: Rect,
  alignRight: boolean,
  time: number,
  events: FightEvent[]
) {
  const hpRatio = Math.max(0, robot.hp / robot.maxHp);
  const shieldRatio = Math.max(0, robot.shield / robot.maxShield);
  const textX = alignRight ? rect.x + rect.width : rect.x;
  const shake = healthShakeFor(robot.id, time, events);
  const shakeX = shake * Math.sin(time * 92 + robot.id.length) * 5;
  const shakeY = shake * Math.cos(time * 77 + robot.id.length) * 2;

  context.save();
  context.translate(shakeX, shakeY);

  context.textAlign = alignRight ? "right" : "left";
  context.fillStyle = "rgba(255,255,255,0.16)";
  context.fillRect(rect.x, rect.y + rect.height - 42, rect.width, 24);
  context.fillStyle = robot.palette.body;
  context.fillRect(rect.x, rect.y + rect.height - 42, rect.width * hpRatio, 24);
  context.fillStyle = robot.palette.glow;
  context.fillRect(rect.x, rect.y + rect.height - 14, rect.width * shieldRatio, 7);

  context.fillStyle = "#fff7e6";
  context.font = "900 30px Inter, system-ui, sans-serif";
  context.fillText(getClassName(robot.classId), textX, rect.y + 28);
  context.fillStyle = "#ffffff";
  context.font = "800 19px Inter, system-ui, sans-serif";
  context.fillText(`${Math.ceil(robot.hp)} / ${robot.maxHp} HP`, textX, rect.y + 56);
  context.restore();
}

function drawArena(
  context: CanvasRenderingContext2D,
  arena: ArenaConfig,
  layout: Layout
) {
  const rect = layout.arena;
  const gradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
  gradient.addColorStop(0, "#132631");
  gradient.addColorStop(0.55, "#251a34");
  gradient.addColorStop(1, "#342624");
  context.save();
  context.globalAlpha = 0.72;
  context.fillStyle = gradient;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();

  context.save();
  context.globalAlpha = 0.28;
  context.strokeStyle = "#8ae9ff";
  context.lineWidth = 1;
  for (let x = rect.x + 60; x < rect.x + rect.width; x += 60) {
    context.beginPath();
    context.moveTo(x, rect.y);
    context.lineTo(x, rect.y + rect.height);
    context.stroke();
  }
  for (let y = rect.y + 60; y < rect.y + rect.height; y += 60) {
    context.beginPath();
    context.moveTo(rect.x, y);
    context.lineTo(rect.x + rect.width, y);
    context.stroke();
  }
  context.restore();
}

// Drawn after the clipped projectiles/effects so nothing renders on top of
// the playfield border.
function drawArenaFrame(context: CanvasRenderingContext2D, layout: Layout) {
  const rect = layout.arena;
  context.strokeStyle = "#ffdd78";
  context.lineWidth = 8;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeStyle = "#2fffc8";
  context.lineWidth = 2;
  context.strokeRect(rect.x + 20, rect.y + 20, rect.width - 40, rect.height - 40);
}

function drawEffects(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  arena: ArenaConfig,
  layout: Layout
) {
  for (const effect of frame.effects) {
    if (
      effect.weaponId === "railgun" &&
      (effect.type === "beam" || effect.type === "telegraph")
    ) {
      continue;
    }

    const worldPosition =
      effect.type === "bit" && effect.velocity
        ? {
            x: effect.position.x + effect.velocity.x * effect.age,
            y: effect.position.y + effect.velocity.y * effect.age,
          }
        : effect.position;
    const position = mapPoint(worldPosition, arena, layout.arena);
    const alpha = Math.max(0, 1 - effect.age / effect.duration);

    if (effect.type === "telegraph" && effect.endPosition) {
      drawRailgunTelegraph(context, effect, position, mapPoint(effect.endPosition, arena, layout.arena));
      continue;
    }

    if (effect.type === "beam" && effect.endPosition) {
      drawBeamEffect(context, effect, position, mapPoint(effect.endPosition, arena, layout.arena), alpha);
      continue;
    }

    if (effect.type === "cone" && effect.endPosition) {
      drawConeEffect(context, effect, position, mapPoint(effect.endPosition, arena, layout.arena), alpha);
      continue;
    }

    if (effect.type === "blade") {
      drawBladeEffect(context, effect, position, layout.arena.width / arena.width, alpha);
      continue;
    }

    if (effect.type === "damage-text") {
      drawDamageToast(context, effect, position, alpha);
      continue;
    }

    if (effect.type === "mine") {
      drawThrownMine(context, effect, position, layout.arena.width / arena.width);
      continue;
    }

    context.save();
    context.globalAlpha = alpha * (effect.type === "muzzle" || effect.type === "spark" ? 0.95 : 0.75);
    context.strokeStyle = effect.color;
    context.fillStyle = effect.color;
    context.lineWidth = effect.type === "trail" || effect.type === "spark" ? 4 : 7;
    const radius = effect.radius * 0.68 * (1 + effect.age);

    if (effect.type === "bit") {
      drawDebrisBit(context, position, radius, effect.age, effect.spin ?? 1, effect.variant ?? 0);
    } else if (effect.type === "shield" || effect.type === "emp") {
      context.beginPath();
      context.arc(position.x, position.y, radius, 0, Math.PI * 2);
      context.stroke();
    } else if (effect.type === "muzzle") {
      context.beginPath();
      context.arc(position.x, position.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.stroke();
    } else if (effect.type === "spark" || effect.type === "trail") {
      drawParticleStar(context, position, Math.max(4, radius), effect.age);
    } else {
      context.beginPath();
      context.arc(position.x, position.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function drawRailgunOverlay(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  arena: ArenaConfig,
  layout: Layout
) {
  const railgunEffects = frame.effects.filter(
    (effect) =>
      effect.weaponId === "railgun" &&
      (effect.type === "beam" || effect.type === "telegraph") &&
      effect.endPosition
  );

  if (railgunEffects.length === 0) {
    return;
  }

  context.save();
  // Clip to the playfield band so the beam can shoot past the arena box
  // edges without painting over the HUD bars.
  clipRect(context, {
    x: 0,
    y: layout.topBar.height,
    width: layout.width,
    height: layout.actionBar.y - layout.topBar.height,
  });

  for (const effect of railgunEffects) {
    const start = mapPoint(effect.position, arena, layout.arena);
    const end = mapPoint(effect.endPosition as Vec2, arena, layout.arena);
    const alpha = Math.max(0, 1 - effect.age / effect.duration);

    if (effect.type === "telegraph") {
      drawRailgunTelegraph(context, effect, start, end);
    } else {
      drawBeamEffect(context, effect, start, end, alpha);
    }
  }

  context.restore();
}

function drawThrownMine(
  context: CanvasRenderingContext2D,
  effect: EffectFrame,
  position: Vec2,
  scale: number
) {
  const variant = effect.variant ?? 0;
  const flying = variant === 0;
  const arming = variant === 1;
  const armed = variant === 2;
  const secondsToArm = effect.spin ?? 0;
  const bodyRadius = 13;

  context.save();
  context.translate(position.x, position.y);

  if (armed) {
    // Pulsing trigger radius so you can see its live blast zone.
    const triggerRadius = effect.radius * scale;
    const pulse = 0.5 + 0.5 * Math.sin(effect.age * 6);
    context.globalAlpha = 0.18 + pulse * 0.22;
    context.fillStyle = "#ff8f4f";
    context.beginPath();
    context.arc(0, 0, triggerRadius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.5 + pulse * 0.4;
    context.strokeStyle = "#ff8f4f";
    context.lineWidth = 2;
    context.stroke();
  }

  context.globalAlpha = 1;

  // Spikes radiating from the casing.
  context.strokeStyle = armed ? "#ff8f4f" : "#caa64a";
  context.lineWidth = 3;
  const spikes = 8;
  for (let index = 0; index < spikes; index += 1) {
    const angle = (Math.PI * 2 * index) / spikes + (flying ? effect.age * 9 : 0);
    context.beginPath();
    context.moveTo(Math.cos(angle) * bodyRadius, Math.sin(angle) * bodyRadius);
    context.lineTo(Math.cos(angle) * (bodyRadius + 7), Math.sin(angle) * (bodyRadius + 7));
    context.stroke();
  }

  // Casing.
  context.shadowBlur = armed ? 14 : 6;
  context.shadowColor = armed ? "#ff6a3d" : "#000000";
  context.fillStyle = "#3a3326";
  context.strokeStyle = "#1d1a14";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(0, 0, bodyRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;

  // Status light: blinks faster as it nears arming, solid red once armed.
  let lightOn = true;
  let lightColor = "#ffdd78";
  if (armed) {
    lightColor = "#ff5a3c";
    lightOn = true;
  } else if (arming) {
    const blinkRate = 3 + Math.max(0, 1.5 - secondsToArm) * 9;
    lightOn = Math.sin(effect.age * blinkRate * Math.PI) > 0;
    lightColor = "#ffd166";
  } else {
    lightColor = "#9feee2";
  }

  if (lightOn) {
    context.fillStyle = lightColor;
    context.shadowBlur = 10;
    context.shadowColor = lightColor;
    context.beginPath();
    context.arc(0, 0, 5, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  }

  context.restore();
}

function drawBladeEffect(
  context: CanvasRenderingContext2D,
  effect: EffectFrame,
  position: Vec2,
  scale: number,
  alpha: number
) {
  const angle = effect.spin ?? 0;
  const radius = effect.radius * scale;
  const holding = effect.variant === 0;

  context.save();
  context.translate(position.x, position.y);
  context.rotate(angle);
  context.globalAlpha = holding ? 0.7 : Math.max(0.25, alpha);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowBlur = holding ? 18 : 30;
  context.shadowColor = "#ff2f55";

  if (holding) {
    context.strokeStyle = "#ff2f55";
    context.lineWidth = 12;
    context.beginPath();
    context.moveTo(28, 0);
    context.lineTo(radius * 0.95, 0);
    context.stroke();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(42, 0);
    context.lineTo(radius * 0.88, 0);
    context.stroke();
  } else {
    context.strokeStyle = "rgba(255, 47, 85, 0.72)";
    context.lineWidth = 28;
    context.beginPath();
    context.arc(0, 0, radius * 0.78, -1.65, 0.25);
    context.stroke();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 5;
    context.beginPath();
    context.arc(0, 0, radius * 0.78, -1.42, 0.1);
    context.stroke();
    context.strokeStyle = "#ff2f55";
    context.lineWidth = 9;
    context.beginPath();
    context.moveTo(24, 0);
    context.lineTo(radius, 0);
    context.stroke();
  }

  context.restore();
}

function drawDamageToast(
  context: CanvasRenderingContext2D,
  effect: EffectFrame,
  position: Vec2,
  alpha: number
) {
  context.save();
  context.globalAlpha = alpha;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "900 24px Inter, system-ui, sans-serif";
  context.lineWidth = 7;
  context.strokeStyle = "rgba(7, 12, 17, 0.86)";
  context.fillStyle = effect.color;
  context.shadowBlur = 10;
  context.shadowColor = effect.color;
  const text = effect.label ?? "";
  context.strokeText(text, position.x, position.y - 28);
  context.fillText(text, position.x, position.y - 28);
  context.restore();
}

function drawDebrisBit(
  context: CanvasRenderingContext2D,
  position: Vec2,
  radius: number,
  age: number,
  spin: number,
  variant: number
) {
  context.save();
  context.translate(position.x, position.y);
  context.rotate(age * spin);

  if (variant === 0) {
    context.fillRect(-radius, -radius * 0.7, radius * 2, radius * 1.4);
  } else if (variant === 1) {
    context.beginPath();
    context.moveTo(0, -radius);
    context.lineTo(radius * 1.15, radius);
    context.lineTo(-radius, radius * 0.7);
    context.closePath();
    context.fill();
  } else {
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawBeamEffect(
  context: CanvasRenderingContext2D,
  effect: { color: string; radius: number; weaponId?: WeaponId },
  start: Vec2,
  end: Vec2,
  alpha: number
) {
  const isRailgun = effect.weaponId === "railgun";
  const isRay = effect.weaponId === "ray";
  const beamColor = isRailgun ? "#36e0ff" : isRay ? "#a9fffd" : effect.color;

  context.save();
  context.globalAlpha = alpha;
  context.lineCap = "round";
  context.strokeStyle = beamColor;
  context.shadowBlur = isRailgun ? 26 : 18;
  context.shadowColor = beamColor;
  context.lineWidth = isRailgun ? 16 : 9;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.shadowBlur = 0;
  context.strokeStyle = "#ffffff";
  context.lineWidth = isRailgun ? 4 : 2;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawRailgunTelegraph(
  context: CanvasRenderingContext2D,
  effect: { color: string; radius: number; age: number; duration: number },
  start: Vec2,
  end: Vec2
) {
  const charge = Math.min(1, effect.age / 1);
  const locked = effect.age >= 1;

  context.save();
  context.globalAlpha = locked ? 0.72 : 0.16 + charge * 0.5;
  context.lineCap = "round";
  context.strokeStyle = effect.color;
  context.shadowBlur = 14 + charge * 22;
  context.shadowColor = effect.color;
  context.lineWidth = 5 + charge * 22;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.shadowBlur = 0;
  context.globalAlpha = locked ? 0.58 : 0.08 + charge * 0.24;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 1 + charge * 5;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawConeEffect(
  context: CanvasRenderingContext2D,
  effect: { color: string; radius: number },
  start: Vec2,
  end: Vec2,
  alpha: number
) {
  const direction = normalizeScreen(subScreen(end, start));
  const side = { x: -direction.y, y: direction.x };
  const coneLength = Math.min(260, distanceScreen(start, end));
  const center = {
    x: start.x + direction.x * coneLength,
    y: start.y + direction.y * coneLength,
  };
  const spread = Math.max(54, effect.radius);
  const left = { x: center.x + side.x * spread, y: center.y + side.y * spread };
  const right = { x: center.x - side.x * spread, y: center.y - side.y * spread };

  context.save();
  context.globalAlpha = alpha * 0.7;
  context.fillStyle = effect.color;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(left.x, left.y);
  context.lineTo(right.x, right.y);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawParticleStar(
  context: CanvasRenderingContext2D,
  position: Vec2,
  radius: number,
  age: number
) {
  context.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = age * 9 + (Math.PI * 2 * index) / 6;
    const x = position.x + Math.cos(angle) * radius;
    const y = position.y + Math.sin(angle) * radius;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();
  context.fill();
}

function drawProjectiles(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  arena: ArenaConfig,
  layout: Layout
) {
  for (const projectile of frame.projectiles) {
    const position = mapPoint(projectile.position, arena, layout.arena);
    const isRocketLike = projectile.weaponId === "missile" || projectile.weaponId === "rocket";
    const radius = Math.max(isRocketLike ? 12 : 8, projectile.radius * 0.75);
    const angle = Math.atan2(projectile.velocity.y, projectile.velocity.x);
    context.save();
    context.translate(position.x, position.y);
    context.rotate(projectile.weaponId === "boomerang" ? projectile.age * 13 : angle);
    context.fillStyle = projectileColor(projectile.weaponId);
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3;

    if (projectile.weaponId === "shotgun") {
      context.shadowBlur = 12;
      context.shadowColor = "#ffd166";
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else if (projectile.weaponId === "blast-rifle") {
      context.shadowBlur = 16;
      context.shadowColor = "#ff4f7d";
      context.fillStyle = "#ff4f7d";
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(-radius * 1.2, -radius * 0.55, radius * 2.4, radius * 1.1, radius * 0.55);
      context.fill();
      context.stroke();
      context.strokeStyle = "#ffb3c6";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(-radius * 1.7, 0);
      context.lineTo(-radius * 2.8, 0);
      context.stroke();
    } else if (projectile.weaponId === "boomerang") {
      context.beginPath();
      context.arc(0, 0, radius * 1.15, Math.PI * 0.2, Math.PI * 1.55);
      context.lineWidth = 7;
      context.strokeStyle = "#d7f8ff";
      context.stroke();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.stroke();
    } else {
      context.shadowBlur = isRocketLike ? 18 : 10;
      context.shadowColor = projectileColor(projectile.weaponId);
      context.beginPath();
      context.moveTo(radius * 1.45, 0);
      context.lineTo(-radius * 0.9, -radius * 0.72);
      context.lineTo(-radius * 0.36, 0);
      context.lineTo(-radius * 0.9, radius * 0.72);
      context.closePath();
      context.fill();
      context.stroke();

      if (isRocketLike) {
        context.fillStyle = "#ffdd78";
        context.beginPath();
        context.moveTo(-radius * 0.85, 0);
        context.lineTo(-radius * 1.65, -radius * 0.44);
        context.lineTo(-radius * 1.45, 0);
        context.lineTo(-radius * 1.65, radius * 0.44);
        context.closePath();
        context.fill();
      }
    }
    context.restore();
  }
}

function drawRobots(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  arena: ArenaConfig,
  layout: Layout
) {
  for (const robot of frame.robots) {
    if (!robot.alive) {
      continue;
    }

    const position = mapPoint(robot.position, arena, layout.arena);
    context.save();
    context.translate(position.x, position.y);
    context.rotate(robot.angle);
    context.scale(1.2, 1.2);
    context.globalAlpha = robot.alive ? 1 : 0.38;

    drawRobotBody(context, robot);

    if (robot.shield > 1) {
      context.strokeStyle = robot.palette.glow;
      context.globalAlpha = 0.28 + Math.min(0.35, robot.shield / robot.maxShield / 2);
      context.lineWidth = 4;
      context.beginPath();
      context.arc(0, 0, ROBOT_RADIUS + 8, 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }
}

function drawRobotBody(context: CanvasRenderingContext2D, robot: RobotFrame) {
  context.shadowBlur = robot.alive ? 20 : 0;
  context.shadowColor = robot.palette.glow;
  context.fillStyle = robot.palette.body;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4;

  if (robot.classId === "bulwark") {
    context.beginPath();
    context.roundRect(-40, -33, 80, 66, 8);
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = robot.palette.trim;
    context.fillRect(-18, -30, 26, 60);
    context.fillStyle = robot.palette.glow;
    context.fillRect(20, -18, 28, 36);
    context.fillStyle = "#f9fbff";
    context.fillRect(-30, -19, 13, 12);
    context.fillRect(-30, 7, 13, 12);
    return;
  }

  if (robot.classId === "trickster") {
    context.beginPath();
    context.moveTo(0, -39);
    context.lineTo(42, 0);
    context.lineTo(0, 39);
    context.lineTo(-36, 0);
    context.closePath();
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = robot.palette.trim;
    context.beginPath();
    context.arc(0, 0, 18, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = robot.palette.glow;
    context.fillRect(24, -12, 24, 24);
    context.fillStyle = "#f9fbff";
    context.fillRect(-18, -15, 11, 10);
    context.fillRect(-18, 5, 11, 10);
    return;
  }

  context.beginPath();
  context.moveTo(43, 0);
  context.lineTo(16, -34);
  context.lineTo(-34, -28);
  context.lineTo(-27, 28);
  context.lineTo(16, 34);
  context.closePath();
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = robot.palette.trim;
  context.fillRect(-8, -27, 28, 54);
  context.fillStyle = robot.palette.glow;
  context.fillRect(24, -14, 24, 28);
  context.fillStyle = "#f9fbff";
  context.fillRect(-23, -16, 12, 10);
  context.fillRect(-23, 6, 12, 10);
}

function drawFloatingActions(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  result: FightResult,
  layout: Layout
) {
  const activeWeapons = result.events.filter(
    (event): event is Extract<FightEvent, { type: "weapon" }> =>
      event.type === "weapon" && frame.time >= event.time && frame.time <= event.time + 1
  );

  for (const event of activeWeapons) {
    const robot = frame.robots.find((candidate) => candidate.id === event.robotId);
    if (!robot) {
      continue;
    }

    const weapon = getWeaponName(event.weaponId);
    const position = mapPoint(robot.position, result.config.arena, layout.arena);
    const age = frame.time - event.time;
    const alpha = Math.max(0, 1 - age);
    const y = position.y - 58 - age * 34;

    context.save();
    context.globalAlpha = alpha;
    context.textAlign = "center";
    context.font = "900 30px Inter, system-ui, sans-serif";
    context.lineWidth = 8;
    context.strokeStyle = "rgba(7, 12, 17, 0.82)";
    context.fillStyle = robot.palette.glow;
    context.strokeText(weapon, position.x, y);
    context.fillText(weapon, position.x, y);
    context.restore();
  }
}

function drawActionBar(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  result: FightResult,
  layout: Layout
) {
  const rect = layout.actionBar;
  context.save();
  context.fillStyle = "rgba(7, 12, 17, 0.86)";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);

  const grid = actionBarGrid(frame.robots.length);
  const padX = grid.columns >= 3 ? 22 : 29;
  const padY = grid.rows > 1 ? 18 : 22;
  const panelGap = grid.columns >= 3 ? 14 : 18;
  const rowGap = grid.rows > 1 ? 14 : 0;
  const panelWidth = (rect.width - padX * 2 - panelGap * (grid.columns - 1)) / grid.columns;
  const panelHeight = (rect.height - padY * 2 - rowGap * (grid.rows - 1)) / grid.rows;

  frame.robots.forEach((robot, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const panelX = rect.x + padX + column * (panelWidth + panelGap);
    const panelY = rect.y + padY + row * (panelHeight + rowGap);
    drawBotActionPanel(context, robot, result, frame.time, {
      x: panelX,
      y: panelY,
      width: panelWidth,
      height: panelHeight,
    });
  });

  context.restore();
}

function actionBarGrid(robotCount: number): { columns: number; rows: number } {
  if (robotCount <= 2) {
    return { columns: Math.max(1, robotCount), rows: 1 };
  }

  if (robotCount === 3) {
    return { columns: 3, rows: 1 };
  }

  const columns = Math.ceil(robotCount / 2);
  return { columns, rows: 2 };
}

function drawBotActionPanel(
  context: CanvasRenderingContext2D,
  robot: RobotFrame,
  result: FightResult,
  time: number,
  rect: Rect
) {
  const config = result.config.robots.find((candidate) => candidate.id === robot.id);
  const movement = latestMovement(result.events, robot.id, time);
  const weapon = latestWeapon(result.events, robot.id, time);

  context.save();
  context.fillStyle = "rgba(255, 250, 240, 0.08)";
  context.strokeStyle = robot.palette.glow;
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, 10);
  context.fill();
  context.stroke();

  context.fillStyle = robot.palette.body;
  context.fillRect(rect.x, rect.y, 9, rect.height);

  const compact = rect.width < 320 || rect.height < 250;
  const sidePad = compact ? 16 : 24;
  const padX = rect.x + sidePad;
  const innerWidth = rect.width - sidePad * 2;
  const headerY = rect.y + (compact ? 28 : 34);
  const movementY = rect.y + (compact ? 42 : 50);
  const movementHeight = compact ? Math.max(58, Math.min(76, rect.height * 0.34)) : 94;
  const weaponY = movementY + movementHeight + (compact ? 10 : 14);
  const weaponHeight = Math.max(44, rect.y + rect.height - weaponY - (compact ? 14 : 30));

  // Class name (left) and the current action readout (right) share the header
  // row — no "MOVEMENT" / "WEAPONS" labels above the boxes.
  context.textAlign = "left";
  context.fillStyle = "#fff7e6";
  context.font = `900 ${compact ? 18 : 24}px Inter, system-ui, sans-serif`;
  context.fillText(getClassName(robot.classId), padX, headerY, innerWidth * 0.58);
  context.textAlign = "right";
  context.fillStyle = "#9feee2";
  context.font = `800 ${compact ? 12 : 16}px Inter, system-ui, sans-serif`;
  context.fillText(
    robot.lastWeapon ? getWeaponName(robot.lastWeapon) : "",
    padX + innerWidth,
    headerY,
    innerWidth * 0.38
  );

  drawMovementSlot(
    context,
    config?.movementDice.map((die) => die.id) ?? [robot.lastMove],
    movement,
    robot,
    time,
    { x: padX, y: movementY, width: innerWidth, height: movementHeight }
  );

  drawWeaponList(context, config?.arsenal ?? [], weapon, robot.palette.glow, time, {
    x: padX,
    y: weaponY,
    width: innerWidth,
    height: weaponHeight,
  });

  context.restore();
}

// Slot-machine style reel: the movement labels scroll vertically, spinning fast
// for the first half-second after each pick before easing to a stop on the
// chosen move.
function drawMovementSlot(
  context: CanvasRenderingContext2D,
  moves: MovementId[],
  event: Extract<FightEvent, { type: "movement" }> | undefined,
  robot: RobotFrame,
  time: number,
  rect: Rect
) {
  const list = moves.length > 0 ? moves : [robot.lastMove];
  const selectedId = event?.movement ?? robot.lastMove;
  const selectedIndex = Math.max(0, list.indexOf(selectedId));
  const age = event ? time - event.time : 99;
  const spinning = age >= 0 && age < SLOT_SPIN_SECONDS;

  // Reel position: lands exactly on selectedIndex once settled.
  let position = selectedIndex;
  if (spinning && list.length > 1) {
    const t = age / SLOT_SPIN_SECONDS;
    const eased = 1 - Math.pow(1 - t, 3);
    position = selectedIndex - list.length * 4 * (1 - eased);
  }

  context.save();
  context.fillStyle = "rgba(8, 13, 19, 0.92)";
  context.strokeStyle = spinning ? "#ffdd78" : robot.palette.glow;
  context.lineWidth = spinning ? 3 : 2;
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, 8);
  context.fill();
  context.stroke();
  context.clip();

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const base = Math.floor(position);
  const selectedFontSize = Math.max(16, Math.min(26, rect.height * 0.3, rect.width * 0.105));
  const idleFontSize = Math.max(13, Math.min(20, selectedFontSize - 5));
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let offset = -1; offset <= 1; offset += 1) {
    const slot = base + offset;
    const wrapped = ((slot % list.length) + list.length) % list.length;
    const y = centerY + (slot - position) * rect.height;
    const distance = Math.abs(slot - position);
    context.globalAlpha = Math.max(0, 1 - distance * 0.85);
    context.fillStyle = distance < 0.5 ? "#fff7e6" : "#7fb8c4";
    context.font =
      distance < 0.5
        ? `900 ${selectedFontSize}px Inter, system-ui, sans-serif`
        : `800 ${idleFontSize}px Inter, system-ui, sans-serif`;
    context.fillText(formatMovement(list[wrapped]), centerX, y, rect.width - 16);
  }
  context.globalAlpha = 1;
  context.textBaseline = "alphabetic";
  context.restore();

  // Center selection guides.
  context.save();
  context.strokeStyle = spinning ? "rgba(255, 221, 120, 0.6)" : "rgba(159, 238, 226, 0.45)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(rect.x + 6, rect.y + rect.height / 2 - 18);
  context.lineTo(rect.x + 6, rect.y + rect.height / 2 + 18);
  context.moveTo(rect.x + rect.width - 6, rect.y + rect.height / 2 - 18);
  context.lineTo(rect.x + rect.width - 6, rect.y + rect.height / 2 + 18);
  context.stroke();
  context.restore();
}

// Horizontal list of every weapon in the arsenal. After each pick the highlight
// flickers across the tiles slot-style, then settles on the executed weapon.
function drawWeaponList(
  context: CanvasRenderingContext2D,
  arsenal: WeaponId[],
  event: Extract<FightEvent, { type: "weapon" }> | undefined,
  accent: string,
  time: number,
  rect: Rect
) {
  const list = arsenal.slice(0, 6);
  if (list.length === 0) {
    return;
  }

  const selectedIndex = event ? Math.max(0, list.indexOf(event.weaponId)) : -1;
  const age = event ? time - event.time : 99;
  const spinning = age >= 0 && age < SLOT_SPIN_SECONDS;
  const highlightIndex = spinning
    ? Math.floor((age / SLOT_SPIN_SECONDS) * list.length * 4) % list.length
    : selectedIndex;

  const gap = rect.width < 220 ? 6 : 10;
  const tileSize = Math.min(rect.height, (rect.width - gap * (list.length - 1)) / list.length);
  const totalWidth = tileSize * list.length + gap * (list.length - 1);
  let x = rect.x + (rect.width - totalWidth) / 2;
  const y = rect.y + (rect.height - tileSize) / 2;

  list.forEach((weaponId, index) => {
    const active = index === highlightIndex;
    context.save();
    context.fillStyle = active ? "rgba(255, 221, 120, 0.24)" : "rgba(255, 255, 255, 0.08)";
    context.strokeStyle = active ? "#ffdd78" : accent;
    context.lineWidth = active ? 3 : 1.5;
    if (active && spinning) {
      context.shadowBlur = 16;
      context.shadowColor = "#ffdd78";
    }
    context.beginPath();
    context.roundRect(x, y, tileSize, tileSize, 8);
    context.fill();
    context.stroke();
    context.restore();

    context.save();
    if (!active) {
      context.globalAlpha = 0.7;
    }
    drawWeaponIcon(context, weaponId, { x, y, width: tileSize, height: tileSize });
    context.restore();

    x += tileSize + gap;
  });
}

function drawWinnerCard(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  result: FightResult,
  layout: Layout
) {
  const winnerEvent = result.events.find((event) => event.type === "winner");
  if (!winnerEvent || frame.time < winnerEvent.time) {
    return;
  }

  const winner = frame.robots.find((robot) => robot.id === winnerEvent.winnerId);
  context.save();
  context.fillStyle = "rgba(7, 12, 17, 0.8)";
  context.fillRect(0, layout.arena.y + layout.arena.height * 0.35, layout.width, 270);
  context.textAlign = "center";
  context.fillStyle = "#ffdd78";
  context.font = "900 72px Inter, system-ui, sans-serif";
  context.fillText("WINNER", layout.width / 2, layout.arena.y + layout.arena.height * 0.35 + 105);
  context.fillStyle = "#ffffff";
  context.font = "800 56px Inter, system-ui, sans-serif";
  context.fillText(winner ? getClassName(winner.classId) : "Draw", layout.width / 2, layout.arena.y + layout.arena.height * 0.35 + 178);
  context.restore();
}

export function drawIntroCard(context: CanvasRenderingContext2D, names: string[]) {
  const layout = createLayout(context, names.length);
  const bandY = layout.arena.y + layout.arena.height * 0.35;

  context.save();
  context.fillStyle = "rgba(7, 12, 17, 0.8)";
  context.fillRect(0, bandY, layout.width, 270);
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.font = "900 58px Inter, system-ui, sans-serif";
  context.fillText(names.join("  vs  "), layout.width / 2, bandY + 105);
  context.fillStyle = "#ffdd78";
  context.font = "800 46px Inter, system-ui, sans-serif";
  context.fillText("WHO WILL WIN?", layout.width / 2, bandY + 178);
  context.restore();
}

function mapPoint(point: Vec2, arena: ArenaConfig, rect: Rect): Vec2 {
  return {
    x: rect.x + (point.x / arena.width) * rect.width,
    y: rect.y + (point.y / arena.height) * rect.height,
  };
}

function projectileColor(weaponId: WeaponId): string {
  switch (weaponId) {
    case "missile":
      return "#ff8f4f";
    case "boomerang":
      return "#d7f8ff";
    case "blade":
      return "#ff2f55";
    case "blast-rifle":
      return "#ff4f7d";
    case "mine":
      return "#f6c85f";
    case "emp":
      return "#a9fffd";
    case "railgun":
      return "#36e0ff";
    case "rocket":
      return "#ff6a3d";
    case "shotgun":
      return "#ffd166";
    case "shield":
      return "#7ef7c7";
    case "ray":
    default:
      return "#a9fffd";
  }
}

function drawWeaponIcon(context: CanvasRenderingContext2D, weaponId: WeaponId, rect: Rect) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const color = projectileColor(weaponId);

  context.save();
  context.translate(center.x, center.y);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowBlur = 10;
  context.shadowColor = color;

  switch (weaponId) {
    case "ray":
      context.lineWidth = 7;
      context.beginPath();
      context.moveTo(-18, 12);
      context.lineTo(-3, -5);
      context.lineTo(6, 2);
      context.lineTo(18, -16);
      context.stroke();
      break;
    case "missile":
      context.rotate(-0.35);
      context.beginPath();
      context.moveTo(20, 0);
      context.lineTo(-10, -14);
      context.lineTo(-4, 0);
      context.lineTo(-10, 14);
      context.closePath();
      context.fill();
      context.fillStyle = "#ffdd78";
      context.beginPath();
      context.moveTo(-12, 0);
      context.lineTo(-24, -8);
      context.lineTo(-20, 0);
      context.lineTo(-24, 8);
      context.closePath();
      context.fill();
      break;
    case "boomerang":
      context.lineWidth = 9;
      context.beginPath();
      context.arc(0, 0, 20, Math.PI * 0.15, Math.PI * 1.45);
      context.stroke();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 3;
      context.stroke();
      break;
    case "blade":
      context.rotate(-0.55);
      context.strokeStyle = "#ff2f55";
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(-23, 9);
      context.lineTo(18, -16);
      context.stroke();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-10, 1);
      context.lineTo(14, -13);
      context.stroke();
      context.fillStyle = "#2b1219";
      context.fillRect(-25, 6, 12, 7);
      break;
    case "blast-rifle":
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(-23, 6);
      context.lineTo(6, -7);
      context.lineTo(23, -5);
      context.lineTo(9, 5);
      context.lineTo(-2, 14);
      context.closePath();
      context.fill();
      context.stroke();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      for (let index = 0; index < 3; index += 1) {
        context.beginPath();
        context.moveTo(8 + index * 7, -13 + index * 2);
        context.lineTo(17 + index * 5, -17 + index * 2);
        context.stroke();
      }
      break;
    case "shotgun":
      context.globalAlpha = 0.85;
      context.beginPath();
      context.moveTo(-20, 10);
      context.lineTo(20, -18);
      context.lineTo(16, 22);
      context.closePath();
      context.fill();
      break;
    case "mine":
      context.beginPath();
      context.arc(0, 2, 17, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 3;
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        context.beginPath();
        context.moveTo(Math.cos(angle) * 17, 2 + Math.sin(angle) * 17);
        context.lineTo(Math.cos(angle) * 24, 2 + Math.sin(angle) * 24);
        context.stroke();
      }
      break;
    case "shield":
      context.lineWidth = 7;
      context.beginPath();
      context.arc(0, 0, 21, Math.PI * 0.15, Math.PI * 1.85);
      context.stroke();
      context.beginPath();
      context.moveTo(0, -17);
      context.lineTo(14, -4);
      context.lineTo(9, 18);
      context.lineTo(0, 24);
      context.lineTo(-9, 18);
      context.lineTo(-14, -4);
      context.closePath();
      context.stroke();
      break;
    case "emp":
      context.lineWidth = 5;
      for (let index = 0; index < 3; index += 1) {
        context.beginPath();
        context.arc(0, 0, 8 + index * 8, 0, Math.PI * 2);
        context.stroke();
      }
      break;
    case "railgun":
      context.lineWidth = 6;
      context.beginPath();
      context.moveTo(-23, 0);
      context.lineTo(23, 0);
      context.stroke();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-18, -10);
      context.lineTo(18, -10);
      context.moveTo(-18, 10);
      context.lineTo(18, 10);
      context.stroke();
      break;
    case "rocket":
      context.rotate(-0.35);
      context.beginPath();
      context.moveTo(22, 0);
      context.lineTo(2, -10);
      context.lineTo(-16, -10);
      context.lineTo(-16, 10);
      context.lineTo(2, 10);
      context.closePath();
      context.fill();
      context.fillStyle = "#ffdd78";
      context.beginPath();
      context.moveTo(-16, -6);
      context.lineTo(-28, -10);
      context.lineTo(-22, 0);
      context.lineTo(-28, 10);
      context.lineTo(-16, 6);
      context.closePath();
      context.fill();
      break;
  }

  context.restore();
}

function healthShakeFor(robotId: string, time: number, events: FightEvent[]): number {
  const hits = events
    .filter(
      (event): event is Extract<FightEvent, { type: "hit" }> =>
        event.type === "hit" && event.targetId === robotId && event.time <= time
    );
  const lastHit = hits[hits.length - 1];

  if (!lastHit) {
    return 0;
  }

  const age = time - lastHit.time;
  return age >= 0 && age <= 0.28 ? 1 - age / 0.28 : 0;
}

function getClassName(classId: string): string {
  return ROBOT_CLASSES.find((robotClass) => robotClass.id === classId)?.name ?? classId;
}

function subScreen(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function distanceScreen(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeScreen(vector: Vec2): Vec2 {
  const size = Math.hypot(vector.x, vector.y);
  return size > 0.001 ? { x: vector.x / size, y: vector.y / size } : { x: 1, y: 0 };
}

function clipRect(context: CanvasRenderingContext2D, rect: Rect) {
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
}

function latestMovement(
  events: FightEvent[],
  robotId: string,
  time: number
): Extract<FightEvent, { type: "movement" }> | undefined {
  const matches = events
    .filter(
      (event): event is Extract<FightEvent, { type: "movement" }> =>
        event.type === "movement" && event.robotId === robotId && event.time <= time
    );
  return matches[matches.length - 1];
}

function latestWeapon(
  events: FightEvent[],
  robotId: string,
  time: number
): Extract<FightEvent, { type: "weapon" }> | undefined {
  const matches = events
    .filter(
      (event): event is Extract<FightEvent, { type: "weapon" }> =>
        event.type === "weapon" && event.robotId === robotId && event.time <= time
    );
  return matches[matches.length - 1];
}

function getWeaponName(weaponId: WeaponId): string {
  return WEAPONS.find((weapon) => weapon.id === weaponId)?.name ?? weaponId;
}

function formatMovement(movement: MovementId): string {
  return movement
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
