import { describe, expect, it } from "vitest";
import { createDefaultFightConfig } from "./catalog";
import { cloneFightConfig, simulateFight } from "./engine";

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
});
