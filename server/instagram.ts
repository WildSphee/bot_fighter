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

type PublishOptions = {
  fetcher?: FetchLike;
  env?: Env;
  graphVersion?: string;
  pollDelayMs?: number;
  maxPollAttempts?: number;
  wait?: (ms: number) => Promise<void>;
};

type CaptionOptions = {
  fetcher?: FetchLike;
  env?: Env;
  model?: string;
};

export class ApiRequestError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

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
  const graphVersion = options.graphVersion ?? env.INSTAGRAM_GRAPH_VERSION ?? "v24.0";
  const encodedAccountId = encodeURIComponent(config.accountId);
  const graphBase = `https://graph.facebook.com/${graphVersion}`;
  const containerParams = new URLSearchParams({
    media_type: "REELS",
    upload_type: "resumable",
    caption: caption.slice(0, 2200),
    share_to_feed: "true",
    access_token: config.token,
  });

  const containerResponse = await fetcher(`${graphBase}/${encodedAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: containerParams,
  });
  const containerPayload = await readResponseJson(containerResponse);

  if (!containerResponse.ok) {
    throw normalizeRemoteError(containerPayload, containerResponse.status, "Instagram container creation failed.");
  }

  const containerId = readStringField(containerPayload, "id");
  const uploadUri =
    readOptionalStringField(containerPayload, "uri") ??
    `https://rupload.facebook.com/ig-api-upload/${graphVersion}/${encodeURIComponent(containerId)}`;

  const uploadResponse = await fetcher(uploadUri, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${config.token}`,
      "Content-Type": contentType,
      file_size: String(video.byteLength),
      offset: "0",
    },
    body: new Blob([new Uint8Array(video)], { type: contentType }),
  });
  const uploadPayload = await readResponseJson(uploadResponse);

  if (!uploadResponse.ok) {
    throw normalizeRemoteError(uploadPayload, uploadResponse.status, "Instagram video upload failed.");
  }

  await waitForContainerReady(containerId, config.token, graphBase, fetcher, {
    pollDelayMs: options.pollDelayMs ?? 4000,
    maxPollAttempts: options.maxPollAttempts ?? 30,
    wait: options.wait ?? wait,
  });

  const publishParams = new URLSearchParams({
    creation_id: containerId,
    access_token: config.token,
  });
  const publishResponse = await fetcher(`${graphBase}/${encodedAccountId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: publishParams,
  });
  const publishPayload = await readResponseJson(publishResponse);

  if (!publishResponse.ok) {
    throw normalizeRemoteError(publishPayload, publishResponse.status, "Instagram publish failed.");
  }

  return {
    mediaId: readStringField(publishPayload, "id"),
    containerId,
    status: "published",
  };
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
  options: Required<Pick<PublishOptions, "pollDelayMs" | "maxPollAttempts" | "wait">>
) {
  for (let attempt = 0; attempt < options.maxPollAttempts; attempt += 1) {
    const statusParams = new URLSearchParams({
      fields: "status_code",
      access_token: accessToken,
    });
    const response = await fetcher(`${graphBase}/${encodeURIComponent(containerId)}?${statusParams.toString()}`);
    const payload = await readResponseJson(response);

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

function readOptionalStringField(payload: unknown, field: string): string | undefined {
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>)[field];
    if (typeof value === "string" && value) {
      return value;
    }
  }

  return undefined;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
