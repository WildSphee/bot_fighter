import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ApiRequestError } from "./apiError";
import {
  ROBOT_CLASSES,
  cloneMovementProfiles,
  cloneWeapons,
  withClassDefaults,
} from "../src/sim/catalog";
import type { MovementProfileMap, RobotClass, WeaponDefinition } from "../src/sim/types";

export type GameSettings = {
  moveInterval: number;
  weaponInterval: number;
  centerGravity: number;
};

export type ProfileState = {
  classes: RobotClass[];
  movementProfiles: MovementProfileMap;
  weapons: WeaponDefinition[];
  settings: GameSettings;
};

const DEFAULT_SETTINGS: GameSettings = {
  moveInterval: 1,
  weaponInterval: 2,
  centerGravity: 0.35,
};

export function readProfileStore(path = defaultProfileStorePath()): ProfileState {
  if (!existsSync(path)) {
    return createDefaultProfileState();
  }

  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as Partial<ProfileState>;
    const defaults = createDefaultProfileState();

    return {
      classes: payload.classes?.length ? cloneClassProfiles(withClassDefaults(payload.classes)) : defaults.classes,
      movementProfiles: payload.movementProfiles
        ? cloneMovementProfiles(payload.movementProfiles)
        : defaults.movementProfiles,
      weapons: payload.weapons?.length ? cloneWeapons(payload.weapons) : defaults.weapons,
      settings: mergeSettings(defaults.settings, payload.settings ?? {}),
    };
  } catch {
    return createDefaultProfileState();
  }
}

export function writeProfileStore(state: ProfileState, path = defaultProfileStorePath()) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    throw new ApiRequestError("Failed to save class profile settings.", 500, normalizeStoreError(error));
  }
}

export function createDefaultProfileState(): ProfileState {
  return {
    classes: cloneClassProfiles(withClassDefaults(ROBOT_CLASSES)),
    movementProfiles: cloneMovementProfiles(),
    weapons: cloneWeapons(),
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function mergeSettings(current: GameSettings, incoming: Partial<GameSettings>): GameSettings {
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

function defaultProfileStorePath() {
  return resolve(process.env.PROFILE_STORE_PATH ?? ".data/class-profiles.json");
}

function cloneClassProfiles(classes: RobotClass[]): RobotClass[] {
  return classes.map((robotClass) => ({
    ...robotClass,
    palette: { ...robotClass.palette },
    arsenal: [...robotClass.arsenal],
  }));
}

function normalizeStoreError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return error;
}
