import { Dpapi, isPlatformSupported } from "@primno/dpapi";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  authorizedAt: number;
};

const SpotifyTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().finite().positive(),
  authorizedAt: z.number().finite().positive()
});

export class SecretStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<SpotifyTokens | null> {
    try {
      const encrypted = Buffer.from(await readFile(this.filePath, "utf8"), "base64");
      this.assertDpapiAvailable();
      const plain = Dpapi.unprotectData(encrypted, null, "CurrentUser");
      return SpotifyTokensSchema.parse(JSON.parse(Buffer.from(plain).toString("utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Could not load the stored Spotify authorization.");
      }
      return null;
    }
  }

  async save(tokens: SpotifyTokens): Promise<void> {
    this.assertDpapiAvailable();
    await mkdir(dirname(this.filePath), { recursive: true });
    const validated = SpotifyTokensSchema.parse(tokens);
    const plain = Buffer.from(JSON.stringify(validated), "utf8");
    const encrypted = Dpapi.protectData(plain, null, "CurrentUser");
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, Buffer.from(encrypted).toString("base64"), {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  private assertDpapiAvailable(): void {
    if (!isPlatformSupported) throw new Error("Windows DPAPI is unavailable; Spotify tokens will not be stored in plaintext.");
  }
}
