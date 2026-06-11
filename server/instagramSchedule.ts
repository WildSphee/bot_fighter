import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiRequestError } from "./apiError";
import { publishInstagramReel, type InstagramPublishResult } from "./instagram";
import { renderScheduledReel } from "./scheduledReelRenderer";
import type { FightConfig } from "../src/sim/types";

export type ScheduledReelStatus =
  | "queued"
  | "rendering"
  | "posting"
  | "published"
  | "failed"
  | "cancelled";

export type ScheduledReelJob = {
  id: string;
  status: ScheduledReelStatus;
  scheduledAt: string;
  timezoneLabel: "UTC+08:00";
  caption: string;
  fightConfig: FightConfig;
  soundEnabled: boolean;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  mediaId?: string;
  containerId?: string;
  publishedAt?: string;
};

export type ScheduleSnapshot = {
  jobs: ScheduledReelJob[];
  nextJob?: ScheduledReelJob;
};

type Env = Record<string, string | undefined>;

type ScheduleStore = {
  jobs: ScheduledReelJob[];
};

type CreateJobInput = {
  caption: string;
  scheduledAt: string;
  fightConfig: FightConfig;
  soundEnabled?: boolean;
};

type UpdateJobInput = {
  caption?: string;
  scheduledAt?: string;
};

type PublishResult = Pick<InstagramPublishResult, "mediaId" | "containerId">;

export type ScheduleServiceOptions = {
  env?: Env;
  now?: () => Date;
  renderReel?: (job: ScheduledReelJob) => Promise<{ video: Buffer; contentType: string }>;
  publishReel?: (job: ScheduledReelJob, video: Buffer, contentType: string) => Promise<PublishResult>;
};

const DEFAULT_STORE_PATH = ".data/instagram-schedule.json";
const TIMEZONE_LABEL = "UTC+08:00";
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

export class InstagramScheduleService {
  private store: ScheduleStore;
  private runningJobIds = new Set<string>();
  private readonly env: Env;
  private readonly now: () => Date;
  private readonly renderReel: NonNullable<ScheduleServiceOptions["renderReel"]>;
  private readonly publishReel: NonNullable<ScheduleServiceOptions["publishReel"]>;
  readonly storePath: string;

  constructor(options: ScheduleServiceOptions = {}) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.storePath = resolve(this.env.INSTAGRAM_SCHEDULE_PATH ?? DEFAULT_STORE_PATH);
    this.renderReel = options.renderReel ?? ((job) => renderScheduledReel(job, this.env));
    this.publishReel =
      options.publishReel ??
      (async (job, video, contentType) => publishInstagramReel(video, job.caption, contentType));
    this.store = readStore(this.storePath);
  }

  list(): ScheduleSnapshot {
    const jobs = [...this.store.jobs].sort(compareJobs);
    return {
      jobs,
      nextJob: jobs.find((job) => job.status === "queued"),
    };
  }

  create(input: CreateJobInput): ScheduledReelJob {
    const now = this.now();
    const scheduledAt = normalizeFutureDate(input.scheduledAt, now);
    const caption = normalizeCaption(input.caption);
    assertFightConfig(input.fightConfig);

    const job: ScheduledReelJob = {
      id: randomUUID(),
      status: "queued",
      scheduledAt,
      timezoneLabel: TIMEZONE_LABEL,
      caption,
      fightConfig: cloneConfig(input.fightConfig),
      soundEnabled: input.soundEnabled ?? true,
      attempts: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.store.jobs.push(job);
    this.save();
    return job;
  }

  update(id: string, input: UpdateJobInput): ScheduledReelJob {
    const job = this.requireJob(id);
    assertMutable(job);

    if (input.caption !== undefined) {
      job.caption = normalizeCaption(input.caption);
    }
    if (input.scheduledAt !== undefined) {
      job.scheduledAt = normalizeFutureDate(input.scheduledAt, this.now());
      job.nextAttemptAt = undefined;
      if (job.status === "failed") {
        job.status = "queued";
        job.attempts = 0;
        job.lastError = undefined;
      }
    }

    job.updatedAt = this.now().toISOString();
    this.save();
    return job;
  }

  cancel(id: string): ScheduledReelJob {
    const job = this.requireJob(id);
    if (job.status === "published" || job.status === "cancelled") {
      throw new ApiRequestError(`Cannot cancel a ${job.status} scheduled reel.`, 409);
    }

    job.status = "cancelled";
    job.nextAttemptAt = undefined;
    job.updatedAt = this.now().toISOString();
    this.save();
    return job;
  }

  retry(id: string): ScheduledReelJob {
    const job = this.requireJob(id);
    if (job.status !== "failed") {
      throw new ApiRequestError("Only failed scheduled reels can be retried.", 409);
    }

    job.status = "queued";
    job.attempts = 0;
    job.nextAttemptAt = undefined;
    job.lastError = undefined;
    job.updatedAt = this.now().toISOString();
    this.save();
    return job;
  }

  async processDueJobs(): Promise<ScheduledReelJob[]> {
    const now = this.now();
    const dueJobs = this.store.jobs.filter(
      (job) =>
        job.status === "queued" &&
        !this.runningJobIds.has(job.id) &&
        new Date(job.scheduledAt).getTime() <= now.getTime() &&
        (!job.nextAttemptAt || new Date(job.nextAttemptAt).getTime() <= now.getTime())
    );

    const processed: ScheduledReelJob[] = [];
    for (const job of dueJobs) {
      processed.push(await this.processJob(job.id));
    }
    return processed;
  }

  async processJob(id: string): Promise<ScheduledReelJob> {
    const job = this.requireJob(id);
    if (job.status !== "queued") {
      return job;
    }
    if (this.runningJobIds.has(job.id)) {
      return job;
    }

    this.runningJobIds.add(job.id);
    try {
      this.mark(job, "rendering");
      const rendered = await this.renderReel(job);
      this.mark(job, "posting");
      const published = await this.publishReel(job, rendered.video, rendered.contentType);
      job.status = "published";
      job.mediaId = published.mediaId;
      job.containerId = published.containerId;
      job.publishedAt = this.now().toISOString();
      job.nextAttemptAt = undefined;
      job.lastError = undefined;
      job.updatedAt = this.now().toISOString();
      this.save();
      return job;
    } catch (error) {
      job.attempts += 1;
      job.lastError = error instanceof Error ? error.message : "Scheduled reel publish failed.";
      if (job.attempts >= MAX_ATTEMPTS) {
        job.status = "failed";
        job.nextAttemptAt = undefined;
      } else {
        job.status = "queued";
        job.nextAttemptAt = new Date(
          this.now().getTime() + RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)]
        ).toISOString();
      }
      job.updatedAt = this.now().toISOString();
      this.save();
      return job;
    } finally {
      this.runningJobIds.delete(job.id);
    }
  }

  private mark(job: ScheduledReelJob, status: ScheduledReelStatus) {
    job.status = status;
    job.updatedAt = this.now().toISOString();
    this.save();
  }

  private requireJob(id: string) {
    const job = this.store.jobs.find((candidate) => candidate.id === id);
    if (!job) {
      throw new ApiRequestError("Scheduled reel was not found.", 404);
    }
    return job;
  }

  private save() {
    writeStore(this.storePath, this.store);
  }
}

export function startInstagramSchedulePoller(
  service: Pick<InstagramScheduleService, "processDueJobs">,
  intervalMs = 30_000
) {
  const run = () => {
    void service.processDueJobs().catch((error) => {
      console.error("[instagram-schedule] Poller failed.", error);
    });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return timer;
}

function readStore(path: string): ScheduleStore {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) {
      return { jobs: [] };
    }
    const parsed = JSON.parse(raw) as Partial<ScheduleStore>;
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs.map(normalizeJob) : [] };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { jobs: [] };
    }
    throw error;
  }
}

function writeStore(path: string, store: ScheduleStore) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
}

function normalizeJob(job: ScheduledReelJob): ScheduledReelJob {
  return {
    ...job,
    timezoneLabel: TIMEZONE_LABEL,
    soundEnabled: job.soundEnabled ?? true,
    attempts: Number.isFinite(job.attempts) ? job.attempts : 0,
  };
}

function normalizeCaption(caption: string): string {
  const normalized = caption.trim().slice(0, 2200);
  if (!normalized) {
    throw new ApiRequestError("caption is required", 400);
  }
  return normalized;
}

function normalizeFutureDate(value: string, now: Date): string {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) {
    throw new ApiRequestError("scheduledAt must be a valid ISO datetime.", 400);
  }
  if (time.getTime() <= now.getTime()) {
    throw new ApiRequestError("scheduledAt must be in the future.", 400);
  }
  return time.toISOString();
}

function assertFightConfig(config: FightConfig) {
  if (!config || typeof config !== "object" || !config.seed || !Array.isArray(config.robots)) {
    throw new ApiRequestError("fightConfig is required.", 400);
  }
}

function assertMutable(job: ScheduledReelJob) {
  if (job.status !== "queued" && job.status !== "failed") {
    throw new ApiRequestError(`Cannot edit a ${job.status} scheduled reel.`, 409);
  }
}

function compareJobs(left: ScheduledReelJob, right: ScheduledReelJob) {
  return new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime();
}

function cloneConfig(config: FightConfig): FightConfig {
  return JSON.parse(JSON.stringify(config)) as FightConfig;
}
