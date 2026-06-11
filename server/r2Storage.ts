import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { ApiRequestError } from "./apiError";

type Env = Record<string, string | undefined>;

export type HostedVideo = {
  key: string;
  url: string;
};

export type VideoStorage = {
  uploadVideo(video: Buffer, contentType: string): Promise<HostedVideo>;
  deleteVideo(key: string): Promise<void>;
};

export function createR2VideoStorage(env: Env = process.env): VideoStorage {
  const config = readR2Config(env);
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async uploadVideo(video: Buffer, contentType: string) {
      const key = createVideoKey(config.objectPrefix);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: video,
            ContentType: contentType,
          })
        );
      } catch (error) {
        throw new ApiRequestError("Cloudflare R2 video upload failed.", 502, normalizeStorageError(error));
      }

      return {
        key,
        url: `${config.publicBaseUrl}/${keyToPublicPath(key)}`,
      };
    },

    async deleteVideo(key: string) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: key,
          })
        );
      } catch (error) {
        throw new ApiRequestError("Cloudflare R2 cleanup failed.", 502, normalizeStorageError(error));
      }
    },
  };
}

function readR2Config(env: Env) {
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
  ];
  const missing = required.filter((key) => !env[key]?.trim());

  if (missing.length) {
    throw new ApiRequestError(`Missing Cloudflare R2 configuration: ${missing.join(", ")}.`, 500);
  }

  return {
    accountId: env.R2_ACCOUNT_ID?.trim() ?? "",
    accessKeyId: env.R2_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
    bucket: env.R2_BUCKET?.trim() ?? "",
    publicBaseUrl: trimTrailingSlash(env.R2_PUBLIC_BASE_URL?.trim() ?? ""),
    objectPrefix: normalizeObjectPrefix(env.R2_OBJECT_PREFIX ?? "instagram-reels"),
  };
}

function createVideoKey(prefix: string) {
  const fileName = `${Date.now()}-${randomUUID()}.mp4`;
  return prefix ? `${prefix}/${fileName}` : fileName;
}

function keyToPublicPath(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function normalizeObjectPrefix(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

function normalizeStorageError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return error;
}
