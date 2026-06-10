import { WEAPONS } from "../sim/catalog";
import type {
  ArenaConfig,
  FightEvent,
  FightFrame,
  FightResult,
  MovementId,
  RobotFrame,
  Vec2,
  WeaponId,
} from "../sim/types";

const TOP_BAR_HEIGHT = 168;
const ACTION_BAR_HEIGHT = 330;
const FIELD_PADDING_X = 64;
const FIELD_GAP_TOP = 28;
const FIELD_GAP_BOTTOM = 44;
const ROBOT_RADIUS = 30;

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
  const layout = createLayout(context);

  context.clearRect(0, 0, layout.width, layout.height);
  drawBackground(context, layout);
  drawTopBar(context, frame, result, layout);
  drawArena(context, result.config.arena, layout);

  context.save();
  clipRect(context, layout.arena);
  drawEffects(context, frame, result.config.arena, layout);
  drawProjectiles(context, frame, result.config.arena, layout);
  drawRobots(context, frame, result.config.arena, layout);
  context.restore();

  drawFloatingActions(context, frame, result, layout);
  drawActionBar(context, frame, result, layout);
  drawWinnerCard(context, frame, result, layout);
}

function createLayout(context: CanvasRenderingContext2D): Layout {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const actionBarY = height - ACTION_BAR_HEIGHT;
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
    actionBar: { x: 0, y: actionBarY, width, height: ACTION_BAR_HEIGHT },
  };
}

function drawBackground(context: CanvasRenderingContext2D, layout: Layout) {
  const gradient = context.createLinearGradient(0, 0, layout.width, layout.height);
  gradient.addColorStop(0, "#0e1b22");
  gradient.addColorStop(0.5, "#221a2b");
  gradient.addColorStop(1, "#2d231f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, layout.width, layout.height);

  context.save();
  context.globalAlpha = 0.28;
  context.fillStyle = "#ffdd78";
  context.fillRect(0, layout.topBar.height - 4, layout.width, 4);
  context.fillStyle = "#2fffc8";
  context.fillRect(0, layout.actionBar.y, layout.width, 4);
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
  context.fillText("BOT FIGHTER", layout.width / 2, 44);

  const timeLeft = Math.max(0, result.duration - frame.time);
  context.fillStyle = "#ffdd78";
  context.font = "800 28px Inter, system-ui, sans-serif";
  context.fillText(timeLeft.toFixed(1), layout.width / 2, 82);
  context.fillStyle = "#9feee2";
  context.font = "700 16px Inter, system-ui, sans-serif";
  context.fillText(`Seed ${result.config.seed}`, layout.width / 2, 110);

  const slots = topSlots(frame.robots, layout);
  frame.robots.slice(0, 4).forEach((robot, index) => {
    drawTopRobotStatus(context, robot, slots[index], index % 2 === 1);
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
  alignRight: boolean
) {
  const hpRatio = Math.max(0, robot.hp / robot.maxHp);
  const shieldRatio = Math.max(0, robot.shield / robot.maxShield);
  const textX = alignRight ? rect.x + rect.width : rect.x;

  context.textAlign = alignRight ? "right" : "left";
    context.fillStyle = "rgba(255,255,255,0.16)";
    context.fillRect(rect.x, rect.y + rect.height - 42, rect.width, 24);
  context.fillStyle = robot.palette.body;
  context.fillRect(rect.x, rect.y + rect.height - 42, rect.width * hpRatio, 24);
  context.fillStyle = robot.palette.glow;
  context.fillRect(rect.x, rect.y + rect.height - 14, rect.width * shieldRatio, 7);

  context.fillStyle = "#fff7e6";
  context.font = "900 30px Inter, system-ui, sans-serif";
  context.fillText(robot.name, textX, rect.y + 28);
  context.fillStyle = "#ffffff";
  context.font = "800 19px Inter, system-ui, sans-serif";
  context.fillText(`${Math.ceil(robot.hp)} / ${robot.maxHp} HP`, textX, rect.y + 56);
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
  context.fillStyle = gradient;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);

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

  context.strokeStyle = "#ffdd78";
  context.lineWidth = 8;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeStyle = "#2fffc8";
  context.lineWidth = 2;
  context.strokeRect(rect.x + 20, rect.y + 20, rect.width - 40, rect.height - 40);

  context.save();
  context.textAlign = "right";
  context.fillStyle = "rgba(255, 247, 230, 0.5)";
  context.font = "700 16px Inter, system-ui, sans-serif";
  context.fillText(arena.name, rect.x + rect.width - 24, rect.y + 34);
  context.restore();
}

function drawEffects(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  arena: ArenaConfig,
  layout: Layout
) {
  for (const effect of frame.effects) {
    const position = mapPoint(effect.position, arena, layout.arena);
    const alpha = Math.max(0, 1 - effect.age / effect.duration);
    context.save();
    context.globalAlpha = alpha * 0.75;
    context.strokeStyle = effect.color;
    context.fillStyle = effect.color;
    context.lineWidth = effect.type === "trail" ? 4 : 7;
    context.beginPath();
    context.arc(position.x, position.y, effect.radius * 0.68 * (1 + effect.age), 0, Math.PI * 2);
    if (effect.type === "shield" || effect.type === "emp") {
      context.stroke();
    } else {
      context.fill();
    }
    context.restore();
  }
}

function drawProjectiles(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  arena: ArenaConfig,
  layout: Layout
) {
  for (const projectile of frame.projectiles) {
    const position = mapPoint(projectile.position, arena, layout.arena);
    const radius = Math.max(7, projectile.radius * 0.7);
    context.save();
    context.translate(position.x, position.y);
    context.rotate(projectile.age * 9);
    context.fillStyle = projectile.weaponId === "missile" ? "#ff8f4f" : "#a9fffd";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(-radius * 0.7, -radius * 0.65);
    context.lineTo(-radius * 0.3, 0);
    context.lineTo(-radius * 0.7, radius * 0.65);
    context.closePath();
    context.fill();
    context.stroke();
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
    const position = mapPoint(robot.position, arena, layout.arena);
    context.save();
    context.translate(position.x, position.y);
    context.rotate(robot.angle);
    context.globalAlpha = robot.alive ? 1 : 0.38;

    context.shadowBlur = robot.alive ? 18 : 0;
    context.shadowColor = robot.palette.glow;
    context.fillStyle = robot.palette.body;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(-30, -26, 60, 52, 9);
    context.fill();
    context.stroke();

    context.shadowBlur = 0;
    context.fillStyle = robot.palette.trim;
    context.fillRect(-7, -22, 25, 44);
    context.fillStyle = robot.palette.glow;
    context.fillRect(18, -12, 20, 24);
    context.fillStyle = "#f9fbff";
    context.fillRect(-21, -13, 11, 9);
    context.fillRect(-21, 5, 11, 9);

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

  const panelGap = 18;
  const panelWidth = (rect.width - 58 - panelGap) / 2;
  const panelHeight = rect.height - 40;
  const panelY = rect.y + 22;

  frame.robots.slice(0, 2).forEach((robot, index) => {
    const panelX = 29 + index * (panelWidth + panelGap);
    drawBotActionPanel(context, robot, result, frame.time, {
      x: panelX,
      y: panelY,
      width: panelWidth,
      height: panelHeight,
    });
  });

  if (frame.robots.length > 2) {
    context.textAlign = "center";
    context.fillStyle = "#9feee2";
    context.font = "700 16px Inter, system-ui, sans-serif";
    context.fillText(`${frame.robots.length - 2} more bots in telemetry`, rect.width / 2, rect.y + rect.height - 10);
  }

  context.restore();
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
  const activeEvent = weapon && time - weapon.time <= 1 ? weapon : movement && time - movement.time <= 1 ? movement : undefined;

  context.save();
  context.fillStyle = "rgba(255, 250, 240, 0.08)";
  context.strokeStyle = robot.palette.glow;
  context.lineWidth = activeEvent ? 4 : 2;
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, 8);
  context.fill();
  context.stroke();

  context.fillStyle = robot.palette.body;
  context.fillRect(rect.x, rect.y, 9, rect.height);

  context.textAlign = "left";
  context.fillStyle = "#fff7e6";
  context.font = "900 24px Inter, system-ui, sans-serif";
  context.fillText(robot.name, rect.x + 22, rect.y + 34);

  drawDice(context, activeEvent, time, {
    x: rect.x + rect.width - 88,
    y: rect.y + 18,
    width: 58,
    height: 58,
  });

  context.fillStyle = "#9feee2";
  context.font = "800 16px Inter, system-ui, sans-serif";
  context.fillText("MOVE", rect.x + 22, rect.y + 74);
  context.fillStyle = "#ffffff";
  context.font = "900 24px Inter, system-ui, sans-serif";
  context.fillText(formatMovement(robot.lastMove), rect.x + 22, rect.y + 104);

  context.fillStyle = "#ffdd78";
  context.font = "800 16px Inter, system-ui, sans-serif";
  context.fillText("ACTION", rect.x + 22, rect.y + 138);
  context.fillStyle = "#ffffff";
  context.font = "900 22px Inter, system-ui, sans-serif";
  context.fillText(robot.lastWeapon ? getWeaponName(robot.lastWeapon) : "Waiting", rect.x + 22, rect.y + 166);

  context.fillStyle = "#cdd9d6";
  context.font = "800 14px Inter, system-ui, sans-serif";
  const rollText = activeEvent
    ? `${activeEvent.type === "weapon" ? "Weapon" : "Move"} roll ${activeEvent.roll}/${activeEvent.rollTotal}`
    : "Dice ready";
  context.fillText(rollText, rect.x + 22, rect.y + 198);

  drawLoadout(context, config?.arsenal ?? [], rect, robot.palette.glow);
  context.restore();
}

function drawDice(
  context: CanvasRenderingContext2D,
  event: Extract<FightEvent, { type: "movement" | "weapon" }> | undefined,
  time: number,
  rect: Rect
) {
  const age = event ? time - event.time : 2;
  const animating = event !== undefined && age < 0.7;
  const value = event ? (animating ? ((Math.floor(age * 28) % event.rollTotal) + 1) : event.roll) : 0;

  context.save();
  context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  if (animating) {
    context.rotate(Math.sin(age * 36) * 0.16);
  }
  context.fillStyle = animating ? "#ffdd78" : "#fff7e6";
  context.strokeStyle = "#202b35";
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, 8);
  context.fill();
  context.stroke();
  context.fillStyle = "#202b35";
  context.textAlign = "center";
  context.font = "900 24px Inter, system-ui, sans-serif";
  context.fillText(value ? String(value) : "--", 0, 9);
  context.restore();
}

function drawLoadout(
  context: CanvasRenderingContext2D,
  arsenal: WeaponId[],
  rect: Rect,
  accent: string
) {
  context.fillStyle = "#9feee2";
  context.font = "800 15px Inter, system-ui, sans-serif";
  context.fillText("ITEMS", rect.x + 22, rect.y + 232);

  let x = rect.x + 22;
  let y = rect.y + 252;
  for (const weaponId of arsenal.slice(0, 5)) {
    const label = shortWeaponName(weaponId);
    const width = Math.max(54, context.measureText(label).width + 18);
    if (x + width > rect.x + rect.width - 18) {
      x = rect.x + 22;
      y += 30;
    }
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.strokeStyle = accent;
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(x, y, width, 24, 5);
    context.fill();
    context.stroke();
    context.fillStyle = "#fff7e6";
    context.font = "800 12px Inter, system-ui, sans-serif";
    context.fillText(label, x + 9, y + 16);
    x += width + 8;
  }
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
  context.fillText(winner?.name ?? "Draw", layout.width / 2, layout.arena.y + layout.arena.height * 0.35 + 178);
  context.restore();
}

function mapPoint(point: Vec2, arena: ArenaConfig, rect: Rect): Vec2 {
  return {
    x: rect.x + (point.x / arena.width) * rect.width,
    y: rect.y + (point.y / arena.height) * rect.height,
  };
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

function shortWeaponName(weaponId: WeaponId): string {
  const name = getWeaponName(weaponId);
  return name
    .replace("Homing ", "")
    .replace("Energy ", "")
    .replace("Boomerang ", "Blade ");
}

function formatMovement(movement: MovementId): string {
  return movement
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
