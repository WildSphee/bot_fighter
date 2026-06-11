import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultProfileState,
  mergeSettings,
  readProfileStore,
  writeProfileStore,
} from "./profileStore";

let tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("profile store", () => {
  it("returns defaults when no profile file exists", () => {
    const path = createTempProfilePath();

    const state = readProfileStore(path);

    expect(state.classes.length).toBeGreaterThan(0);
    expect(Object.keys(state.movementProfiles)).toContain("balanced");
    expect(state.weapons.length).toBeGreaterThan(0);
    expect(state.settings).toEqual({
      moveInterval: 1,
      weaponInterval: 2,
      centerGravity: 0.35,
    });
  });

  it("writes and reads profile edits", () => {
    const path = createTempProfilePath();
    const state = createDefaultProfileState();
    state.classes[0] = { ...state.classes[0], hp: 321 };
    state.weapons[0] = { ...state.weapons[0], damage: 99 };
    state.settings = { moveInterval: 1.5, weaponInterval: 3, centerGravity: 0.8 };

    writeProfileStore(state, path);
    const stored = readProfileStore(path);

    expect(stored.classes[0].hp).toBe(321);
    expect(stored.weapons[0].damage).toBe(99);
    expect(stored.settings).toEqual(state.settings);
  });

  it("clamps incoming settings", () => {
    expect(
      mergeSettings(
        { moveInterval: 1, weaponInterval: 2, centerGravity: 0.35 },
        { moveInterval: 99, weaponInterval: -10, centerGravity: 4 }
      )
    ).toEqual({
      moveInterval: 4,
      weaponInterval: 0.25,
      centerGravity: 1,
    });
  });
});

function createTempProfilePath() {
  const directory = mkdtempSync(join(tmpdir(), "bot-fighter-profile-"));
  tempDirs.push(directory);
  return join(directory, "class-profiles.json");
}
