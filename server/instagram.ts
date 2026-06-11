import { ApiRequestError } from "./apiError";
import { createR2VideoStorage, type HostedVideo, type VideoStorage } from "./r2Storage";

export type CaptionHighlight = {
  time: number;
  text: string;
};

export type CaptionDamage = {
  name: string;
  dealt: number;
};

export type ReelCaptionSummary = {
  seed: string;
  winnerName: string;
  duration: number;
  botNames: string[];
  damage: CaptionDamage[];
  underdogScore?: number;
  highlights: CaptionHighlight[];
};

export type InstagramPublishResult = {
  mediaId: string;
  containerId: string;
  status: "published";
};

type Env = Record<string, string | undefined>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type InstagramLogger = Pick<Console, "info" | "warn" | "error">;

type PublishOptions = {
  fetcher?: FetchLike;
  env?: Env;
  graphVersion?: string;
  pollDelayMs?: number;
  maxPollAttempts?: number;
  wait?: (ms: number) => Promise<void>;
  logger?: InstagramLogger;
  storage?: VideoStorage;
  scheduleCleanup?: (callback: () => void, ms: number) => unknown;
};

type CaptionOptions = {
  fetcher?: FetchLike;
  env?: Env;
  model?: string;
};

export { ApiRequestError };

export async function generateReelCaption(
  summary: ReelCaptionSummary,
  options: CaptionOptions = {}
): Promise<string> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new ApiRequestError("OPENAI_API_KEY is not configured.", 500);
  }

  const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? readOpenAIModel(env),
      input: buildCaptionPrompt(summary),
      max_output_tokens: 660,
    }),
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    throw normalizeRemoteError(payload, response.status, "OpenAI caption generation failed.");
  }

  const caption = extractOpenAIText(payload).trim();
  if (!caption) {
    throw new ApiRequestError("OpenAI returned an empty caption.", 502, payload);
  }

  return caption.slice(0, 2200);
}

export function buildCaptionPrompt(summary: ReelCaptionSummary): string {
  return [
    "You are writing an instagram caption, follow the style below:",
    "",
    "Caption style example:",
    `${summary.botNames.join(" vs ")} - Who will win?",`,
    
    "<insert random fun fact that's nothing to do with the match here, a random animal / anthropology / history / asia / gaming fun fact, format: no em dashes, add line breaks, keep word limit around 200 words, more quantitative answers, keep the fun fact without double line breaks, but the title and hashtags with 2 line breaks>",
    "<ie. In imperial China, crickets were not just insects — they were pets, musical companions, and tiny competitive athletes. The tradition goes back roughly 2,000 years in broader “singing insect” culture, while keeping crickets in cages became especially popular during the Tang dynasty, 618-907 AD. Court women reportedly kept them in small golden cages so they could listen to their chirping at night. By the Song dynasty, 960–1279 AD, cricket fighting had become a serious pastime, with male crickets matched almost like boxers by size and strength>",
    "And always end on these hashtags: #BotLab #BotLabAction #BotSimultions",
  ].join("\n");
}

export async function publishInstagramReel(
  video: Buffer,
  caption: string,
  contentType: string,
  options: PublishOptions = {}
): Promise<InstagramPublishResult> {
  if (!video.byteLength) {
    throw new ApiRequestError("No reel video was provided.", 400);
  }

  if (!contentType.includes("video/mp4")) {
    throw new ApiRequestError("Instagram posting requires an MP4 recording.", 400);
  }

  const env = options.env ?? process.env;
  const config = readInstagramConfig(env);
  const fetcher = options.fetcher ?? fetch;
  const graphVersion = options.graphVersion ?? env.INSTAGRAM_GRAPH_VERSION ?? "v25.0";
  const graphHost = env.INSTAGRAM_GRAPH_HOST?.trim() || "graph.instagram.com";
  const encodedAccountId = encodeURIComponent(config.accountId);
  const graphBase = `https://${graphHost}/${graphVersion}`;
  const logger = createInstagramLogger(env, options.logger);
  const attemptId = createAttemptId();
  const storage = options.storage ?? createR2VideoStorage(env);
  const cleanupDelayMs = readRetentionMs(env);
  let hostedVideo: HostedVideo | undefined;

  logInstagram(logger, "info", "Instagram reel publish started.", {
    attemptId,
    accountId: maskIdentifier(config.accountId),
    graphBase,
    uploadMode: "video_url",
    videoBytes: video.byteLength,
    contentType,
    captionCharacters: caption.length,
  });

  try {
    logInstagram(logger, "info", "Uploading reel video to Cloudflare R2.", {
      attemptId,
      videoBytes: video.byteLength,
      contentType,
    });

    hostedVideo = await storage.uploadVideo(video, contentType);

    logInstagram(logger, "info", "Reel video hosted for Instagram.", {
      attemptId,
      hostedVideo,
      cleanupDelayMs,
    });

    const containerParams = new URLSearchParams({
      media_type: "REELS",
      video_url: hostedVideo.url,
      caption: caption.slice(0, 2200),
      share_to_feed: "true",
      access_token: config.token,
    });
    const containerUrl = `${graphBase}/${encodedAccountId}/media`;

    logInstagram(logger, "info", "Creating Instagram reel container.", {
      attemptId,
      request: {
        method: "POST",
        url: containerUrl,
        params: paramsToLogObject(containerParams),
      },
    });

    const containerResponse = await fetcher(containerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: containerParams,
    });
    const containerPayload = await readResponseJson(containerResponse);

    logInstagram(logger, containerResponse.ok ? "info" : "error", "Instagram container response received.", {
      attemptId,
      response: responseToLogObject(containerResponse, containerPayload),
    });

    if (!containerResponse.ok) {
      throw normalizeRemoteError(containerPayload, containerResponse.status, "Instagram container creation failed.");
    }

    const containerId = readStringField(containerPayload, "id");

    await waitForContainerReady(
      containerId,
      config.token,
      graphBase,
      fetcher,
      {
        pollDelayMs: options.pollDelayMs ?? 4000,
        maxPollAttempts: options.maxPollAttempts ?? 30,
        wait: options.wait ?? wait,
      },
      logger,
      attemptId
    );

    const publishParams = new URLSearchParams({
      creation_id: containerId,
      access_token: config.token,
    });
    const publishUrl = `${graphBase}/${encodedAccountId}/media_publish`;

    logInstagram(logger, "info", "Publishing Instagram reel container.", {
      attemptId,
      containerId,
      request: {
        method: "POST",
        url: publishUrl,
        params: paramsToLogObject(publishParams),
      },
    });

    const publishResponse = await fetcher(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams,
    });
    const publishPayload = await readResponseJson(publishResponse);

    logInstagram(logger, publishResponse.ok ? "info" : "error", "Instagram publish response received.", {
      attemptId,
      containerId,
      response: responseToLogObject(publishResponse, publishPayload),
    });

    if (!publishResponse.ok) {
      throw normalizeRemoteError(publishPayload, publishResponse.status, "Instagram publish failed.");
    }

    const result: InstagramPublishResult = {
      mediaId: readStringField(publishPayload, "id"),
      containerId,
      status: "published",
    };

    logInstagram(logger, "info", "Instagram reel publish finished.", {
      attemptId,
      result,
    });

    return result;
  } finally {
    if (hostedVideo) {
      scheduleHostedVideoCleanup(
        hostedVideo.key,
        storage,
        cleanupDelayMs,
        options.scheduleCleanup ?? scheduleTimeout,
        logger,
        attemptId
      );
    }
  }
}

export function normalizeRemoteError(payload: unknown, status: number, fallback: string): ApiRequestError {
  const remoteMessage = extractRemoteMessage(payload);
  return new ApiRequestError(remoteMessage ?? fallback, status, payload);
}

function readInstagramConfig(env: Env) {
  const required = [
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
    "INSTAGRAM_ACCOUNT_ID",
    "INSTAGRAM_ACCOUNT_TOKEN",
  ];
  const missing = required.filter((key) => !env[key]);

  if (missing.length) {
    throw new ApiRequestError(`Missing Instagram configuration: ${missing.join(", ")}.`, 500);
  }

  return {
    accountId: env.INSTAGRAM_ACCOUNT_ID ?? "",
    token: env.INSTAGRAM_ACCOUNT_TOKEN ?? "",
  };
}

function readOpenAIModel(env: Env) {
  return env.OPENAI_MODEL?.trim() || "gpt-5.5";
}

async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  graphBase: string,
  fetcher: FetchLike,
  options: Required<Pick<PublishOptions, "pollDelayMs" | "maxPollAttempts" | "wait">>,
  logger?: InstagramLogger,
  attemptId?: string
) {
  for (let attempt = 0; attempt < options.maxPollAttempts; attempt += 1) {
    const statusParams = new URLSearchParams({
      fields: "status_code",
      access_token: accessToken,
    });
    const statusUrl = `${graphBase}/${encodeURIComponent(containerId)}?${statusParams.toString()}`;

    logInstagram(logger, "info", "Checking Instagram reel container status.", {
      attemptId,
      containerId,
      pollAttempt: attempt + 1,
      request: {
        method: "GET",
        url: sanitizeUrl(statusUrl),
      },
    });

    const response = await fetcher(statusUrl);
    const payload = await readResponseJson(response);

    logInstagram(logger, response.ok ? "info" : "error", "Instagram status response received.", {
      attemptId,
      containerId,
      pollAttempt: attempt + 1,
      response: responseToLogObject(response, payload),
    });

    if (!response.ok) {
      throw normalizeRemoteError(payload, response.status, "Instagram status check failed.");
    }

    const status = readStringField(payload, "status_code");
    if (status === "FINISHED") {
      return;
    }
    if (status === "ERROR" || status === "EXPIRED") {
      throw new ApiRequestError(`Instagram container status is ${status}.`, 502, payload);
    }

    await options.wait(options.pollDelayMs);
  }

  throw new ApiRequestError("Instagram video processing timed out.", 504);
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function extractOpenAIText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const maybeOutputText = (payload as { output_text?: unknown }).output_text;
  if (typeof maybeOutputText === "string") {
    return maybeOutputText;
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((content) => {
      if (!content || typeof content !== "object") {
        return "";
      }
      const text = (content as { text?: unknown; value?: unknown }).text;
      const value = (content as { value?: unknown }).value;
      return typeof text === "string" ? text : typeof value === "string" ? value : "";
    })
    .join("");
}

function extractRemoteMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

function readStringField(payload: unknown, field: string, required = true): string {
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>)[field];
    if (typeof value === "string" && value) {
      return value;
    }
  }

  if (!required) {
    return "";
  }

  throw new ApiRequestError(`Instagram response did not include ${field}.`, 502, payload);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readRetentionMs(env: Env) {
  const hours = Number(env.INSTAGRAM_REEL_RETENTION_HOURS ?? 24);
  const retentionHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return retentionHours * 60 * 60 * 1000;
}

function scheduleTimeout(callback: () => void, ms: number) {
  const timer = setTimeout(callback, ms);
  timer.unref?.();
  return timer;
}

function scheduleHostedVideoCleanup(
  key: string,
  storage: VideoStorage,
  delayMs: number,
  scheduler: (callback: () => void, ms: number) => unknown,
  logger?: InstagramLogger,
  attemptId?: string
) {
  const timer = scheduler(() => {
    void cleanupHostedVideo(key, storage, logger, attemptId);
  }, delayMs);

  if (timer && typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }

  logInstagram(logger, "info", "Scheduled hosted reel cleanup.", {
    attemptId,
    key,
    delayMs,
  });
}

async function cleanupHostedVideo(
  key: string,
  storage: VideoStorage,
  logger?: InstagramLogger,
  attemptId?: string
) {
  try {
    await storage.deleteVideo(key);
    logInstagram(logger, "info", "Deleted hosted reel video.", {
      attemptId,
      key,
    });
  } catch (error) {
    logInstagram(logger, "warn", "Hosted reel cleanup failed.", {
      attemptId,
      key,
      error: normalizeErrorForLog(error),
    });
  }
}

function createInstagramLogger(env: Env, logger?: InstagramLogger): InstagramLogger | undefined {
  const logSetting = env.INSTAGRAM_POST_LOG?.trim().toLowerCase();
  if (logSetting === "0" || logSetting === "false" || logSetting === "off") {
    return logger;
  }

  return logger ?? console;
}

function logInstagram(
  logger: InstagramLogger | undefined,
  level: keyof InstagramLogger,
  message: string,
  data: unknown
) {
  if (!logger) {
    return;
  }

  logger[level](`[instagram] ${message}`, JSON.stringify(sanitizeForLog(data)));
}

function createAttemptId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function responseToLogObject(response: Response, payload: unknown) {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: pickResponseHeaders(response.headers),
    payload,
  };
}

function pickResponseHeaders(headers: Headers) {
  const picked: Record<string, string> = {};
  for (const key of [
    "facebook-api-version",
    "x-fb-trace-id",
    "x-fb-request-id",
    "x-app-usage",
    "x-business-use-case-usage",
    "content-type",
  ]) {
    const value = headers.get(key);
    if (value) {
      picked[key] = value;
    }
  }

  return picked;
}

function paramsToLogObject(params: URLSearchParams) {
  return Object.fromEntries(params.entries());
}

function sanitizeForLog(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) {
      sanitized[key] = "[redacted]";
    } else {
      sanitized[key] = sanitizeForLog(item);
    }
  }

  return sanitized;
}

function sanitizeUrl(value: string) {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return value;
  }

  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (isSecretKey(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }

    return url.toString();
  } catch {
    return value;
  }
}

function isSecretKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized === "authorization" ||
    normalized.includes("access_token") ||
    normalized.endsWith("token") ||
    normalized.includes("secret") ||
    normalized.includes("accesskey") ||
    normalized.includes("access_key")
  );
}

function maskIdentifier(value: string) {
  if (value.length <= 6) {
    return "***";
  }

  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function normalizeErrorForLog(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return error;
}
