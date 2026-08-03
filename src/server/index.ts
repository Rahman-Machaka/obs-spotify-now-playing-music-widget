import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { MAIN_PRESET_ID } from "../shared/profiles.js";
import { AppConfigSchema, type AppConfig, type PlaybackState, type ServerMessage } from "../shared/schema.js";
import { ConfigStore } from "./config-store.js";
import { IDLE_MEDIA_LIMIT_BYTES, IdleMediaStore, parseByteRange } from "./idle-media-store.js";
import { SecretStore } from "./secret-store.js";
import { isAllowedSpotifyImageUrl, SpotifyService } from "./spotify.js";

type RuntimeInfo = { pid: number; port: number; controlToken: string; startedAt: string };

const RuntimeInfoSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1024).max(65535),
  controlToken: z.string().min(32),
  startedAt: z.string().datetime()
});

const COVER_LIMIT_BYTES = 5 * 1024 * 1024;
const ALLOWED_COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

const rootDirectory = process.cwd();
const testDataDirectory = process.env.NODE_ENV === "test" ? process.env.MUSIC_WIDGET_TEST_DATA_DIRECTORY : undefined;
const dataDirectory = testDataDirectory && isAbsolute(testDataDirectory) ? testDataDirectory : join(rootDirectory, ".data");
const runtimePath = join(dataDirectory, "runtime.json");
const command = process.argv[2]?.toLowerCase() ?? "start";

async function readRuntime(): Promise<RuntimeInfo | null> {
  try {
    return RuntimeInfoSchema.parse(JSON.parse(await readFile(runtimePath, "utf8")));
  } catch {
    return null;
  }
}

async function runtimeIsHealthy(runtime: RuntimeInfo): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/health`, {
      signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown; pid?: unknown; service?: unknown };
    return body.service === "obs-music-widget" || (body.ok === true && body.pid === runtime.pid);
  } catch {
    return false;
  }
}

async function readLimitedResponse(response: Response, limit: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) throw new Error("The Spotify cover exceeds the 5 MB cache limit.");
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("The Spotify cover exceeds the 5 MB cache limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

async function requestStop(): Promise<number> {
  const runtime = await readRuntime();
  if (!runtime) {
    await rm(runtimePath, { force: true });
    console.log("Music Widget is not running.");
    return 0;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/system/shutdown`, {
      method: "POST",
      headers: { "x-control-token": runtime.controlToken },
      signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) throw new Error(String(response.status));
    console.log("Music Widget is stopping.");
    return 0;
  } catch {
    console.error("The saved process is not responding. Removing its stale runtime file.");
    await rm(runtimePath, { force: true });
    return 1;
  }
}

async function requestStatus(): Promise<number> {
  const runtime = await readRuntime();
  if (!runtime) {
    await rm(runtimePath, { force: true });
    console.log("Music Widget: stopped");
    return 1;
  }
  if (await runtimeIsHealthy(runtime)) {
    console.log(`Music Widget: running at http://127.0.0.1:${runtime.port}`);
    return 0;
  }
  await rm(runtimePath, { force: true });
  console.log("Music Widget: stopped (removed stale runtime file)");
  return 1;
}

if (command === "stop" || command === "--stop") {
  process.exitCode = await requestStop();
} else if (command === "status" || command === "--status") {
  process.exitCode = await requestStatus();
} else {
  await startServer();
}

async function startServer(): Promise<void> {
  const existing = await readRuntime();
  if (existing) {
    if (await runtimeIsHealthy(existing)) {
      console.log(`Music Widget is already running on port ${existing.port}.`);
      return;
    }
  }
  await rm(runtimePath, { force: true });

  const store = new ConfigStore(rootDirectory, dataDirectory);
  const idleMediaStore = new IdleMediaStore(dataDirectory);
  let config = await store.load();
  let playback: PlaybackState = {
    connected: false,
    status: "checking",
    error: null,
    retryAt: null,
    isPlaying: false,
    progressMs: 0,
    observedAt: Date.now(),
    item: null,
    lastPlayback: null
  };
  let coverCache: { sourceUrl: string; contentType: string; data: Buffer } | null = null;

  const clients = new Set<{ send: (data: string) => void; close: (code?: number, reason?: string) => void; readyState: number }>();
  const broadcast = (message: ServerMessage) => {
    const encoded = JSON.stringify(message);
    for (const socket of clients) {
      if (socket.readyState === 1) socket.send(encoded);
    }
  };

  const secretStore = new SecretStore(join(dataDirectory, "spotify.tokens"));
  const spotify = new SpotifyService(
    () => config,
    secretStore,
    (nextPlayback) => {
      playback = nextPlayback;
      broadcast({ type: "playback", playback });
    }
  );
  await spotify.initialize();
  const app = Fastify({ logger: true, disableRequestLogging: true, forceCloseConnections: "idle" });
  await app.register(fastifyWebsocket);
  app.addContentTypeParser(
    ["image/gif", "image/webp", "video/webm", "image/png", "image/jpeg", "image/jpg", "application/octet-stream"],
    { parseAs: "buffer", bodyLimit: IDLE_MEDIA_LIMIT_BYTES },
    (_request, body, done) => done(null, body)
  );

  const requireTrustedOrigin = async (request: { headers: { origin?: string } }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => {
    const origin = request.headers.origin;
    if (!origin) return;
    const allowedOrigins = new Set([
      `http://127.0.0.1:${config.server.port}`,
      "http://127.0.0.1:5173"
    ]);
    if (!allowedOrigins.has(origin)) return reply.code(403).send({ error: "Forbidden origin" });
  };

  app.get("/api/health", async (_request, reply) => reply
    .header("access-control-allow-origin", "*")
    .header("cache-control", "no-store")
    .send({
      ok: true,
      service: "obs-music-widget",
      pid: process.pid,
      activePreset: config.activePreset,
      spotifyConnected: playback.connected,
      uptimeSeconds: Math.round(process.uptime())
    }));

  app.get("/api/config", async (_request, reply) => reply.header("cache-control", "no-store").send(config));
  app.get("/api/system/bootstrap", async (_request, reply) => reply.header("cache-control", "no-store").send({
    url: pathToFileURL(join(rootDirectory, "dist", "obs-bootstrap.html")).href
  }));
  app.get("/api/playback", async (_request, reply) => reply.header("cache-control", "no-store").send(playback));
  app.get("/api/cover/current", async (request, reply) => {
    const sourceUrl = playback.item?.coverUrl ?? playback.lastPlayback?.item.coverUrl;
    if (!sourceUrl) return reply.code(404).send();
    try {
      if (!coverCache || coverCache.sourceUrl !== sourceUrl) {
        if (!isAllowedSpotifyImageUrl(sourceUrl)) throw new Error("Spotify returned an unsupported cover URL.");
        const response = await fetch(sourceUrl, { redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Cover HTTP ${response.status}`);
        if (!isAllowedSpotifyImageUrl(response.url)) throw new Error("Spotify redirected the cover to an unsupported host.");
        const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
        if (!ALLOWED_COVER_TYPES.has(contentType)) throw new Error("Spotify returned an unsupported cover format.");
        const data = await readLimitedResponse(response, COVER_LIMIT_BYTES);
        if (!data.length) throw new Error("Spotify returned an empty cover response.");
        coverCache = { sourceUrl, contentType, data };
      }
      return reply.type(coverCache.contentType)
        .header("cache-control", "private, max-age=3600")
        .header("x-content-type-options", "nosniff")
        .send(coverCache.data);
    } catch (error) {
      request.log.warn({ error }, "Could not cache the Spotify cover.");
      return reply.code(502).send();
    }
  });
  app.get<{ Params: { preset: string } }>("/api/empty-state-media/:preset", async (request, reply) => {
    if (!config.presets[request.params.preset]) return reply.code(404).send();
    const media = await idleMediaStore.read(request.params.preset);
    if (!media) return reply.code(404).send();
    const range = parseByteRange(request.headers.range, media.data.length);
    if (range === null) return reply.code(416).header("content-range", `bytes */${media.data.length}`).send();
    if (range) {
      const data = media.data.subarray(range.start, range.end + 1);
      return reply.code(206)
        .type(media.contentType)
        .header("accept-ranges", "bytes")
        .header("content-range", `bytes ${range.start}-${range.end}/${media.data.length}`)
        .header("content-length", data.length)
        .header("cache-control", "private, no-cache")
        .header("x-content-type-options", "nosniff")
        .send(data);
    }
    return reply.type(media.contentType)
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, no-cache")
      .header("x-content-type-options", "nosniff")
      .send(media.data);
  });
  app.put<{ Params: { preset: string } }>("/api/empty-state-media/:preset", { preHandler: requireTrustedOrigin }, async (request, reply) => {
    if (!config.presets[request.params.preset]) return reply.code(404).send({ error: "Unknown preset" });
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "A supported media file is required" });
    try {
      const descriptor = await idleMediaStore.save(request.params.preset, request.body);
      return { ok: true, contentType: descriptor.contentType, kind: descriptor.kind };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
  app.delete<{ Params: { preset: string } }>("/api/empty-state-media/:preset", { preHandler: requireTrustedOrigin }, async (request, reply) => {
    if (!config.presets[request.params.preset]) return reply.code(404).send({ error: "Unknown preset" });
    await idleMediaStore.delete(request.params.preset);
    return { ok: true };
  });
  app.put("/api/config", { preHandler: requireTrustedOrigin }, async (request, reply) => {
    const parsed = AppConfigSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid configuration", issues: parsed.error.issues });

    const clientIdChanged = parsed.data.spotify.clientId !== config.spotify.clientId;
    const removedPresetIds = Object.keys(config.presets).filter((presetId) => !parsed.data.presets[presetId]);
    parsed.data.spotify.authorizedAt = config.spotify.authorizedAt;
    config = await store.save(parsed.data);
    await Promise.all(removedPresetIds.map((presetId) => idleMediaStore.delete(presetId)));
    if (clientIdChanged) {
      await spotify.disconnect();
      config.spotify.authorizedAt = null;
      config = await store.save(config);
    }
    broadcast({ type: "config", config });
    return config;
  });

  app.get("/api/auth/login", { preHandler: requireTrustedOrigin }, async (_request, reply) => {
    const redirectUri = `http://127.0.0.1:${config.server.port}/api/auth/callback`;
    try {
      return reply.redirect(spotify.getAuthorizationUrl(redirectUri));
    } catch (error) {
      return reply.code(400).type("text/plain").send((error as Error).message);
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/auth/callback", async (request, reply) => {
    if (request.query.error) return reply.code(400).type("text/html").send(callbackPage("Spotify authorization was cancelled.", false));
    if (!request.query.code || !request.query.state) return reply.code(400).type("text/html").send(callbackPage("Spotify returned an invalid authorization response.", false));
    try {
      const redirectUri = `http://127.0.0.1:${config.server.port}/api/auth/callback`;
      await spotify.completeAuthorization(request.query.code, request.query.state, redirectUri);
      config.spotify.authorizedAt = new Date().toISOString();
      config = await store.save(config);
      broadcast({ type: "config", config });
      return reply.type("text/html").send(callbackPage("Spotify is connected. You can close this window.", true));
    } catch (error) {
      request.log.warn({ message: (error as Error).message }, "Spotify authorization failed.");
      const message = (error as Error).message.startsWith("Spotify ")
        ? (error as Error).message
        : "Spotify authorization could not be completed. Start the connection again from the dashboard.";
      return reply.code(400).type("text/html").send(callbackPage(message, false));
    }
  });

  app.post("/api/auth/disconnect", { preHandler: requireTrustedOrigin }, async () => {
    await spotify.disconnect();
    config.spotify.authorizedAt = null;
    config = await store.save(config);
    broadcast({ type: "config", config });
    return { ok: true };
  });

  app.get("/ws", { websocket: true, preValidation: requireTrustedOrigin }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: "snapshot", config, playback } satisfies ServerMessage));
    socket.on("close", () => clients.delete(socket));
  });

  const distDirectory = join(rootDirectory, "dist");
  try {
    await access(distDirectory);
    await app.register(fastifyStatic, { root: distDirectory });
    app.get("/", (_request, reply) => reply.sendFile("dashboard.html"));
    app.get("/dashboard", (_request, reply) => reply.sendFile("dashboard.html"));
    app.get("/widget", (_request, reply) => reply.sendFile("widget.html"));
    app.get("/widget/:preset", (_request, reply) => reply.sendFile("widget.html"));
  } catch {
    app.get("/", (_request, reply) => reply.redirect("http://127.0.0.1:5173/dashboard.html"));
    app.get("/dashboard", (_request, reply) => reply.redirect("http://127.0.0.1:5173/dashboard.html"));
    app.get<{ Querystring: { preset?: string } }>("/widget", (request, reply) => {
      const preset = request.query.preset || MAIN_PRESET_ID;
      return reply.redirect(`http://127.0.0.1:5173/widget.html?preset=${encodeURIComponent(preset)}`);
    });
    app.get("/widget/:preset", (request, reply) => {
      const preset = (request.params as { preset: string }).preset;
      return reply.redirect(`http://127.0.0.1:5173/widget.html?preset=${encodeURIComponent(preset)}`);
    });
  }

  const controlToken = randomBytes(32).toString("base64url");
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    spotify.stop();
    coverCache = null;
    for (const socket of clients) socket.close(1001, "Server shutdown");
    clients.clear();
    try {
      await app.close();
    } finally {
      const runtime = await readRuntime();
      if (runtime?.pid === process.pid) await rm(runtimePath, { force: true });
    }
  };

  app.post("/api/system/shutdown", async (request, reply) => {
    if (request.headers["x-control-token"] !== controlToken) return reply.code(403).send({ error: "Forbidden" });
    reply.send({ ok: true });
    setImmediate(() => void shutdown().catch((error) => app.log.error({ error }, "Graceful shutdown failed.")));
  });

  const shutdownFromSignal = () => void shutdown().catch((error) => {
    app.log.error({ error }, "Graceful shutdown failed.");
    process.exitCode = 1;
  });
  process.once("SIGINT", shutdownFromSignal);
  process.once("SIGTERM", shutdownFromSignal);

  await app.listen({ host: "127.0.0.1", port: config.server.port });
  const temporaryRuntimePath = `${runtimePath}.${process.pid}.tmp`;
  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(temporaryRuntimePath, JSON.stringify({
      pid: process.pid,
      port: config.server.port,
      controlToken,
      startedAt: new Date().toISOString()
    } satisfies RuntimeInfo), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryRuntimePath, runtimePath);
  } catch (error) {
    await rm(temporaryRuntimePath, { force: true });
    await app.close();
    throw error;
  }
  spotify.start();
  console.log(`Dashboard: http://127.0.0.1:${config.server.port}/dashboard`);
  console.log(`OBS-Widget: http://127.0.0.1:${config.server.port}/widget?preset=${encodeURIComponent(config.activePreset)}`);
}

function callbackPage(message: string, success: boolean): string {
  const safeMessage = message.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character] ?? character);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Music Widget</title><style>body{font:16px system-ui;background:#0f1015;color:#f6f7fb;display:grid;place-items:center;min-height:100vh;margin:0}.card{padding:32px;border:1px solid #292c36;border-radius:18px;background:#171920;max-width:520px}b{color:${success ? "#47d18c" : "#ff6b77"}}</style><div class="card"><b>${success ? "Connected" : "Connection failed"}</b><p>${safeMessage}</p></div></html>`;
}
