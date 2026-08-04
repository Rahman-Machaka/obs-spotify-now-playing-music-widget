import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractGoogleFontFamily } from "../build/server/shared/google-fonts.js";
import { extractCoverPalette } from "../build/server/shared/cover-palette.js";
import { blendHexColors, getAutomaticTextStyle, getContrastRatio, getDerivedProgressTrackColor, hexToRgba } from "../build/server/shared/color-contrast.js";
import { getCompensatedSpotifyLogoWidth, getDesignDimensions, getLayoutScaleLimit, getRecommendedSourceDimensions, SPOTIFY_FULL_LOGO_WIDTH_PX } from "../build/server/shared/layout-dimensions.js";
import { reconcilePlaybackProgress } from "../build/server/shared/playback-progress.js";
import { MAIN_PRESET_ID, MAX_PRESET_COUNT } from "../build/server/shared/profiles.js";
import { AppConfigSchema, defaultConfig } from "../build/server/shared/schema.js";
import { ConfigStore } from "../build/server/server/config-store.js";
import { detectIdleMediaType, IdleMediaStore, parseByteRange } from "../build/server/server/idle-media-store.js";
import { SecretStore } from "../build/server/server/secret-store.js";
import { isAllowedSpotifyImageUrl, normalizeCurrentlyPlaying, parseRetryAfter, retainLastPlayback, SpotifyService } from "../build/server/server/spotify.js";

test("Google Fonts URLs are parsed only from supported HTTPS hosts", () => {
  assert.equal(extractGoogleFontFamily("https://fonts.google.com/specimen/Roboto+Slab"), "Roboto Slab");
  assert.equal(extractGoogleFontFamily("https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400;700&display=swap"), "Roboto Slab");
  assert.equal(extractGoogleFontFamily("http://fonts.google.com/specimen/Roboto"), null);
  assert.equal(extractGoogleFontFamily("https://example.com/specimen/Roboto"), null);
});

test("layout dimensions include compact, portrait, and minimal variants", () => {
  assert.deepEqual(getRecommendedSourceDimensions("compact", "square"), { width: 600, height: 200 });
  assert.deepEqual(getDesignDimensions("compact", "none"), { width: 570, height: 180 });
  assert.deepEqual(getRecommendedSourceDimensions("portrait", "none"), { width: 420, height: 244 });
  assert.deepEqual(getDesignDimensions("minimal", "square"), { width: 950, height: 64 });
  assert.deepEqual(getRecommendedSourceDimensions("minimal", "none"), { width: 800, height: 100 });
  assert.equal(getLayoutScaleLimit("minimal", "square"), 63 / 64);
  assert.equal(getLayoutScaleLimit("boxy", "square"), Number.POSITIVE_INFINITY);
  assert.equal(SPOTIFY_FULL_LOGO_WIDTH_PX, 70);
  assert.equal(getCompensatedSpotifyLogoWidth(.5) * .5, 70);
});

test("automatic text styling chooses contrast without changing configured colors", () => {
  assert.equal(getAutomaticTextStyle("dark", "#111111", true).color, "#ffffff");
  assert.equal(getAutomaticTextStyle("light", "#f5e8d0", true).color, "#111318");
  const midToneStyle = getAutomaticTextStyle("dark", "#808080", true);
  const estimatedTintedPanel = blendHexColors("#808080", "#141519", .62);
  assert.ok(getContrastRatio(midToneStyle.artistColor, estimatedTintedPanel) >= 4.5);
  assert.match(midToneStyle.filter, /^drop-shadow\(/);
  assert.equal(hexToRgba("#ff8000", .5), "rgba(255, 128, 0, 0.50)");
  assert.equal(getDerivedProgressTrackColor("#ff8000", "dark"), "#643910");
});

test("cover palettes derive distinct readable surface, accent, track, and text colors", () => {
  const pixels = new Uint8ClampedArray([
    ...Array(40).fill([65, 28, 42, 255]).flat(),
    ...Array(18).fill([211, 68, 38, 255]).flat(),
    ...Array(10).fill([242, 174, 151, 255]).flat(),
    ...Array(4).fill([0, 0, 0, 0]).flat()
  ]);
  const palette = extractCoverPalette(pixels);
  assert.match(palette.surface, /^#[0-9a-f]{6}$/);
  assert.match(palette.accent, /^#[0-9a-f]{6}$/);
  assert.notEqual(palette.surface, palette.accent);
  assert.notEqual(palette.track, palette.accent);
  assert.ok(getContrastRatio(palette.text, palette.surface) >= 4.5);
  assert.ok(getContrastRatio(palette.artistText, palette.surface) >= 4.5);
});

test("playback progress ignores polling drift but preserves deliberate seeks", () => {
  assert.equal(reconcilePlaybackProgress(90_000, 88_800, true), 90_000);
  assert.equal(reconcilePlaybackProgress(90_000, 87_500, true), 87_500);
  assert.equal(reconcilePlaybackProgress(90_000, 91_000, true), 91_000);
  assert.equal(reconcilePlaybackProgress(90_000, 500, false), 500);
});

test("legacy progress-track colors migrate to the explicit custom-color switch", () => {
  const config = structuredClone(defaultConfig);
  config.presets.main.progressStyle = { trackColor: "#123456" };
  assert.deepEqual(AppConfigSchema.parse(config).presets.main.progressStyle, {
    customTrackColor: true,
    trackColor: "#123456"
  });
  config.presets.main.progressStyle = { trackColor: null };
  assert.deepEqual(AppConfigSchema.parse(config).presets.main.progressStyle, {
    customTrackColor: false,
    trackColor: "#f5f5f5"
  });
});

test("profile configuration keeps main and permits five additional profiles", () => {
  const config = structuredClone(defaultConfig);
  for (let index = 1; index < MAX_PRESET_COUNT; index += 1) {
    config.presets[`scene-${index}`] = { ...structuredClone(config.presets.main), name: `Scene ${index}` };
  }
  config.activePreset = "scene-1";
  const parsed = AppConfigSchema.parse(config);
  assert.equal(parsed.activePreset, MAIN_PRESET_ID);
  assert.equal(Object.keys(parsed.presets).length, 6);

  config.presets["scene-6"] = { ...structuredClone(config.presets.main), name: "Scene 6" };
  assert.throws(() => AppConfigSchema.parse(config));
  delete config.presets["scene-6"];
  delete config.presets.main;
  assert.throws(() => AppConfigSchema.parse(config));
});

test("Spotify playback responses are validated and normalized", () => {
  const playback = normalizeCurrentlyPlaying({
    is_playing: true,
    progress_ms: 12_345,
    item: {
      id: "track-id",
      uri: "spotify:track:track-id",
      name: "Track title",
      duration_ms: 180_000,
      artists: [{ name: "Artist one" }, { name: "Artist two" }],
      album: { name: "Album", images: [{ url: "https://i.scdn.co/image/example" }] },
      external_urls: { spotify: "https://open.spotify.com/track/track-id" }
    }
  }, 1000);
  assert.equal(playback.status, "ready");
  assert.equal(playback.item?.artist, "Artist one, Artist two");
  assert.equal(playback.item?.coverUrl, "https://i.scdn.co/image/example");
  assert.equal(playback.observedAt, 1000);
  assert.equal(playback.lastPlayback, null);

  const unsafe = normalizeCurrentlyPlaying({
    is_playing: false,
    item: {
      uri: "spotify:episode:episode-id",
      name: "Episode title",
      duration_ms: 1000,
      images: [{ url: "http://127.0.0.1/private.png" }],
      show: { name: "Podcast" },
      external_urls: { spotify: "https://example.com/not-spotify" }
    }
  });
  assert.equal(unsafe.item?.coverUrl, null);
  assert.equal(unsafe.item?.spotifyUrl, "https://open.spotify.com");
  assert.throws(() => normalizeCurrentlyPlaying({ is_playing: "yes", item: null }));

  const idle = normalizeCurrentlyPlaying({ is_playing: false, item: null });
  const remembered = retainLastPlayback(playback, null).lastPlayback;
  assert.equal(retainLastPlayback(idle, remembered).lastPlayback?.item.title, "Track title");
  assert.equal(retainLastPlayback(idle, remembered).lastPlayback?.progressMs, 12_345);
});

test("Spotify image hosts and Retry-After values are constrained", () => {
  assert.equal(isAllowedSpotifyImageUrl("https://i.scdn.co/image/example"), true);
  assert.equal(isAllowedSpotifyImageUrl("https://image-cdn-ak.spotifycdn.com/image/example"), true);
  assert.equal(isAllowedSpotifyImageUrl("https://spotifycdn.com.evil.example/image"), false);
  assert.equal(isAllowedSpotifyImageUrl("http://127.0.0.1/image"), false);
  assert.equal(parseRetryAfter("3", 0), 3000);
  assert.equal(parseRetryAfter(null, 0), 5000);
  assert.equal(parseRetryAfter("invalid", 0), 5000);
});

test("Spotify authorization uses PKCE and the minimum read-only scope", () => {
  const config = structuredClone(defaultConfig);
  config.spotify.clientId = "test-client-id";
  const secretStore = { load: async () => null, save: async () => undefined, clear: async () => undefined };
  const spotify = new SpotifyService(() => config, secretStore, () => undefined);
  const url = new URL(spotify.getAuthorizationUrl("http://127.0.0.1:3847/api/auth/callback"));
  assert.equal(url.origin, "https://accounts.spotify.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "user-read-currently-playing");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok((url.searchParams.get("state")?.length ?? 0) >= 32);
  assert.ok((url.searchParams.get("code_challenge")?.length ?? 0) >= 43);
  assert.equal(url.searchParams.has("code_verifier"), false);
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("configuration migration preserves legacy values and invalid files", async () => {
  const root = await mkdtemp(join(tmpdir(), "obs-music-widget-config-"));
  const dataDirectory = join(root, ".data");
  const store = new ConfigStore(root, dataDirectory);
  try {
    const legacy = structuredClone(defaultConfig);
    delete legacy.language;
    delete legacy.presets.main.fontSource;
    delete legacy.presets.main.textStyle;
    delete legacy.presets.main.progressStyle;
    delete legacy.presets.main.widgetStyle;
    delete legacy.presets.main.coverPalette;
    legacy.presets.main.layout = "minimal";
    legacy.presets.main.cover = { visible: false, glow: true };
    legacy.presets.main.animations = { enter: "grow", exit: "tilt-right" };
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(store.configPath, JSON.stringify(legacy), "utf8");
    const migrated = await store.load();
    assert.equal(migrated.language, "auto");
    assert.equal(migrated.presets.main.layout, "minimal");
    assert.equal(migrated.presets.main.cover.mode, "none");
    assert.equal(migrated.presets.main.cover.glow, true);
    assert.deepEqual(migrated.presets.main.animations, { enter: "fade", exit: "slide-right" });
    assert.equal(migrated.presets.main.emptyState.useLastPlayback, false);
    assert.deepEqual(migrated.presets.main.textStyle, {
      color: null,
      autoContrast: false,
      shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 }
    });
    assert.deepEqual(migrated.presets.main.progressStyle, { customTrackColor: false, trackColor: "#f5f5f5" });
    assert.deepEqual(migrated.presets.main.widgetStyle, {
      surfaceOpacity: 100,
      outline: { enabled: true, color: null, opacity: 100, width: 1 },
      shadow: { enabled: true, color: null, opacity: 100, blur: 9 }
    });
    assert.deepEqual(migrated.presets.main.coverPalette, { enabled: false });
    assert.deepEqual(migrated.presets.main.emptyState.dim, { enabled: false, percent: 35 });
    assert.deepEqual(migrated.presets.main.emptyState.media, {
      enabled: false,
      kind: null,
      crop: false,
      positionX: 50,
      positionY: 50,
      zoom: 1,
      revision: 0
    });

    await writeFile(store.configPath, "{invalid json", "utf8");
    const originalWarn = console.warn;
    console.warn = () => undefined;
    const restored = await store.load().finally(() => { console.warn = originalWarn; });
    assert.equal(restored.activePreset, "main");
    assert.ok((await readdir(dataDirectory)).some((name) => name.startsWith("config.json.invalid-")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("idle media formats are detected and stored outside the configuration", async () => {
  const samples = [
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]), "image/png", "image"],
    [Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg", "image"],
    [Buffer.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0]), "image/gif", "image"],
    [Buffer.from("RIFF0000WEBPVP8X", "ascii"), "image/webp", "image"],
    [Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("webm", "ascii")]), "video/webm", "video"]
  ];
  for (const [data, contentType, kind] of samples) {
    assert.deepEqual(detectIdleMediaType(data), { contentType, kind });
  }
  assert.equal(detectIdleMediaType(Buffer.from("<html>not media</html>")), null);
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.equal(parseByteRange("bytes=12-", 10), null);

  const root = await mkdtemp(join(tmpdir(), "obs-music-widget-idle-media-"));
  const store = new IdleMediaStore(root);
  try {
    const png = samples[0][0];
    const descriptor = await store.save("main/unsafe-path", png);
    assert.equal(descriptor.contentType, "image/png");
    assert.deepEqual((await store.read("main/unsafe-path"))?.data, png);
    assert.equal(await store.read("another-preset"), null);
    await store.delete("main/unsafe-path");
    assert.equal(await store.read("main/unsafe-path"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Spotify token storage round-trips through DPAPI without plaintext", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "obs-music-widget-secrets-"));
  const tokenPath = join(root, "spotify.tokens");
  const store = new SecretStore(tokenPath);
  const tokens = { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: Date.now() + 60_000, authorizedAt: Date.now() };
  try {
    await store.save(tokens);
    const raw = await readFile(tokenPath, "utf8");
    assert.equal(raw.includes(tokens.accessToken), false);
    assert.equal(Buffer.from(raw, "base64").toString("utf8").includes(tokens.refreshToken), false);
    assert.deepEqual(await store.load(), tokens);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
