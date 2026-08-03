import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { AppConfigSchema, defaultConfig, type AppConfig } from "../shared/schema.js";

export class ConfigStore {
  readonly dataDirectory: string;
  readonly configPath: string;

  constructor(rootDirectory = process.cwd(), dataDirectory = join(rootDirectory, ".data")) {
    this.dataDirectory = dataDirectory;
    this.configPath = join(this.dataDirectory, "config.json");
  }

  async load(): Promise<AppConfig> {
    await mkdir(this.dataDirectory, { recursive: true });

    try {
      const raw = await readFile(this.configPath, "utf8");
      const stored = JSON.parse(raw);
      const config = AppConfigSchema.parse(stored);
      if (JSON.stringify(stored) !== JSON.stringify(config)) await this.save(config);
      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const backupPath = `${this.configPath}.invalid-${Date.now()}.json`;
        await rename(this.configPath, backupPath);
        console.warn(`Could not validate the configuration. The original file was preserved as ${basename(backupPath)} in the local data directory.`);
      }
      const config = structuredClone(defaultConfig);
      await this.save(config);
      return config;
    }
  }

  async save(input: AppConfig): Promise<AppConfig> {
    const config = AppConfigSchema.parse(input);
    await mkdir(dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.configPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return config;
  }
}
