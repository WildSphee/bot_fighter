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
      blade: ["blade"],
      "blast-rifle": ["projectile", "spark"],
      shotgun: ["projectile", "spark"],
      mine: ["mine", "explosion"],
      shield: ["shield"],
      emp: ["emp"],
      railgun: ["beam"],
      rocket: ["projectile", "explosion"],
    };

    for (const weapon of WEAPONS) {
      const config = createDefaultFightConfig(`visual-${weapon.id}`);
      config.maxDuration = 2.5;
      config.arena = {
        ...config.arena,
        width: 300,
        height: 500,
      };
      config.classes = config.classes.map((robotClass) => ({
        ...robotClass,
        arsenal: [weapon.id],
      }));
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

  it("starts bots in motion and holds the winner result", () => {
    const config = createDefaultFightConfig("motion-and-hold");
    const result = simulateFight(config);

    expect(result.frames[0].robots.every((robot) => Math.hypot(robot.velocity.x, robot.velocity.y) > 0)).toBe(true);

    const winnerEvent = result.events.find((event) => event.type === "winner");
    expect(winnerEvent).toBeDefined();
    expect(result.duration - (winnerEvent?.time ?? result.duration)).toBeGreaterThanOrEqual(1.9);
  });

  it("telegraphs railgun before resolving damage", () => {
    const config = createDefaultFightConfig("railgun-telegraph");
    config.maxDuration = 3;
    config.classes = config.classes.map((robotClass) => ({
      ...robotClass,
      arsenal: ["railgun"],
      movementProfile: "balanced",
    }));
    config.robots = config.robots.map((robot, index) => ({
      ...robot,
      arsenal: ["railgun"],
      weaponDice: [{ id: "railgun", weight: 1 }],
      movementDice: [{ id: index === 0 ? "hold" : "strafe-right", weight: 1 }],
    }));

    const result = simulateFight(config);
    const railgunEvent = result.events.find(
      (event) => event.type === "weapon" && event.weaponId === "railgun"
    );
    const railgunHit = result.events.find(
      (event) => event.type === "hit" && event.weaponId === "railgun"
    );
    const hasTelegraph = result.frames.some((frame) =>
      frame.effects.some((effect) => effect.type === "telegraph" && effect.weaponId === "railgun")
    );

    expect(railgunEvent).toBeDefined();
    expect(hasTelegraph).toBe(true);
    if (railgunHit && railgunEvent) {
      expect(railgunHit.time - railgunEvent.time).toBeGreaterThanOrEqual(0.49);
    }
  });

  it("applies recoil to shotgun and railgun shooters", () => {
    for (const weaponId of ["shotgun", "railgun"] as const) {
      const config = createDefaultFightConfig(`${weaponId}-recoil`);
      config.maxDuration = weaponId === "railgun" ? 2.4 : 1.1;
      config.centerGravity = 0;
      config.arena = {
        ...config.arena,
        width: 2200,
        height: 2200,
        drag: 1,
      };
      config.classes = config.classes.map((robotClass) => ({
        ...robotClass,
        speed: 0,
        arsenal: [weaponId],
        movementProfile: "balanced",
      }));
      config.robots = config.robots.map((robot) => ({
        ...robot,
        arsenal: [weaponId],
        weaponDice: [{ id: weaponId, weight: 1 }],
      }));

      const result = simulateFight(config);
      const recoilEvent =
        weaponId === "railgun"
          ? result.events.find((event) => event.type === "sound" && event.sound === "railgun")
          : result.events.find((event) => event.type === "weapon" && event.weaponId === "shotgun");
      const frameAfterRecoil = result.frames.find((frame) => frame.time >= (recoilEvent?.time ?? 0) + 0.08);
      const shooter = frameAfterRecoil?.robots.find((robot) => robot.id === config.robots[0].id);

      expect(recoilEvent, `${weaponId} should fire`).toBeDefined();
      expect(Math.hypot(shooter?.velocity.x ?? 0, shooter?.velocity.y ?? 0), `${weaponId} should recoil`).toBeGreaterThan(20);
    }
  });

  it("doubles the EMP pulse radius and adds electric arcs", () => {
    const config = createDefaultFightConfig("emp-radius");
    const empRange = 500;
    config.maxDuration = 1.2;
    config.centerGravity = 0;
    config.arena = {
      ...config.arena,
      width: 2200,
      height: 2200,
    };
    config.weapons = config.weapons.map((weapon) =>
      weapon.id === "emp" ? { ...weapon, range: empRange } : weapon
    );
    config.classes = config.classes.map((robotClass) => ({
      ...robotClass,
      speed: 0,
      arsenal: ["emp"],
    }));
    config.robots = config.robots.map((robot) => ({
      ...robot,
      arsenal: ["emp"],
      weaponDice: [{ id: "emp", weight: 1 }],
    }));

    const result = simulateFight(config);
    const empEffects = result.frames.flatMap((frame) =>
      frame.effects.filter((effect) => effect.weaponId === "emp")
    );
    const pulse = empEffects.find((effect) => effect.type === "emp");
    const electricArcCount = empEffects.filter((effect) => effect.type === "beam").length;

    expect(pulse?.radius).toBe(empRange * 2);
    expect(electricArcCount).toBeGreaterThanOrEqual(24);
  });

  it("shows a short-lived damage text toast at the hit position", () => {
    const config = createDefaultFightConfig("damage-toast");
    config.maxDuration = 1.2;
    config.centerGravity = 0;
    config.classes = config.classes.map((robotClass) => ({
      ...robotClass,
      speed: 0,
      arsenal: ["emp"],
    }));
    config.robots = config.robots.map((robot) => ({
      ...robot,
      arsenal: ["emp"],
      weaponDice: [{ id: "emp", weight: 1 }],
      movementDice: [{ id: "hold", weight: 1 }],
    }));

    const result = simulateFight(config);
    const damageToast = result.frames
      .flatMap((frame) => frame.effects)
      .find((effect) => effect.type === "damage-text");

    expect(damageToast?.duration).toBe(0.5);
    expect(damageToast?.label).toMatch(/^-\d+$/);
  });

  it("lets shotgun pellets penetrate after hitting a bot", () => {
    const config = createDefaultFightConfig("shotgun-penetrates");
    config.maxDuration = 1.4;
    config.centerGravity = 0;
    config.classes = config.classes.map((robotClass) => ({
      ...robotClass,
      speed: 0,
      turnSpeed: 100,
      arsenal: ["shotgun"],
      movementProfile: "balanced",
    }));
    config.robots = config.robots.map((robot) => ({
      ...robot,
      arsenal: ["shotgun"],
      weaponDice: [{ id: "shotgun", weight: 1 }],
      movementDice: [{ id: "hold", weight: 1 }],
    }));

    const result = simulateFight(config);
    const shotgunRoll = result.events.find(
      (event): event is Extract<(typeof result.events)[number], { type: "weapon" }> =>
        event.type === "weapon" && event.weaponId === "shotgun"
    );
    const shotgunHit = result.events.find(
      (event) => event.type === "hit" && event.weaponId === "shotgun"
    );
    const projectileAfterHit = result.frames.some(
      (frame) =>
        shotgunHit &&
        frame.time > shotgunHit.time + 0.03 &&
        frame.time < shotgunHit.time + 0.28 &&
        frame.projectiles.some((projectile) => projectile.weaponId === "shotgun")
    );

    expect(shotgunRoll?.sound).toBe("shotgun");
    expect(shotgunHit).toBeDefined();
    expect(projectileAfterHit).toBe(true);
  });

  it("fires three slow inaccurate blast rifle shots", () => {
    const config = createDefaultFightConfig("blast-rifle-burst");
    config.maxDuration = 1.2;
    config.centerGravity = 0;
    config.classes = config.classes.map((robotClass) => ({
      ...robotClass,
      speed: 0,
      arsenal: ["blast-rifle"],
    }));
    config.robots = config.robots.map((robot) => ({
      ...robot,
      arsenal: ["blast-rifle"],
      weaponDice: [{ id: "blast-rifle", weight: 1 }],
      movementDice: [{ id: "hold", weight: 1 }],
    }));

    const result = simulateFight(config);
    const blastProjectiles = new Set<string>();
    for (const frame of result.frames) {
      for (const projectile of frame.projectiles) {
        if (projectile.weaponId === "blast-rifle") {
          blastProjectiles.add(projectile.id);
          expect(Math.hypot(projectile.velocity.x, projectile.velocity.y)).toBeLessThan(340);
        }
      }
    }

    expect(blastProjectiles.size).toBeGreaterThanOrEqual(3);
  });

  it("lets the neon blade destroy projectiles during its swing", () => {
    const config = createDefaultFightConfig("blade-destroys-projectiles");
    config.maxDuration = 2.4;
    config.centerGravity = 0;
    config.arena = {
      ...config.arena,
      width: 520,
      height: 520,
      drag: 1,
    };
    config.classes = config.classes.map((robotClass, index) => ({
      ...robotClass,
      speed: 0,
      turnSpeed: 100,
      arsenal: index === 0 ? ["blade"] : ["blast-rifle"],
      movementProfile: "balanced",
    }));
    config.robots = config.robots.map((robot, index) => ({
      ...robot,
      classId: index === 0 ? config.classes[0].id : config.classes[1].id,
      arsenal: index === 0 ? ["blade"] : ["blast-rifle"],
      weaponDice: [{ id: index === 0 ? "blade" : "blast-rifle", weight: 1 }],
      movementDice: [{ id: "hold", weight: 1 }],
    }));

    const result = simulateFight(config);
    const hasBlade = result.frames.some((frame) =>
      frame.effects.some((effect) => effect.type === "blade" && effect.weaponId === "blade")
    );
    const destroyedProjectile = result.events.some(
      (event) => event.type === "sound" && event.sound === "shield-break"
    );

    expect(hasBlade).toBe(true);
    expect(destroyedProjectile).toBe(true);
  });
});
