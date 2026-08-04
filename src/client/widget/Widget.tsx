/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import type { AppConfig, PlaybackState, Preset, ServerMessage } from "../../shared/schema";
import { getAutomaticTextStyle, getDerivedProgressTrackColor, hexToRgba } from "../../shared/color-contrast";
import { getCompensatedSpotifyLogoWidth, getDesignDimensions, getLayoutScaleLimit } from "../../shared/layout-dimensions";
import { reconcilePlaybackProgress } from "../../shared/playback-progress";
import spotifyLogoBlack from "../assets/spotify-logo-black.svg";
import spotifyLogoWhite from "../assets/spotify-logo-white.svg";
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
  const [coverColor, setCoverColor] = useState("#30333b");
  const [coverContentReady, setCoverContentReady] = useState(true);
  const [idleMediaFailed, setIdleMediaFailed] = useState(false);
  const lastTrack = useRef<string | null>(null);
  const progressRef = useRef(0);
  const progressTrack = useRef<string | null>(null);
  const progressWasPlaying = useRef(false);
  const lastProgressTick = useRef(Date.now());
  const selectedPreset = presetName();

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
      setCoverColor("#30333b");
      return;
    }
    if (preset?.cover.mode !== "none" || !preset.cover.glow) return;
    const image = new Image();
    image.onload = () => setCoverColor(extractCoverColor(image));
    image.src = view.coverUrl;
    return () => { image.onload = null; };
  }, [view.coverUrl, preset?.cover.glow, preset?.cover.mode]);

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
  const customTrackColor = progressStyle.customTrackColor ?? Boolean(progressStyle.trackColor);
  const status = getWidgetStatus(playback.status, translateStatus);
  if (status && !playback.item) {
    return <StatusCard title={status.title} detail={status.detail} action={translateStatus("openDashboard")} animation={preset.animations.enter} />;
  }
  const percentage = view.durationMs ? Math.min(100, displayedProgress / view.durationMs * 100) : 0;
  const automaticTextStyle = getAutomaticTextStyle(preset.theme, coverColor, preset.cover.glow && Boolean(view.coverUrl));
  const textColor = textStyle.autoContrast ? automaticTextStyle.color : textStyle.color;
  const textShadow = textStyle.autoContrast
    ? automaticTextStyle.shadow
    : textStyle.shadow.enabled
      ? `0 1px ${textStyle.shadow.blur}px ${hexToRgba(textStyle.shadow.color, textStyle.shadow.opacity / 100)}`
      : "none";
  const textFilter = textStyle.autoContrast
    ? automaticTextStyle.filter
    : textStyle.shadow.enabled
      ? `drop-shadow(0 1px ${textStyle.shadow.blur}px ${hexToRgba(textStyle.shadow.color, textStyle.shadow.opacity / 100)})`
      : "none";
  const style: JSX.CSSProperties & Record<string, string | number | undefined> = {
    "--accent": preset.accentColor,
    "--font": preset.fontFamily,
    "--cover-color": coverColor,
    "--idle-opacity": String(preset.emptyState.dim.enabled ? 1 - preset.emptyState.dim.percent / 100 : 1),
    "--text-shadow": textShadow,
    "--text-filter": textFilter,
    ...(textColor ? {
      "--text": textColor,
      "--artist-text": textStyle.autoContrast
        ? automaticTextStyle.artistColor
        : `color-mix(in srgb, ${textColor} 82%, transparent)`
    } : {}),
    "--progress-track": customTrackColor
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
      <main className={`widget theme-${preset.theme} layout-${preset.layout} ${preset.cover.mode === "square" ? "with-cover" : "without-cover"} ${idle ? "is-idle" : ""} enter-${preset.animations.enter} exit-${preset.animations.exit} ${visible ? "is-visible" : "is-hidden"}`} style={style}>
      <div className="cover panel" aria-hidden={preset.cover.mode === "none"}>
        {preset.cover.mode === "square" && coverContentReady && (view.coverUrl
          ? <img src={view.coverUrl} alt="" onLoad={(event) => setCoverColor(extractCoverColor(event.currentTarget))} />
          : showCustomIdleMedia === "video"
            ? <video className="idle-media" src={idleMediaUrl} style={mediaStyle} autoPlay loop muted playsInline onError={() => setIdleMediaFailed(true)} />
            : showCustomIdleMedia === "image"
              ? <img className="idle-media" src={idleMediaUrl} style={mediaStyle} alt="" onError={() => setIdleMediaFailed(true)} />
              : <span className="cover-placeholder"><MusicNoteIcon /></span>)}
      </div>
      <div className={`metadata panel ${preset.cover.glow && view.coverUrl ? "cover-tint" : ""}`}>
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

function WidgetScaler({ layout, showCover, children }: { layout: Preset["layout"]; showCover: boolean; children: ComponentChildren }) {
  const safeAreaRef = useRef<HTMLDivElement>(null);
  const coverMode = showCover ? "square" : "none";
  const designSize = getDesignDimensions(layout, coverMode);
  const [frame, setFrame] = useState({ scale: 1, width: designSize.width });

  useLayoutEffect(() => {
    const safeArea = safeAreaRef.current;
    if (!safeArea) return;
    const updateScale = () => {
      if (layout === "minimal") {
        const scale = Math.max(.01, Math.min(
          getLayoutScaleLimit(layout, coverMode),
          safeArea.clientHeight / designSize.height
        ));
        setFrame({ scale, width: safeArea.clientWidth / scale });
        return;
      }
      setFrame({
        scale: Math.min(
          safeArea.clientWidth / designSize.width,
          safeArea.clientHeight / designSize.height
        ),
        width: designSize.width
      });
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(safeArea);
    updateScale();
    return () => observer.disconnect();
  }, [coverMode, designSize.height, designSize.width, layout]);

  const scalerStyle: JSX.CSSProperties & Record<"--spotify-logo-width", string> = {
    width: frame.width,
    height: designSize.height,
    transform: `scale(${frame.scale})`,
    "--spotify-logo-width": `${getCompensatedSpotifyLogoWidth(frame.scale)}px`
  };

  return <div className="widget-safe-area" ref={safeAreaRef}>
    <div className="widget-scale" style={scalerStyle}>
      {children}
    </div>
  </div>;
}

function StatusCard({ title, detail, action, animation }: { title: string; detail: string; action: string; animation: Preset["animations"]["enter"] }) {
  return <main className={`widget-status status-enter-${animation}`} role="status" aria-live="polite">
    <span className="status-symbol" aria-hidden="true">!</span>
    <div><strong>{title}</strong><p>{detail}</p><a href="/dashboard" target="_blank" rel="noreferrer">{action}</a></div>
  </main>;
}

function MusicNoteIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true"><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></svg>;
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

function Visualizer({ playing }: { playing: boolean }) {
  const visualizerRef = useRef<HTMLSpanElement>(null);
  const [barCount, setBarCount] = useState(10);

  useEffect(() => {
    const visualizer = visualizerRef.current;
    if (!visualizer) return;
    const updateBarCount = () => setBarCount(Math.max(5, Math.min(24, Math.floor(visualizer.clientWidth / 12))));
    const observer = new ResizeObserver(updateBarCount);
    observer.observe(visualizer);
    updateBarCount();
    return () => observer.disconnect();
  }, []);

  return <span ref={visualizerRef} className={`visualizer ${playing ? "playing" : ""}`}>
    {Array.from({ length: barCount }, (_, bar) => <i key={bar} style={{ "--bar-index": bar } as JSX.CSSProperties} />)}
  </span>;
}

function OverflowText({ text, kind }: { text: string; kind: "title" | "artist" }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const content = textRef.current;
      if (!viewport || !content) return;
      setDistance(Math.max(0, Math.ceil(content.scrollWidth - viewport.clientWidth)));
    };
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (textRef.current) observer.observe(textRef.current);
    void document.fonts.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [text]);

  useEffect(() => {
    const content = textRef.current;
    if (!content || distance <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scrollDuration = Math.max(3000, distance / 24 * 1000);
    const totalDuration = 10_000 + scrollDuration + 5_000 + scrollDuration;
    const animation = content.animate([
      { transform: "translateX(0)", offset: 0, easing: "linear" },
      { transform: "translateX(0)", offset: 10_000 / totalDuration, easing: "ease-in-out" },
      { transform: `translateX(-${distance}px)`, offset: (10_000 + scrollDuration) / totalDuration, easing: "linear" },
      { transform: `translateX(-${distance}px)`, offset: (15_000 + scrollDuration) / totalDuration, easing: "ease-in-out" },
      { transform: "translateX(0)", offset: 1 }
    ], { duration: totalDuration, iterations: Infinity });
    return () => animation.cancel();
  }, [distance, text]);

  const content = kind === "title"
    ? <strong ref={textRef}>{text}</strong>
    : <span ref={textRef} className="artist">{text}</span>;

  return <div ref={viewportRef} className={`scroll-viewport ${kind}`} title={text}>{content}</div>;
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function extractCoverColor(image: HTMLImageElement): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "#30333b";
    context.drawImage(image, 0, 0, 24, 24);
    const pixels = context.getImageData(0, 0, 24, 24).data;
    const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>();

    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      const lightness = (Math.max(red, green, blue) + Math.min(red, green, blue)) / 510;
      if (alpha < 180 || lightness < .08 || lightness > .92) continue;
      const key = `${red >> 5}-${green >> 5}-${blue >> 5}`;
      const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
      bucket.count += 1;
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      buckets.set(key, bucket);
    }

    const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
    if (!dominant) return "#30333b";
    return `rgb(${Math.round(dominant.red / dominant.count)} ${Math.round(dominant.green / dominant.count)} ${Math.round(dominant.blue / dominant.count)})`;
  } catch {
    return "#30333b";
  }
}
