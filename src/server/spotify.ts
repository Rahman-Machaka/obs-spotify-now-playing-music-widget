import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AppConfig, PlaybackState } from "../shared/schema.js";
import type { SecretStore, SpotifyTokens } from "./secret-store.js";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().finite().positive()
});

const SpotifyImageSchema = z.object({ url: z.string().url() }).passthrough();
const SpotifyItemSchema = z.object({
  id: z.string().nullable().optional(),
  uri: z.string().min(1),
  name: z.string(),
  duration_ms: z.number().finite().nonnegative(),
  artists: z.array(z.object({ name: z.string() }).passthrough()).optional(),
  album: z.object({ name: z.string(), images: z.array(SpotifyImageSchema) }).passthrough().optional(),
  images: z.array(SpotifyImageSchema).optional(),
  show: z.object({ name: z.string() }).passthrough().optional(),
  external_urls: z.object({ spotify: z.string().url().optional() }).passthrough().optional()
}).passthrough();

const CurrentlyPlayingSchema = z.object({
  is_playing: z.boolean(),
  progress_ms: z.number().finite().nonnegative().nullable().optional(),
  item: SpotifyItemSchema.nullable()
}).passthrough();

type PendingAuthorization = {
  verifier: string;
  expiresAt: number;
};

const EMPTY_PLAYBACK: PlaybackState = {
  connected: false,
  status: "not_authorized",
  error: null,
  retryAt: null,
  isPlaying: false,
  progressMs: 0,
  observedAt: Date.now(),
  item: null,
  lastPlayback: null
};

const REQUEST_TIMEOUT_MS = 10_000;

export function isAllowedSpotifyImageUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && (url.hostname === "i.scdn.co" || url.hostname.endsWith(".spotifycdn.com"));
  } catch {
    return false;
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number {
  const seconds = value === null || !value.trim() ? Number.NaN : Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : value ? Date.parse(value) - now : 5_000;
  return Math.min(60 * 60_000, Math.max(1_000, Number.isFinite(delay) ? delay : 5_000));
}

export function normalizeCurrentlyPlaying(input: unknown, observedAt = Date.now()): PlaybackState {
  const data = CurrentlyPlayingSchema.parse(input);
  const item = data.item;
  if (!item) {
    return { connected: true, status: "idle", error: null, retryAt: null, isPlaying: false, progressMs: 0, observedAt, item: null, lastPlayback: null };
  }

  const coverUrlCandidate = item.album?.images[0]?.url ?? item.images?.[0]?.url ?? null;
  const spotifyUrlCandidate = item.external_urls?.spotify;
  let spotifyUrl = "https://open.spotify.com";
  if (spotifyUrlCandidate) {
    const url = new URL(spotifyUrlCandidate);
    if (url.protocol === "https:" && url.hostname === "open.spotify.com" && !url.username && !url.password && !url.port) {
      spotifyUrl = url.toString();
    }
  }

  return {
    connected: true,
    status: "ready",
    error: null,
    retryAt: null,
    isPlaying: data.is_playing,
    progressMs: data.progress_ms ?? 0,
    observedAt,
    item: {
      id: item.id ?? item.uri,
      title: item.name,
      artist: item.artists?.map((artist) => artist.name).join(", ") || item.show?.name || "Spotify",
      album: item.album?.name ?? item.show?.name ?? "",
      durationMs: item.duration_ms,
      coverUrl: coverUrlCandidate && isAllowedSpotifyImageUrl(coverUrlCandidate) ? coverUrlCandidate : null,
      spotifyUrl
    },
    lastPlayback: null
  };
}

export function retainLastPlayback(playback: PlaybackState, previous: PlaybackState["lastPlayback"]): PlaybackState {
  const lastPlayback = playback.item
    ? { item: playback.item, progressMs: playback.progressMs }
    : previous;
  return { ...playback, lastPlayback };
}

export class SpotifyService {
  private tokens: SpotifyTokens | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pending = new Map<string, PendingAuthorization>();
  private playback: PlaybackState = EMPTY_PLAYBACK;
  private lastPlayback: PlaybackState["lastPlayback"] = null;
  private running = false;
  private requestController = new AbortController();

  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly secretStore: SecretStore,
    private readonly onPlayback: (playback: PlaybackState) => void
  ) {}

  async initialize(): Promise<void> {
    this.tokens = await this.secretStore.load();
    this.setPlayback({
      ...EMPTY_PLAYBACK,
      status: this.tokens ? "checking" : "not_authorized",
      observedAt: Date.now()
    });
  }

  getPlayback(): PlaybackState {
    return this.playback;
  }

  getAuthorizationUrl(redirectUri: string): string {
    const clientId = this.getConfig().spotify.clientId.trim();
    if (!clientId) throw new Error("Enter a Spotify Client ID before connecting.");

    const now = Date.now();
    for (const [pendingState, authorization] of this.pending) {
      if (authorization.expiresAt < now) this.pending.delete(pendingState);
    }
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    this.pending.set(state, { verifier, expiresAt: now + 10 * 60_000 });

    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "user-read-currently-playing",
      state,
      code_challenge_method: "S256",
      code_challenge: challenge
    }).toString();
    return url.toString();
  }

  async completeAuthorization(code: string, state: string, redirectUri: string): Promise<void> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expiresAt < Date.now()) throw new Error("The Spotify login request is invalid or has expired. Start the connection again from the dashboard.");

    const clientId = this.getConfig().spotify.clientId.trim();
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: pending.verifier
      }),
      signal: this.requestSignal()
    });
    if (!response.ok) throw new Error(`Spotify rejected the authorization request (HTTP ${response.status}).`);

    const data = TokenResponseSchema.parse(await response.json());
    if (!data.refresh_token) throw new Error("Spotify did not return a refresh token. Start the connection again from the dashboard.");
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      authorizedAt: Date.now()
    };
    await this.secretStore.save(this.tokens);
    this.setPlayback({ ...EMPTY_PLAYBACK, status: "checking", observedAt: Date.now() });
    this.schedule(0);
  }

  async disconnect(): Promise<void> {
    this.requestController.abort();
    this.requestController = new AbortController();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.lastPlayback = null;
    this.tokens = null;
    await this.secretStore.clear();
    this.setPlayback({ ...EMPTY_PLAYBACK, status: "not_authorized", observedAt: Date.now() });
    this.schedule(0);
  }

  start(): void {
    if (this.requestController.signal.aborted) this.requestController = new AbortController();
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.requestController.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.tokens) return false;
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.tokens.refreshToken,
        client_id: this.getConfig().spotify.clientId.trim()
      }),
      signal: this.requestSignal()
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        this.tokens = null;
        await this.secretStore.clear();
        this.setPlayback({ ...EMPTY_PLAYBACK, status: "reauthorize", observedAt: Date.now() });
      } else {
        this.setPlayback({
          ...this.playback,
          connected: false,
          status: "error",
          error: `Spotify token service returned HTTP ${response.status}`,
          retryAt: Date.now() + 10_000
        });
      }
      return false;
    }
    const data = TokenResponseSchema.parse(await response.json());
    this.tokens = {
      ...this.tokens,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? this.tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000
    };
    await this.secretStore.save(this.tokens);
    return true;
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    if (!this.tokens) {
      const status = this.playback.status === "reauthorize" ? "reauthorize" : "not_authorized";
      this.setPlayback({ ...EMPTY_PLAYBACK, status, observedAt: Date.now() });
      this.schedule(10_000);
      return;
    }

    try {
      if (this.tokens.expiresAt <= Date.now() + 60_000 && !await this.refreshAccessToken()) {
        this.schedule(10_000);
        return;
      }

      const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { authorization: `Bearer ${this.tokens.accessToken}` },
        signal: this.requestSignal()
      });

      if (response.status === 204) {
        this.setPlayback({ connected: true, status: "idle", error: null, retryAt: null, isPlaying: false, progressMs: 0, observedAt: Date.now(), item: null, lastPlayback: this.lastPlayback });
        this.schedule(3_000);
        return;
      }
      if (response.status === 401) {
        const refreshed = await this.refreshAccessToken();
        this.schedule(refreshed ? 500 : 10_000);
        return;
      }
      if (response.status === 429) {
        const retryMs = parseRetryAfter(response.headers.get("retry-after"));
        this.setPlayback({ ...this.playback, connected: true, status: "rate_limited", error: null, retryAt: Date.now() + retryMs });
        this.schedule(retryMs);
        return;
      }
      if (!response.ok) throw new Error(`Spotify API ${response.status}`);

      const nextPlayback = normalizeCurrentlyPlaying(await response.json());
      this.setPlayback(nextPlayback);
      this.schedule(nextPlayback.status === "ready" ? 1_500 : 3_000);
    } catch (error) {
      if (!this.running) return;
      if ((error as Error).name === "AbortError") return;
      console.warn("Spotify playback request failed:", (error as Error).message);
      this.setPlayback({
        ...this.playback,
        connected: false,
        status: "error",
        error: "Spotify playback is temporarily unavailable.",
        retryAt: Date.now() + 10_000
      });
      this.schedule(10_000);
    }
  }

  private setPlayback(playback: PlaybackState): void {
    this.playback = retainLastPlayback(playback, this.lastPlayback);
    this.lastPlayback = this.playback.lastPlayback;
    this.onPlayback(this.playback);
  }

  private requestSignal(): AbortSignal {
    return AbortSignal.any([this.requestController.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  }
}
