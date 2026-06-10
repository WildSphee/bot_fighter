import type { ArenaConfig, FightFrame, FightResult } from "../sim/types";

const ROBOT_RADIUS = 36;

export function drawFightFrame(
  context: CanvasRenderingContext2D,
  frame: FightFrame,
  result: FightResult
) {
  const { arena } = result.config;

  context.clearRect(0, 0, arena.width, arena.height);
  drawArena(context, arena);
  drawEffects(context, frame);
  drawProjectiles(context, frame);
  drawRobots(context, frame);
  drawHud(context, frame, result);
}

function drawArena(context: CanvasRenderingContext2D, arena: ArenaConfig) {
  const gradient = context.createLinearGradient(0, 0, arena.width, arena.height);
  gradient.addColorStop(0, "#14242d");
  gradient.addColorStop(0.55, "#251a33");
  gradient.addColorStop(1, "#342524");
  context.fillStyle = gradient;
  context.fillRect(0, 0, arena.width, arena.height);

  context.save();
  context.globalAlpha = 0.28;
  context.strokeStyle = "#8ae9ff";
  context.lineWidth = 1;
  for (let x = 80; x < arena.width; x += 80) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, arena.height);
    context.stroke();
  }
  for (let y = 80; y < arena.height; y += 80) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(arena.width, y);
    context.stroke();
  }
  context.restore();

  context.strokeStyle = "#ffdd78";
  context.lineWidth = 8;
  context.strokeRect(20, 20, arena.width - 40, arena.height - 40);
  context.strokeStyle = "#2fffc8";
  context.lineWidth = 2;
  context.strokeRect(42, 42, arena.width - 84, arena.height - 84);
}

function drawEffects(context: CanvasRenderingContext2D, frame: FightFrame) {
  for (const effect of frame.effects) {
    const alpha = Math.max(0, 1 - effect.age / effect.duration);
    context.save();
    context.globalAlpha = alpha * 0.75;
    context.strokeStyle = effect.color;
    context.fillStyle = effect.color;
    context.lineWidth = effect.type === "trail" ? 5 : 8;
    context.beginPath();
    context.arc(effect.position.x, effect.position.y, effect.radius * (1 + effect.age), 0, Math.PI * 2);
    if (effect.type === "shield" || effect.type === "emp") {
      context.stroke();
    } else {
      context.fill();
    }
    context.restore();
  }
}

function drawProjectiles(context: CanvasRenderingContext2D, frame: FightFrame) {
  for (const projectile of frame.projectiles) {
    context.save();
    context.translate(projectile.position.x, projectile.position.y);
    context.rotate(projectile.age * 9);
    context.fillStyle = projectile.weaponId === "missile" ? "#ff8f4f" : "#a9fffd";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(projectile.radius, 0);
    context.lineTo(-projectile.radius * 0.7, -projectile.radius * 0.65);
    context.lineTo(-projectile.radius * 0.3, 0);
    context.lineTo(-projectile.radius * 0.7, projectile.radius * 0.65);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }
}

function drawRobots(context: CanvasRenderingContext2D, frame: FightFrame) {
  for (const robot of frame.robots) {
    context.save();
    context.translate(robot.position.x, robot.position.y);
    context.rotate(robot.angle);
    context.globalAlpha = robot.alive ? 1 : 0.38;

    context.shadowBlur = robot.alive ? 18 : 0;
    context.shadowColor = robot.palette.glow;
    context.fillStyle = robot.palette.body;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(-34, -30, 68, 60, 10);
    context.fill();
    context.stroke();

    context.shadowBlur = 0;
    context.fillStyle = robot.palette.trim;
    context.fillRect(-8, -26, 28, 52);
    context.fillStyle = robot.palette.glow;
    context.fillRect(20, -14, 22, 28);
    context.fillStyle = "#f9fbff";
    context.fillRect(-24, -16, 12, 10);
    context.fillRect(-24, 6, 12, 10);

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

function drawHud(context: CanvasRenderingContext2D, frame: FightFrame, result: FightResult) {
  context.save();
  context.fillStyle = "rgba(7, 12, 17, 0.62)";
  context.fillRect(0, 0, result.config.arena.width, 126);
  context.fillRect(0, result.config.arena.height - 112, result.config.arena.width, 112);

  context.font = "700 34px Inter, system-ui, sans-serif";
  context.fillStyle = "#fff7e6";
  context.fillText("BOT FIGHTER", 34, 50);
  context.font = "600 22px Inter, system-ui, sans-serif";
  context.fillStyle = "#a9fffd";
  context.fillText(`Seed ${result.config.seed}`, 34, 86);

  const timeLeft = Math.max(0, result.duration - frame.time);
  context.textAlign = "right";
  context.fillStyle = "#fff7e6";
  context.font = "800 42px Inter, system-ui, sans-serif";
  context.fillText(timeLeft.toFixed(1), result.config.arena.width - 34, 60);
  context.font = "600 20px Inter, system-ui, sans-serif";
  context.fillText("seconds", result.config.arena.width - 34, 88);

  drawHealthBars(context, frame, result);

  const winnerEvent = result.events.find((event) => event.type === "winner");
  if (winnerEvent && frame.time >= winnerEvent.time) {
    const winner = frame.robots.find((robot) => robot.id === winnerEvent.winnerId);
    context.fillStyle = "rgba(7, 12, 17, 0.78)";
    context.fillRect(0, 520, result.config.arena.width, 310);
    context.textAlign = "center";
    context.fillStyle = "#ffdd78";
    context.font = "900 74px Inter, system-ui, sans-serif";
    context.fillText("WINNER", result.config.arena.width / 2, 640);
    context.fillStyle = "#ffffff";
    context.font = "800 58px Inter, system-ui, sans-serif";
    context.fillText(winner?.name ?? "Draw", result.config.arena.width / 2, 720);
  }

  context.restore();
}

function drawHealthBars(context: CanvasRenderingContext2D, frame: FightFrame, result: FightResult) {
  const barWidth = 270;
  const barHeight = 22;

  frame.robots.slice(0, 4).forEach((robot, index) => {
    const x = index % 2 === 0 ? 34 : result.config.arena.width - barWidth - 34;
    const y = result.config.arena.height - 84 + Math.floor(index / 2) * 38;

    context.textAlign = index % 2 === 0 ? "left" : "right";
    context.fillStyle = "#fff7e6";
    context.font = "700 22px Inter, system-ui, sans-serif";
    context.fillText(robot.name, index % 2 === 0 ? x : x + barWidth, y - 10);

    context.fillStyle = "rgba(255,255,255,0.18)";
    context.fillRect(x, y, barWidth, barHeight);
    context.fillStyle = robot.palette.body;
    context.fillRect(x, y, barWidth * Math.max(0, robot.hp / robot.maxHp), barHeight);
    context.fillStyle = robot.palette.glow;
    context.fillRect(x, y + barHeight - 5, barWidth * Math.max(0, robot.shield / robot.maxShield), 5);
  });
}
