import { describe, expect, it } from "vitest";
import { WEAPONS, createDefaultFightConfig } from "./catalog";
import { cloneFightConfig, simulateFight } from "./engine";
import type { EffectFrame, WeaponId } from "./types";

describe("simulateFight", () => {
  it("replays the same seed deterministically", () => {
    const config = createDefaultFightConfig("same-seed");

    const first = simulateFight(config);
    const second = simulateFight(cloneFightConfig(config));

    expect(first.winnerId).toBe(second.winnerId);
    expect(first.damageByRobot).toEqual(second.damageByRobot);
    expect(first.events).toEqual(second.events);
    expect(first.frames[20]).toEqual(second.frames[20]);
  });

  it("supports more than two robots without changing the model", () => {
    const config = createDefaultFightConfig("multi-bot");
    config.mode = "free-for-all";
    config.robots = [
      ...config.robots,
      {
        ...config.robots[0],
        id: "third",
        name: "Third",
        teamId: "green",
        classId: "bulwark",
      },
    ];

    const result = simulateFight(config);

    expect(result.frames[0].robots).toHaveLength(3);
    expect(result.events.some((event) => event.type === "winner")).toBe(true);
  });

  it("creates a drawable visual for every weapon", () => {
    const expectedVisuals: Record<WeaponId, Array<EffectFrame["type"] | "projectile">> = {
      ray: ["beam"],
      missile: ["projectile", "spark"],
      boomerang: ["projectile", "trail"],
      shotgun: ["cone"],
      mine: ["mine", "explosion"],
      shield: ["shield"],
      emp: ["emp"],
      railgun: ["beam"],
    };

    for (const weapon of WEAPONS) {
      const config = createDefaultFightConfig(`visual-${weapon.id}`);
      config.maxDuration = 2.5;
      config.arena = {
        ...config.arena,
        width: 300,
        height: 500,
      };
      config.robots = config.robots.map((robot, index) => ({
        ...robot,
        arsenal: [weapon.id],
        weaponDice: [{ id: weapon.id, weight: 1 }],
        movementDice: [{ id: "hold", weight: 1 }],
        classId: index === 0 ? "striker" : "bulwark",
      }));

      const result = simulateFight(config);
      const visualTypes = new Set<EffectFrame["type"] | "projectile">();

      for (const frame of result.frames) {
        for (const effect of frame.effects) {
          if (effect.weaponId === weapon.id) {
            visualTypes.add(effect.type);
          }
        }

        for (const projectile of frame.projectiles) {
          if (projectile.weaponId === weapon.id) {
            visualTypes.add("projectile");
          }
        }
      }

      expect(
        expectedVisuals[weapon.id].some((visualType) => visualTypes.has(visualType)),
        `${weapon.name} should create a visible arena visual`
      ).toBe(true);
    }
  });
});
