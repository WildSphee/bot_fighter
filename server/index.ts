import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  ApiRequestError,
  generateReelCaption,
  publishInstagramReel,
  type ReelCaptionSummary,
} from "./instagram";
import { InstagramScheduleService, startInstagramSchedulePoller } from "./instagramSchedule";
import {
  mergeSettings,
  readProfileStore,
  writeProfileStore,
  type GameSettings,
} from "./profileStore";
import {
  ARENAS,
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
const storedProfiles = readProfileStore();
let classProfiles = cloneClassProfiles(storedProfiles.classes);
let movementProfiles = cloneMovementProfiles(storedProfiles.movementProfiles);
let weaponProfiles = cloneWeapons(storedProfiles.weapons);
let settings: GameSettings = { ...storedProfiles.settings };
const scheduleService = new InstagramScheduleService();
startInstagramSchedulePoller(scheduleService);

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

      writeProfileStore({
        classes: classProfiles,
        movementProfiles,
        weapons: weaponProfiles,
        settings,
      });

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

    if (request.method === "POST" && url.pathname === "/api/reel-caption") {
      const body = await readJson<ReelCaptionSummary>(request);
      const caption = await generateReelCaption(body);
      sendJson(response, 200, { caption });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/instagram/reel") {
      const caption = url.searchParams.get("caption") ?? "";
      if (!caption.trim()) {
        sendJson(response, 400, { error: "caption is required" });
        return;
      }

      const video = await readBuffer(request);
      const contentType = request.headers["content-type"] ?? "application/octet-stream";
      const result = await publishInstagramReel(video, caption, contentType);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/instagram/schedule") {
      sendJson(response, 200, scheduleService.list());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/instagram/schedule") {
      const body = await readJson<{
        caption?: string;
        scheduledAt?: string;
        fightConfig?: FightConfig;
        soundEnabled?: boolean;
      }>(request);
      if (!body.fightConfig) {
        throw new ApiRequestError("fightConfig is required.", 400);
      }
      const job = scheduleService.create({
        caption: body.caption ?? "",
        scheduledAt: body.scheduledAt ?? "",
        fightConfig: body.fightConfig,
        soundEnabled: body.soundEnabled,
      });
      sendJson(response, 201, { job });
      return;
    }

    const scheduleRoute = matchScheduleJobRoute(url.pathname);
    if (scheduleRoute && request.method === "PATCH" && scheduleRoute.action === undefined) {
      const body = await readJson<{ caption?: string; scheduledAt?: string }>(request);
      const job = scheduleService.update(scheduleRoute.id, body);
      sendJson(response, 200, { job });
      return;
    }

    if (scheduleRoute && request.method === "POST" && scheduleRoute.action === "cancel") {
      const job = scheduleService.cancel(scheduleRoute.id);
      sendJson(response, 200, { job });
      return;
    }

    if (scheduleRoute && request.method === "POST" && scheduleRoute.action === "retry") {
      const job = scheduleService.retry(scheduleRoute.id);
      sendJson(response, 200, { job });
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
        "POST /api/reel-caption",
        "POST /api/instagram/reel",
        "GET /api/instagram/schedule",
        "POST /api/instagram/schedule",
        "PATCH /api/instagram/schedule/:id",
        "POST /api/instagram/schedule/:id/cancel",
        "POST /api/instagram/schedule/:id/retry",
      ],
    });
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 500;
    sendJson(response, status, {
      error: error instanceof Error ? error.message : "Unknown backend error",
      details: error instanceof ApiRequestError ? error.details : undefined,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Backend API ready on http://localhost:${PORT}`);
});

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function matchScheduleJobRoute(pathname: string): { id: string; action?: "cancel" | "retry" } | undefined {
  const match = pathname.match(/^\/api\/instagram\/schedule\/([^/]+)(?:\/(cancel|retry))?$/);
  if (!match) {
    return undefined;
  }

  return {
    id: decodeURIComponent(match[1]),
    action: match[2] as "cancel" | "retry" | undefined,
  };
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const raw = (await readBuffer(request)).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

async function readBuffer(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
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

function cloneClassProfiles(classes: RobotClass[]): RobotClass[] {
  return classes.map((robotClass) => ({
    ...robotClass,
    palette: { ...robotClass.palette },
    arsenal: [...robotClass.arsenal],
  }));
}
