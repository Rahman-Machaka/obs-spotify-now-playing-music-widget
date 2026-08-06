/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { AppConfig, PlaybackState, Preset, ServerMessage } from "../../shared/schema";
import { getAutomaticTextStyle, getDerivedProgressTrackColor, hexToRgba } from "../../shared/color-contrast";
import { extractCoverPalette, FALLBACK_COVER_PALETTE, type CoverPalette } from "../../shared/cover-palette";
import { reconcilePlaybackProgress } from "../../shared/playback-progress";
import spotifyLogoBlack from "../assets/spotify-logo-black.svg";
import spotifyLogoWhite from "../assets/spotify-logo-white.svg";
import { MusicNoteIcon } from "./components/atoms/MusicNoteIcon";
import { OverflowText } from "./components/atoms/OverflowText";
import { StatusCard } from "./components/molecules/StatusCard";
import { Visualizer } from "./components/molecules/Visualizer";
import { WidgetScaler } from "./components/organisms/WidgetScaler";
import { widgetLanguage, widgetTranslator, type WidgetTranslationKey } from "./i18n";

const emptyPlayback: PlaybackState = { connected: false, status: "checking", error: null, retryAt: null, isPlaying: false, progressMs: 0, observedAt: Date.now(), item: null, lastPlayback: null };
const COVER_REFLOW_DURATION_MS = 360;
const HEALTH_CHECK_TIMEOUT_MS = 1500;
type ServerConnectionState = "checking" | "online" | "offline";
const fallbackTextStyle: Preset["textStyle"] = {
  color: null,
  autoContrast: false,
  shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 }
};
const fallbackWidgetStyle: Preset["widgetStyle"] = {
  surfaceOpacity: 100,
  outline: { enabled: true, color: null, opacity: 100, width: 1 },
  shadow: { enabled: true, color: null, opacity: 100, blur: 9 }
};

function palettesMatch(first: CoverPalette, second: CoverPalette): boolean {
  return first.surface === second.surface
    && first.accent === second.accent
    && first.track === second.track
    && first.text === second.text
    && first.artistText === second.artistText;
}

function presetName(): string {
  const queryPreset = new URLSearchParams(location.search).get("preset");
  if (queryPreset) return queryPreset;
  const segments = location.pathname.split("/").filter(Boolean);
  if (segments[0] !== "widget" || !segments[1]) return "main";
  try {
    return decodeURIComponent(segments[1]);
  } catch {
    return "main";
  }
}

export function Widget() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(emptyPlayback);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [serverConnection, setServerConnection] = useState<ServerConnectionState>("checking");
  const [coverPalette, setCoverPalette] = useState<CoverPalette>(FALLBACK_COVER_PALETTE);
  const [paletteTransition, setPaletteTransition] = useState<{
    previousSurface: string;
    cycle: number;
  }>({ previousSurface: FALLBACK_COVER_PALETTE.surface, cycle: 0 });
  const [coverContentReady, setCoverContentReady] = useState(true);
  const [idleMediaFailed, setIdleMediaFailed] = useState(false);
  const lastTrack = useRef<string | null>(null);
  const progressRef = useRef(0);
  const progressTrack = useRef<string | null>(null);
  const progressWasPlaying = useRef(false);
  const lastProgressTick = useRef(Date.now());
  const coverPaletteRef = useRef<CoverPalette>(FALLBACK_COVER_PALETTE);
  const selectedPreset = presetName();

  const applyCoverPalette = useCallback((nextPalette: CoverPalette, animate: boolean) => {
    const previousPalette = coverPaletteRef.current;
    if (palettesMatch(previousPalette, nextPalette)) return;
    coverPaletteRef.current = nextPalette;
    setCoverPalette(nextPalette);
    setPaletteTransition((current) => ({
      previousSurface: animate ? previousPalette.surface : nextPalette.surface,
      cycle: animate ? current.cycle + 1 : current.cycle
    }));
  }, []);

  useEffect(() => {
    document.documentElement.lang = widgetLanguage(config?.language);
  }, [config?.language]);

  useEffect(() => {
    let retryTimer: number;
    let stopped = false;
    let socket: WebSocket | undefined;

    const readJson = async (path: string) => {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.json();
    };
    const confirmServerAvailability = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
        const health = await response.json() as { service?: unknown; ok?: unknown; pid?: unknown };
        if (health.service !== "obs-music-widget" && !(health.ok === true && Number.isInteger(health.pid))) {
          throw new Error("Unexpected local service");
        }
        if (!stopped) setServerConnection("online");
      } catch {
        if (!stopped && socket?.readyState !== WebSocket.OPEN) setServerConnection("offline");
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void Promise.all([readJson("/api/config"), readJson("/api/playback")])
      .then(([initialConfig, initialPlayback]) => {
        if (stopped) return;
        setConfig(initialConfig as AppConfig);
        setPlayback(initialPlayback as PlaybackState);
        setServerConnection("online");
      })
      .catch(() => { void confirmServerAvailability(); });

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      try {
        socket = new WebSocket(`${protocol}//${location.host}/ws`);
      } catch {
        void confirmServerAvailability();
        if (!stopped) retryTimer = window.setTimeout(connect, 2000);
        return;
      }
      socket.onopen = () => {
        setServerConnection("online");
        window.parent.postMessage({ type: "music-widget-ready" }, "*");
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        setServerConnection("online");
        if (message.type === "snapshot") { setConfig(message.config); setPlayback(message.playback); }
        else if (message.type === "config") setConfig(message.config);
        else if (message.type === "playback") setPlayback(message.playback);
      };
      socket.onclose = () => {
        window.parent.postMessage({ type: "music-widget-disconnected" }, "*");
        if (!stopped) {
          void confirmServerAvailability();
          retryTimer = window.setTimeout(connect, 2000);
        }
      };
    };
    connect();
    return () => { stopped = true; window.clearTimeout(retryTimer); socket?.close(); };
  }, []);

  const resolvedPreset = config?.presets[selectedPreset]
    ? selectedPreset
    : config?.activePreset ?? "main";
  const preset = config?.presets[resolvedPreset];

  useEffect(() => {
    if (preset?.cover.mode !== "square") {
      setCoverContentReady(false);
      return;
    }
    if (coverContentReady) return;

    // Spotify artwork must not resize with the layout transition. Insert it only
    // after the empty cover slot has reached its final dimensions.
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : COVER_REFLOW_DURATION_MS;
    const timer = window.setTimeout(() => setCoverContentReady(true), delay);
    return () => window.clearTimeout(timer);
  }, [coverContentReady, preset?.cover.mode]);

  useEffect(() => {
    const existing = document.getElementById("music-widget-google-font");
    if (!preset || preset.fontSource !== "google") {
      existing?.remove();
      return;
    }
    const link = (existing as HTMLLinkElement | null) ?? document.createElement("link");
    link.id = "music-widget-google-font";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${new URLSearchParams({ family: preset.fontFamily, display: "swap" })}`;
    if (!existing) document.head.appendChild(link);
    return () => link.remove();
  }, [preset?.fontFamily, preset?.fontSource]);

  useEffect(() => {
    const now = Date.now();
    const durationMs = playback.item?.durationMs ?? 0;
    const trackId = playback.item?.id ?? null;
    const currentProgress = progressRef.current
      + (progressWasPlaying.current ? Math.max(0, now - lastProgressTick.current) : 0);
    const reportedProgress = playback.progressMs
      + (playback.isPlaying ? Math.max(0, now - playback.observedAt) : 0);
    const nextProgress = Math.min(
      durationMs,
      reconcilePlaybackProgress(currentProgress, reportedProgress, progressTrack.current === trackId)
    );

    progressRef.current = nextProgress;
    progressTrack.current = trackId;
    progressWasPlaying.current = playback.isPlaying;
    lastProgressTick.current = now;
    setProgress(nextProgress);
  }, [playback.isPlaying, playback.item?.durationMs, playback.item?.id, playback.observedAt, playback.progressMs]);

  useEffect(() => {
    lastProgressTick.current = Date.now();
    progressWasPlaying.current = playback.isPlaying;
    if (!playback.isPlaying) return;

    const durationMs = playback.item?.durationMs ?? 0;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const nextProgress = Math.min(durationMs, progressRef.current + Math.max(0, now - lastProgressTick.current));
      progressRef.current = nextProgress;
      lastProgressTick.current = now;
      setProgress(nextProgress);
    }, 250);
    return () => window.clearInterval(timer);
  }, [playback.isPlaying, playback.item?.durationMs, playback.item?.id]);

  useEffect(() => {
    if (!preset) return;
    const trackId = playback.item?.id ?? null;
    let timer: number | undefined;

    if (preset.visibility.hideOnPause && !playback.isPlaying) {
      timer = window.setTimeout(() => setVisible(false), preset.visibility.hideDelaySeconds * 1000);
    } else if (trackId && trackId !== lastTrack.current) {
      lastTrack.current = trackId;
      setVisible(true);
      if (preset.visibility.songChangeOnly) timer = window.setTimeout(() => setVisible(false), preset.visibility.visibleDurationSeconds * 1000);
    } else if (!preset.visibility.songChangeOnly) {
      setVisible(true);
    }
    return () => window.clearTimeout(timer);
  }, [playback.item?.id, playback.isPlaying, preset]);

  const rememberedPlayback = !playback.item && preset?.emptyState.useLastPlayback ? playback.lastPlayback : null;
  const displayedItem = playback.item ?? rememberedPlayback?.item ?? null;
  const idle = !playback.item;
  const displayedProgress = playback.item ? progress : rememberedPlayback?.progressMs ?? 0;
  const view = useMemo(() => ({
    title: displayedItem?.title ?? preset?.emptyState.title ?? "Nothing Playing",
    artist: displayedItem?.artist ?? preset?.emptyState.artist ?? "Start the music",
    coverUrl: displayedItem?.coverUrl ? `/api/cover/current?id=${encodeURIComponent(displayedItem.id)}` : null,
    spotifyUrl: displayedItem?.spotifyUrl ?? "https://open.spotify.com",
    durationMs: displayedItem?.durationMs ?? 0
  }), [displayedItem, preset?.emptyState.artist, preset?.emptyState.title]);

  useEffect(() => {
    if (!view.coverUrl) {
      applyCoverPalette(FALLBACK_COVER_PALETTE, false);
      return;
    }
    if (!preset?.cover.glow && !preset?.coverPalette?.enabled) return;
    const image = new Image();
    image.onload = () => applyCoverPalette(extractPaletteFromImage(image), Boolean(preset.coverPalette?.enabled));
    image.src = view.coverUrl;
    return () => { image.onload = null; };
  }, [applyCoverPalette, view.coverUrl, preset?.cover.glow, preset?.coverPalette?.enabled]);

  useEffect(() => setIdleMediaFailed(false), [resolvedPreset, preset?.emptyState.media.revision]);

  const translateStatus = widgetTranslator(config?.language);
  if (serverConnection === "checking") return null;
  if (serverConnection === "offline") {
    return <StatusCard
      title={translateStatus("serverTitle")}
      detail={translateStatus("serverText")}
      action={translateStatus("openDashboard")}
      animation={preset?.animations.enter ?? "fade"}
    />;
  }
  if (!preset) return null;
  const textStyle = preset.textStyle ?? fallbackTextStyle;
  const progressStyle = preset.progressStyle ?? { customTrackColor: false, trackColor: "#f5f5f5" };
  const widgetStyle = preset.widgetStyle ?? fallbackWidgetStyle;
  const paletteEnabled = Boolean(preset.coverPalette?.enabled && view.coverUrl);
  const customTrackColor = progressStyle.customTrackColor ?? Boolean(progressStyle.trackColor);
  const status = getWidgetStatus(playback.status, translateStatus);
  if (status && !playback.item) {
    return <StatusCard title={status.title} detail={status.detail} action={translateStatus("openDashboard")} animation={preset.animations.enter} />;
  }
  const percentage = view.durationMs ? Math.min(100, displayedProgress / view.durationMs * 100) : 0;
  const automaticTextStyle = getAutomaticTextStyle(preset.theme, coverPalette.surface, (preset.cover.glow || paletteEnabled) && Boolean(view.coverUrl));
  const textColor = paletteEnabled ? coverPalette.text : textStyle.autoContrast ? automaticTextStyle.color : textStyle.color;
  const textShadow = paletteEnabled
    ? "none"
    : textStyle.autoContrast
    ? automaticTextStyle.shadow
    : textStyle.shadow.enabled
      ? `0 1px ${textStyle.shadow.blur}px ${hexToRgba(textStyle.shadow.color, textStyle.shadow.opacity / 100)}`
      : "none";
  const textFilter = paletteEnabled
    ? "none"
    : textStyle.autoContrast
    ? automaticTextStyle.filter
    : textStyle.shadow.enabled
      ? `drop-shadow(0 1px ${textStyle.shadow.blur}px ${hexToRgba(textStyle.shadow.color, textStyle.shadow.opacity / 100)})`
      : "none";
  const outlineColor = widgetStyle.outline.color
    ? hexToRgba(widgetStyle.outline.color, widgetStyle.outline.opacity / 100)
    : `color-mix(in srgb, var(--panel-border) ${widgetStyle.outline.opacity}%, transparent)`;
  const shadowColor = widgetStyle.shadow.color
    ? hexToRgba(widgetStyle.shadow.color, widgetStyle.shadow.opacity / 100)
    : `color-mix(in srgb, var(--panel-shadow) ${widgetStyle.shadow.opacity}%, transparent)`;
  const style: JSX.CSSProperties & Record<string, string | number | undefined> = {
    "--accent": paletteEnabled ? coverPalette.accent : preset.accentColor,
    "--font": preset.fontFamily,
    "--cover-color": coverPalette.surface,
    ...(paletteEnabled ? { "--panel": coverPalette.surface } : {}),
    "--previous-panel": paletteTransition.previousSurface,
    "--idle-opacity": String(preset.emptyState.dim.enabled ? 1 - preset.emptyState.dim.percent / 100 : 1),
    "--text-shadow": textShadow,
    "--text-filter": textFilter,
    "--surface-opacity": `${widgetStyle.surfaceOpacity}%`,
    "--widget-outline-width": widgetStyle.outline.enabled ? `${widgetStyle.outline.width}px` : "0px",
    "--widget-outline-color": outlineColor,
    "--widget-drop-shadow": widgetStyle.shadow.enabled
      ? `0 4px ${widgetStyle.shadow.blur}px ${shadowColor}`
      : "0 0 0 transparent",
    "--widget-inset-outline": widgetStyle.outline.enabled
      ? "inset 0 0 0 1px var(--panel-inset)"
      : "inset 0 0 0 transparent",
    ...(textColor ? {
      "--text": textColor,
      "--artist-text": paletteEnabled
        ? coverPalette.artistText
        : textStyle.autoContrast
        ? automaticTextStyle.artistColor
        : `color-mix(in srgb, ${textColor} 82%, transparent)`
    } : {}),
    "--progress-track": paletteEnabled
      ? coverPalette.track
      : customTrackColor
      ? progressStyle.trackColor ?? "#f5f5f5"
      : getDerivedProgressTrackColor(preset.accentColor, preset.theme)
  };
  const idleMediaUrl = `/api/empty-state-media/${encodeURIComponent(resolvedPreset)}?v=${preset.emptyState.media.revision}`;
  const mediaStyle: JSX.CSSProperties = {
    objectFit: preset.emptyState.media.crop ? "cover" : "contain",
    objectPosition: `${preset.emptyState.media.positionX}% ${preset.emptyState.media.positionY}%`,
    transform: `scale(${preset.emptyState.media.crop ? preset.emptyState.media.zoom : 1})`
  };
  const showCustomIdleMedia = idle
    && !rememberedPlayback
    && preset.emptyState.media.enabled
    && !idleMediaFailed
    && preset.emptyState.media.kind;
  const spotifyAttribution = displayedItem && <a className="spotify-link" href={view.spotifyUrl} target="_blank" rel="noreferrer" aria-label={translateStatus("openSpotify")} title={translateStatus("openSpotify")}>
    <img className="spotify-logo logo-white" src={spotifyLogoWhite} alt="Spotify" />
    <img className="spotify-logo logo-black" src={spotifyLogoBlack} alt="Spotify" />
  </a>;

  return (
    <WidgetScaler layout={preset.layout} showCover={preset.cover.mode === "square"}>
      <main className={`widget theme-${preset.theme} layout-${preset.layout} ${preset.cover.mode === "square" ? "with-cover" : "without-cover"} ${paletteEnabled ? `cover-palette palette-transition-cascade palette-cycle-${paletteTransition.cycle % 2 ? "a" : "b"}` : ""} ${idle ? "is-idle" : ""} enter-${preset.animations.enter} exit-${preset.animations.exit} ${visible ? "is-visible" : "is-hidden"}`} style={style}>
      <div className="cover panel" aria-hidden={preset.cover.mode === "none"}>
        {preset.cover.mode === "square" && coverContentReady && (view.coverUrl
          ? <img src={view.coverUrl} alt="" onLoad={(event) => {
            if (preset.cover.glow || preset.coverPalette?.enabled) {
              applyCoverPalette(extractPaletteFromImage(event.currentTarget), Boolean(preset.coverPalette?.enabled));
            }
          }} />
          : showCustomIdleMedia === "video"
            ? <video className="idle-media" src={idleMediaUrl} style={mediaStyle} autoPlay loop muted playsInline onError={() => setIdleMediaFailed(true)} />
            : showCustomIdleMedia === "image"
              ? <img className="idle-media" src={idleMediaUrl} style={mediaStyle} alt="" onError={() => setIdleMediaFailed(true)} />
              : <span className="cover-placeholder"><MusicNoteIcon /></span>)}
      </div>
      <div className={`metadata panel ${preset.cover.glow && !paletteEnabled && view.coverUrl ? "cover-tint" : ""}`}>
        <div className="copy">
          <OverflowText text={view.title} kind="title" />
          <OverflowText text={view.artist} kind="artist" />
          <div className="attribution-row">
            {preset.layout !== "minimal" && spotifyAttribution}
          </div>
        </div>
      </div>
      <div className="progress-panel panel">
        <div className="time-row">
          <span>{formatTime(displayedProgress)}</span>
          {preset.visualizer.visible && <Visualizer playing={playback.isPlaying} />}
          <span>{formatTime(view.durationMs)}</span>
        </div>
        <div className="progress-track">
          <i style={{ transform: `scaleX(${percentage / 100})` }} />
          <span className="progress-thumb" style={{ left: `${percentage}%` }} />
        </div>
      </div>
      {preset.layout === "minimal" && spotifyAttribution && <div className="attribution-row minimal-attribution">{spotifyAttribution}</div>}
      </main>
    </WidgetScaler>
  );
}

function getWidgetStatus(
  status: PlaybackState["status"],
  t: (key: WidgetTranslationKey) => string
): { title: string; detail: string } | null {
  if (status === "checking") return { title: t("checkingTitle"), detail: t("checkingText") };
  if (status === "not_authorized") return { title: t("notAuthorizedTitle"), detail: t("notAuthorizedText") };
  if (status === "reauthorize") return { title: t("reauthorizeTitle"), detail: t("reauthorizeText") };
  if (status === "rate_limited") return { title: t("rateLimitedTitle"), detail: t("rateLimitedText") };
  if (status === "error") return { title: t("errorTitle"), detail: t("errorText") };
  return null;
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function extractPaletteFromImage(image: HTMLImageElement): CoverPalette {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return FALLBACK_COVER_PALETTE;
    context.drawImage(image, 0, 0, 24, 24);
    const pixels = context.getImageData(0, 0, 24, 24).data;
    return extractCoverPalette(pixels);
  } catch {
    return FALLBACK_COVER_PALETTE;
  }
}
