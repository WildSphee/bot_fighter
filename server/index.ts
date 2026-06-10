import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  ARENAS,
  ROBOT_CLASSES,
  cloneMovementProfiles,
  cloneWeapons,
  createDefaultFightConfig,
  syncRobotWithClass,
  withClassDefaults,
} from "../src/sim/catalog";
import { simulateFight } from "../src/sim/engine";
import type {
  FightConfig,
  FightResult,
  MovementProfileMap,
  RobotClass,
  WeaponDefinition,
} from "../src/sim/types";

const PORT = Number(process.env.API_PORT ?? 8787);
const HOST = process.env.API_HOST ?? "0.0.0.0";
type GameSettings = {
  moveInterval: number;
  weaponInterval: number;
  centerGravity: number;
};

let classProfiles = cloneClassProfiles(ROBOT_CLASSES);
let movementProfiles = cloneMovementProfiles();
let weaponProfiles = cloneWeapons();
let settings: GameSettings = { moveInterval: 1, weaponInterval: 2, centerGravity: 0.35 };

const server = createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "bot-fighter-backend",
        port: PORT,
        time: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/catalog") {
      sendJson(response, 200, {
        arenas: ARENAS,
        robotClasses: classProfiles,
        movementProfiles,
        weapons: weaponProfiles,
        defaultConfig: withClassProfiles(createDefaultFightConfig(url.searchParams.get("seed") ?? undefined)),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/default-fight") {
      sendJson(response, 200, withClassProfiles(createDefaultFightConfig(url.searchParams.get("seed") ?? undefined)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/class-profiles") {
      sendJson(response, 200, { classes: classProfiles, movementProfiles, weapons: weaponProfiles, settings });
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/class-profiles") {
      const body = await readJson<{
        classes?: RobotClass[];
        movementProfiles?: MovementProfileMap;
        weapons?: WeaponDefinition[];
        settings?: Partial<GameSettings>;
      }>(request);
      if (body.classes && !body.classes.length) {
        sendJson(response, 400, { error: "classes must be a non-empty array" });
        return;
      }
      if (!body.classes && !body.movementProfiles && !body.weapons && !body.settings) {
        sendJson(response, 400, { error: "classes, movementProfiles, weapons, or settings must be provided" });
        return;
      }

      if (body.classes) {
        classProfiles = cloneClassProfiles(withClassDefaults(body.classes));
      }
      if (body.movementProfiles) {
        movementProfiles = cloneMovementProfiles(body.movementProfiles);
      }
      if (body.weapons?.length) {
        weaponProfiles = cloneWeapons(body.weapons);
      }
      if (body.settings) {
        settings = mergeSettings(settings, body.settings);
      }

      sendJson(response, 200, { classes: classProfiles, movementProfiles, weapons: weaponProfiles, settings });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/simulate") {
      const body = await readJson<{ config?: FightConfig }>(request);
      const config = body.config ?? createDefaultFightConfig();
      const result = simulateFight(config);
      sendJson(response, 200, summarizeResult(result));
      return;
    }

    sendJson(response, 404, {
      error: "Not found",
      routes: [
        "GET /api/health",
        "GET /api/catalog",
        "GET /api/default-fight",
        "GET /api/class-profiles",
        "PUT /api/class-profiles",
        "POST /api/simulate",
      ],
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown backend error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Backend API ready on http://localhost:${PORT}`);
});

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function summarizeResult(result: FightResult) {
  const winnerRobot = result.config.robots.find((robot) => robot.id === result.winnerId);
  const winnerClass = result.config.classes.find((robotClass) => robotClass.id === winnerRobot?.classId);

  return {
    seed: result.config.seed,
    winnerId: result.winnerId,
    winnerName: winnerClass?.name ?? "Draw",
    duration: result.duration,
    damageByRobot: result.damageByRobot,
    frameCount: result.frames.length,
    firstFrame: result.frames[0],
    lastFrame: result.frames[result.frames.length - 1],
    events: result.events,
  };
}

function withClassProfiles(config: FightConfig): FightConfig {
  return {
    ...config,
    ...settings,
    classes: cloneClassProfiles(classProfiles),
    movementProfiles: cloneMovementProfiles(movementProfiles),
    weapons: cloneWeapons(weaponProfiles),
    robots: config.robots.map((robot, index) =>
      syncRobotWithClass(robot, classProfiles, index, movementProfiles)
    ),
  };
}

function mergeSettings(current: GameSettings, incoming: Partial<GameSettings>): GameSettings {
  const clampNumber = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;

  return {
    moveInterval: clampNumber(incoming.moveInterval, current.moveInterval, 0.25, 4),
    weaponInterval: clampNumber(incoming.weaponInterval, current.weaponInterval, 0.25, 6),
    centerGravity: clampNumber(incoming.centerGravity, current.centerGravity, 0, 1),
  };
}

function cloneClassProfiles(classes: RobotClass[]): RobotClass[] {
  return classes.map((robotClass) => ({
    ...robotClass,
    palette: { ...robotClass.palette },
    arsenal: [...robotClass.arsenal],
  }));
}
