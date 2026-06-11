import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultFightConfig } from "../src/sim/catalog";
import { InstagramScheduleService } from "./instagramSchedule";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("InstagramScheduleService", () => {
  it("creates, lists, updates, cancels, retries, and persists scheduled reels", () => {
    const directory = createTempDir();
    let now = new Date("2026-06-11T00:00:00.000Z");
    const service = createService(directory, () => now);

    const job = service.create({
      caption: "first caption",
      scheduledAt: "2026-06-11T03:00:00.000Z",
      fightConfig: createDefaultFightConfig("queued"),
      soundEnabled: false,
    });

    expect(job.status).toBe("queued");
    expect(job.timezoneLabel).toBe("UTC+08:00");
    expect(job.soundEnabled).toBe(false);
    expect(service.list().nextJob?.id).toBe(job.id);

    const updated = service.update(job.id, {
      caption: "updated caption",
      scheduledAt: "2026-06-11T04:00:00.000Z",
    });
    expect(updated.caption).toBe("updated caption");
    expect(updated.scheduledAt).toBe("2026-06-11T04:00:00.000Z");

    const cancelled = service.cancel(job.id);
    expect(cancelled.status).toBe("cancelled");

    now = new Date("2026-06-11T01:00:00.000Z");
    const failed = service.create({
      caption: "failed caption",
      scheduledAt: "2026-06-11T02:00:00.000Z",
      fightConfig: createDefaultFightConfig("failed"),
    });
    failed.status = "failed";
    failed.lastError = "network";
    const retried = service.retry(failed.id);
    expect(retried.status).toBe("queued");
    expect(retried.attempts).toBe(0);
    expect(retried.lastError).toBeUndefined();

    const reloaded = createService(directory, () => now);
    expect(reloaded.list().jobs.map((candidate) => candidate.id)).toContain(job.id);
    expect(reloaded.list().jobs.map((candidate) => candidate.id)).toContain(failed.id);
  });

  it("rejects invalid captions, past dates, malformed configs, and missing jobs", () => {
    const directory = createTempDir();
    const service = createService(directory, () => new Date("2026-06-11T00:00:00.000Z"));

    expect(() =>
      service.create({
        caption: "",
        scheduledAt: "2026-06-11T03:00:00.000Z",
        fightConfig: createDefaultFightConfig(),
      })
    ).toThrow("caption is required");

    expect(() =>
      service.create({
        caption: "caption",
        scheduledAt: "2026-06-10T03:00:00.000Z",
        fightConfig: createDefaultFightConfig(),
      })
    ).toThrow("scheduledAt must be in the future");

    expect(() =>
      service.create({
        caption: "caption",
        scheduledAt: "2026-06-11T03:00:00.000Z",
        fightConfig: {} as never,
      })
    ).toThrow("fightConfig is required");

    expect(() => service.cancel("missing")).toThrow("Scheduled reel was not found");
  });

  it("publishes only due jobs and does not publish at schedule creation", async () => {
    const directory = createTempDir();
    let now = new Date("2026-06-11T00:00:00.000Z");
    const renderReel = vi.fn().mockResolvedValue({ video: Buffer.from("mp4"), contentType: "video/mp4" });
    const publishReel = vi.fn().mockResolvedValue({ mediaId: "media-1", containerId: "container-1" });
    const service = createService(directory, () => now, renderReel, publishReel);

    service.create({
      caption: "future",
      scheduledAt: "2026-06-11T02:00:00.000Z",
      fightConfig: createDefaultFightConfig("future"),
    });
    const due = service.create({
      caption: "due",
      scheduledAt: "2026-06-11T01:00:00.000Z",
      fightConfig: createDefaultFightConfig("due"),
    });

    expect(renderReel).not.toHaveBeenCalled();
    expect(publishReel).not.toHaveBeenCalled();

    now = new Date("2026-06-11T01:00:00.000Z");
    const processed = await service.processDueJobs();
    expect(processed.map((job) => job.id)).toEqual([due.id]);
    expect(renderReel).toHaveBeenCalledOnce();
    expect(publishReel).toHaveBeenCalledOnce();
    expect(processed[0].status).toBe("published");
    expect(processed[0].mediaId).toBe("media-1");
  });

  it("retries transient worker failures three times before marking failed", async () => {
    const directory = createTempDir();
    let now = new Date("2026-06-11T00:00:00.000Z");
    const renderReel = vi.fn().mockRejectedValue(new Error("renderer offline"));
    const publishReel = vi.fn();
    const service = createService(directory, () => now, renderReel, publishReel);
    const job = service.create({
      caption: "retry",
      scheduledAt: "2026-06-11T01:00:00.000Z",
      fightConfig: createDefaultFightConfig("retry"),
    });

    now = new Date("2026-06-11T01:00:00.000Z");
    let processed = await service.processDueJobs();
    expect(processed[0].status).toBe("queued");
    expect(processed[0].attempts).toBe(1);
    expect(processed[0].nextAttemptAt).toBeDefined();

    now = new Date(processed[0].nextAttemptAt as string);
    processed = await service.processDueJobs();
    expect(processed[0].status).toBe("queued");
    expect(processed[0].attempts).toBe(2);

    now = new Date(processed[0].nextAttemptAt as string);
    processed = await service.processDueJobs();
    expect(processed[0].id).toBe(job.id);
    expect(processed[0].status).toBe("failed");
    expect(processed[0].attempts).toBe(3);
    expect(processed[0].lastError).toBe("renderer offline");
    expect(publishReel).not.toHaveBeenCalled();
  });
});

function createTempDir() {
  const directory = mkdtempSync(join(tmpdir(), "bot-fighter-schedule-"));
  tempDirs.push(directory);
  return directory;
}

function createService(
  directory: string,
  now: () => Date,
  renderReel = vi.fn().mockResolvedValue({ video: Buffer.from("mp4"), contentType: "video/mp4" }),
  publishReel = vi.fn().mockResolvedValue({ mediaId: "media", containerId: "container" })
) {
  return new InstagramScheduleService({
    env: { INSTAGRAM_SCHEDULE_PATH: join(directory, "instagram-schedule.json") },
    now,
    renderReel,
    publishReel,
  });
}
