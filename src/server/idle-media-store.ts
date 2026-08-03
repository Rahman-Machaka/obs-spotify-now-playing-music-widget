import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const IDLE_MEDIA_LIMIT_BYTES = 20 * 1024 * 1024;

const IdleMediaDescriptorSchema = z.object({
  contentType: z.enum(["image/gif", "image/webp", "video/webm", "image/png", "image/jpeg"]),
  kind: z.enum(["image", "video"]),
  uploadedAt: z.string().datetime()
});

export type IdleMediaDescriptor = z.infer<typeof IdleMediaDescriptorSchema>;
export type StoredIdleMedia = IdleMediaDescriptor & { data: Buffer };

export function parseByteRange(value: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function detectIdleMediaType(data: Uint8Array): Pick<IdleMediaDescriptor, "contentType" | "kind"> | null {
  const ascii = (start: number, length: number) => Buffer.from(data.subarray(start, start + length)).toString("ascii");
  if (data.length >= 24
    && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && ascii(12, 4) === "IHDR"
    && Buffer.from(data).readUInt32BE(16) > 0
    && Buffer.from(data).readUInt32BE(20) > 0) {
    return { contentType: "image/png", kind: "image" };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { contentType: "image/jpeg", kind: "image" };
  }
  if (data.length >= 10
    && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")
    && (data[6] | data[7] << 8) > 0
    && (data[8] | data[9] << 8) > 0) {
    return { contentType: "image/gif", kind: "image" };
  }
  if (data.length >= 16
    && ascii(0, 4) === "RIFF"
    && ascii(8, 4) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(ascii(12, 4))) {
    return { contentType: "image/webp", kind: "image" };
  }
  if (data.length >= 8
    && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3
    && ascii(4, Math.min(data.length - 4, 4096)).toLowerCase().includes("webm")) {
    return { contentType: "video/webm", kind: "video" };
  }
  return null;
}

export class IdleMediaStore {
  private readonly directory: string;

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "empty-state-media");
  }

  async save(presetName: string, data: Buffer): Promise<IdleMediaDescriptor> {
    if (!data.length || data.length > IDLE_MEDIA_LIMIT_BYTES) throw new Error("The media file must be between 1 byte and 20 MB.");
    const detected = detectIdleMediaType(data);
    if (!detected) throw new Error("Unsupported media format. Use GIF, WebP, WebM, PNG, or JPEG.");

    const descriptor: IdleMediaDescriptor = { ...detected, uploadedAt: new Date().toISOString() };
    const paths = this.paths(presetName);
    const nonce = `${process.pid}-${randomBytes(6).toString("hex")}`;
    const temporaryMediaPath = `${paths.media}.${nonce}.tmp`;
    const temporaryDescriptorPath = `${paths.descriptor}.${nonce}.tmp`;
    await mkdir(this.directory, { recursive: true });
    try {
      await writeFile(temporaryMediaPath, data, { mode: 0o600 });
      await writeFile(temporaryDescriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryMediaPath, paths.media);
      await rename(temporaryDescriptorPath, paths.descriptor);
      return descriptor;
    } finally {
      await rm(temporaryMediaPath, { force: true });
      await rm(temporaryDescriptorPath, { force: true });
    }
  }

  async read(presetName: string): Promise<StoredIdleMedia | null> {
    const paths = this.paths(presetName);
    try {
      const mediaStat = await stat(paths.media);
      if (!mediaStat.isFile() || mediaStat.size <= 0 || mediaStat.size > IDLE_MEDIA_LIMIT_BYTES) return null;
      const [data, descriptorText] = await Promise.all([
        readFile(paths.media),
        readFile(paths.descriptor, "utf8")
      ]);
      const descriptor = IdleMediaDescriptorSchema.parse(JSON.parse(descriptorText));
      const detected = detectIdleMediaType(data);
      if (!detected || detected.contentType !== descriptor.contentType || detected.kind !== descriptor.kind) return null;
      return { ...descriptor, data };
    } catch {
      return null;
    }
  }

  async delete(presetName: string): Promise<void> {
    const paths = this.paths(presetName);
    await Promise.all([rm(paths.media, { force: true }), rm(paths.descriptor, { force: true })]);
  }

  private paths(presetName: string): { media: string; descriptor: string } {
    const key = createHash("sha256").update(presetName).digest("hex");
    return {
      media: join(this.directory, `${key}.media`),
      descriptor: join(this.directory, `${key}.json`)
    };
  }
}
