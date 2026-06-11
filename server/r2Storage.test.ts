import { describe, expect, it, vi } from "vitest";
import { createR2VideoStorage } from "./r2Storage";

const s3Mock = vi.hoisted(() => ({
  send: vi.fn(),
  clients: [] as unknown[],
  commands: [] as unknown[],
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    constructor(config: unknown) {
      s3Mock.clients.push(config);
    }

    send(command: unknown) {
      return s3Mock.send(command);
    }
  }

  class PutObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
      s3Mock.commands.push(input);
    }
  }

  class DeleteObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
      s3Mock.commands.push(input);
    }
  }

  return { S3Client, PutObjectCommand, DeleteObjectCommand };
});

describe("r2 video storage", () => {
  it("uploads a video and returns a public R2 URL", async () => {
    s3Mock.send.mockResolvedValueOnce({});
    const storage = createR2VideoStorage({
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      R2_BUCKET: "reels",
      R2_PUBLIC_BASE_URL: "https://media.example.com/",
      R2_OBJECT_PREFIX: "/instagram reels/",
    });

    const hostedVideo = await storage.uploadVideo(Buffer.from("mp4"), "video/mp4");

    expect(hostedVideo.key).toMatch(/^instagram reels\/.+\.mp4$/);
    expect(hostedVideo.url).toBe(`https://media.example.com/${hostedVideo.key.replace(" ", "%20")}`);
    expect(s3Mock.clients[0]).toMatchObject({
      region: "auto",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
    });
    expect(s3Mock.commands[0]).toMatchObject({
      Bucket: "reels",
      Key: hostedVideo.key,
      Body: Buffer.from("mp4"),
      ContentType: "video/mp4",
    });
  });
});
