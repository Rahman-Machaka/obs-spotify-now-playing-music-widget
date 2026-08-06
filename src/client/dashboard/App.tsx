import { useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, PlaybackStatus, Preset, ServerMessage } from "../../shared/schema";
import { getDerivedProgressTrackColor } from "../../shared/color-contrast";
import { MAIN_PRESET_ID, MAX_PRESET_COUNT } from "../../shared/profiles";
import { getRecommendedSourceDimensions } from "../../shared/layout-dimensions";
import { browserLanguage, translator, type TranslationKey } from "./i18n";
import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, MusicNoteIcon, PlusIcon, XIcon } from "./components/atoms/Icons";
import { Toggle } from "./components/atoms/Toggle";
import { AnimationChoice, Choice, ColorField, RangeField } from "./components/molecules/Fields";
import { CollapsibleSection, Section } from "./components/molecules/Section";
import { GoogleFontPicker } from "./components/organisms/GoogleFontPicker";
import { PreviewFrame } from "./components/organisms/PreviewFrame";

const colors = ["#39bde0", "#36c0bb", "#b9cc12", "#ffca38", "#ffa12e", "#ff631f", "#e4323b", "#ef6181", "#9d61dc"];
type DashboardTab = "setup" | "layout" | "idle" | "colors" | "motion" | "behavior";
const dashboardTabs: Array<{ id: DashboardTab; label: TranslationKey }> = [
  { id: "setup", label: "tabSetup" },
  { id: "layout", label: "tabLayout" },
  { id: "idle", label: "tabIdle" },
  { id: "colors", label: "tabColors" },
  { id: "motion", label: "tabMotion" },
  { id: "behavior", label: "tabBehavior" }
];
const fallbackTextStyle: Preset["textStyle"] = {
  color: null,
  autoContrast: false,
  shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 }
};
const fallbackWidgetStyle: Preset["widgetStyle"] = {
  surfaceOpacity: 100,
  outline: { enabled: true, color: null, opacity: 100, width: 1 },
  inset: { enabled: true, customColor: false, color: "#000000", opacity: 100, width: 1 },
  shadow: { enabled: true, color: null, opacity: 100, blur: 9 }
};
const animations: Array<{ value: Preset["animations"]["enter"]; label: TranslationKey }> = [
  { value: "none", label: "animationNone" },
  { value: "fade", label: "animationFade" }
];

function createProfileId(name: string, presets: AppConfig["presets"]): string {
  const base = name.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "profile";
  let candidate = base;
  let suffix = 2;
  while (presets[candidate]) candidate = `${base.slice(0, 28)}-${suffix++}`;
  return candidate;
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [spotifyStatus, setSpotifyStatus] = useState<PlaybackStatus>("checking");
  const [serverConnected, setServerConnected] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [bootstrapUrl, setBootstrapUrl] = useState("");
  const [spotifySetupOpen, setSpotifySetupOpen] = useState(false);
  const [idleMediaState, setIdleMediaState] = useState<"idle" | "uploading" | "error">("idle");
  const [selectedPresetId, setSelectedPresetId] = useState(MAIN_PRESET_ID);
  const [newProfileName, setNewProfileName] = useState("");
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [activeTab, setActiveTab] = useState<DashboardTab>("layout");
  const setupTabSelected = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const saveFeedbackTimer = useRef<number | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const idleMediaInput = useRef<HTMLInputElement>(null);
  const language = config?.language === "de" || config?.language === "en" ? config.language : browserLanguage();
  const t = useMemo(() => translator(language), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!config) return;
    const requiresSetup = !config.spotify.authorizedAt || spotifyStatus === "reauthorize";
    setSpotifySetupOpen(requiresSetup);
    if (requiresSetup && !setupTabSelected.current) {
      setupTabSelected.current = true;
      setActiveTab("setup");
    }
  }, [config?.spotify.authorizedAt, spotifyStatus]);

  useEffect(() => {
    if (config && !config.presets[selectedPresetId]) setSelectedPresetId(MAIN_PRESET_ID);
    setIdleMediaState("idle");
  }, [config, selectedPresetId]);

  useEffect(() => {
    void fetch("/api/config").then((response) => {
      if (!response.ok) throw new Error("Configuration request failed");
      return response.json();
    }).then(setConfig).catch(() => setLoadFailed(true));
    void fetch("/api/system/bootstrap").then((response) => response.json()).then((result: { url: string }) => setBootstrapUrl(result.url)).catch(() => undefined);
    let retry: number;
    let socket: WebSocket | undefined;
    let stopped = false;
    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socket.onopen = () => setServerConnected(true);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "snapshot") {
          setConfig(message.config);
          setSpotifyStatus(message.playback.status);
        } else if (message.type === "config") setConfig(message.config);
        else if (message.type === "playback") {
          setSpotifyStatus(message.playback.status);
        }
      };
      socket.onclose = () => {
        setServerConnected(false);
        if (!stopped) retry = window.setTimeout(connect, 2000);
      };
    };
    connect();
    return () => { stopped = true; window.clearTimeout(retry); socket?.close(); };
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
  }, []);

  const save = (next: AppConfig, immediate = false) => {
    setConfig(next);
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const persist = async () => {
      try {
        const response = await fetch("/api/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next)
        });
        if (!response.ok) throw new Error("save failed");
        setConfig(await response.json());
        setSaveState("saved");
        if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current);
        saveFeedbackTimer.current = window.setTimeout(() => setSaveState("idle"), 1200);
      } catch {
        setSaveState("error");
      }
    };
    if (immediate) void persist();
    else saveTimer.current = window.setTimeout(() => void persist(), 250);
  };

  const preset = config?.presets[selectedPresetId] ?? config?.presets[MAIN_PRESET_ID];
  useEffect(() => setProfileNameDraft(preset?.name ?? ""), [preset?.name, selectedPresetId]);
  const widgetUrl = useMemo(() => {
    if (!config) return "";
    const path = location.port === "5173" ? "/widget.html" : "/widget";
    return `${path}?preset=${encodeURIComponent(selectedPresetId)}`;
  }, [config, selectedPresetId]);
  const profileBootstrapUrl = bootstrapUrl
    ? `${bootstrapUrl}?preset=${encodeURIComponent(selectedPresetId)}`
    : "";

  if (!config || !preset) return <main className="loading" role={loadFailed ? "alert" : "status"}>
    <span>{t(loadFailed ? "loadError" : "loading")}</span>
    {loadFailed && <button type="button" className="secondary-button" onClick={() => location.reload()}>{t("reload")}</button>}
  </main>;
  const sourceSize = getRecommendedSourceDimensions(preset.layout, preset.cover.mode);
  const textStyle = preset.textStyle ?? fallbackTextStyle;
  const progressStyle = preset.progressStyle ?? { customTrackColor: false, trackColor: "#f5f5f5" };
  const widgetStyle = preset.widgetStyle ?? fallbackWidgetStyle;
  const customTrackColor = progressStyle.customTrackColor ?? Boolean(progressStyle.trackColor);
  const spotifyOnline = serverConnected && (spotifyStatus === "ready" || spotifyStatus === "idle");
  const spotifyWarning = spotifyStatus === "checking" || spotifyStatus === "rate_limited" || spotifyStatus === "reauthorize";
  const spotifyStatusText = t(
    !serverConnected ? "serverDisconnected"
      : spotifyStatus === "ready" ? "spotifyActive"
      : spotifyStatus === "idle" ? "spotifyIdle"
      : spotifyStatus === "checking" ? "spotifyChecking"
      : spotifyStatus === "rate_limited" ? "spotifyRateLimited"
      : spotifyStatus === "reauthorize" ? "spotifyReauthorize"
      : spotifyStatus === "error" ? "spotifyError"
      : "spotifyDisconnected"
  );

  const updatePreset = (patch: Partial<Preset>) => save({
    ...config,
    presets: { ...config.presets, [selectedPresetId]: { ...preset, ...patch } }
  });
  const updateEmptyState = (patch: Partial<Preset["emptyState"]>) => updatePreset({
    emptyState: { ...preset.emptyState, ...patch }
  });
  const updateTextStyle = (patch: Partial<Preset["textStyle"]>) => updatePreset({
    textStyle: { ...textStyle, ...patch }
  });
  const updateWidgetStyle = (patch: Partial<Preset["widgetStyle"]>) => updatePreset({
    widgetStyle: { ...widgetStyle, ...patch }
  });
  const commitProfileName = () => {
    const name = profileNameDraft.trim();
    if (!name) {
      setProfileNameDraft(preset.name);
      return;
    }
    if (name !== preset.name) updatePreset({ name });
  };
  const uploadIdleMedia = async (file: File) => {
    setIdleMediaState("uploading");
    try {
      const response = await fetch(`/api/empty-state-media/${encodeURIComponent(selectedPresetId)}`, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file
      });
      if (!response.ok) throw new Error("upload failed");
      const result = await response.json() as { kind: "image" | "video" };
      updateEmptyState({
        media: { ...preset.emptyState.media, enabled: true, kind: result.kind, revision: preset.emptyState.media.revision + 1 }
      });
      setIdleMediaState("idle");
    } catch {
      setIdleMediaState("error");
    } finally {
      if (idleMediaInput.current) idleMediaInput.current.value = "";
    }
  };
  const removeIdleMedia = async () => {
    setIdleMediaState("uploading");
    try {
      const response = await fetch(`/api/empty-state-media/${encodeURIComponent(selectedPresetId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete failed");
      updateEmptyState({
        media: { ...preset.emptyState.media, enabled: false, kind: null, revision: preset.emptyState.media.revision + 1 }
      });
      setIdleMediaState("idle");
    } catch {
      setIdleMediaState("error");
    }
  };
  const redirectUri = `http://127.0.0.1:${config.server.port}/api/auth/callback`;
  const profileIds = Object.keys(config.presets);
  const canCreateProfile = profileIds.length < MAX_PRESET_COUNT;

  const createProfile = () => {
    const name = newProfileName.trim();
    if (!name || !canCreateProfile) return;
    const profileId = createProfileId(name, config.presets);
    const nextPreset = structuredClone(preset);
    nextPreset.name = name.slice(0, 40);
    nextPreset.emptyState.media = { ...nextPreset.emptyState.media, enabled: false, kind: null, revision: 0 };
    save({ ...config, presets: { ...config.presets, [profileId]: nextPreset } }, true);
    setSelectedPresetId(profileId);
    setNewProfileName("");
  };

  const deleteSelectedProfile = () => {
    if (selectedPresetId === MAIN_PRESET_ID) return;
    if (!window.confirm(t("profileDeleteConfirm"))) return;
    const presets = { ...config.presets };
    delete presets[selectedPresetId];
    setSelectedPresetId(MAIN_PRESET_ID);
    save({ ...config, activePreset: MAIN_PRESET_ID, presets }, true);
  };

  const connectSpotify = async () => {
    if (!config.spotify.clientId.trim()) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    });
    if (!response.ok) {
      setSaveState("error");
      return;
    }
    window.open("/api/auth/login", "spotify-auth", "width=620,height=760");
  };

  const copyRedirectUri = async () => {
    await navigator.clipboard.writeText(redirectUri);
    setCopied(true);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const disconnectSpotify = async () => {
    await fetch("/api/auth/disconnect", { method: "POST" });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">OBS MUSIC WIDGET</span>
          <h1>{t("customization")}</h1>
        </div>
        <div className="topbar-controls">
          <label className="language-picker"><span>{t("language")}</span>
            <span className="select-control">
              <select aria-label={t("language")} value={config.language} onChange={(event) => save({ ...config, language: event.target.value as AppConfig["language"] }, true)}>
                <option value="auto">{t("languageAuto")}</option>
                <option value="de">{t("languageGerman")}</option>
                <option value="en">{t("languageEnglish")}</option>
              </select>
              <ChevronDownIcon />
            </span>
          </label>
          <div className="status-cluster" role="status" aria-live="polite">
            <span className={`save-state ${saveState}`}>{saveState === "saving" ? t("saveSaving") : saveState === "error" ? t("saveError") : saveState === "saved" ? t("saveSaved") : t("saveLive")}</span>
            <span aria-hidden="true" className={`status-dot ${spotifyOnline ? "online" : serverConnected && spotifyWarning ? "warning" : "error"}`} />
            <span>{spotifyStatusText}</span>
          </div>
        </div>
      </header>

      <div className="workspace">
        <div className="settings">
          <nav className="settings-tabs" role="tablist" aria-label={t("settingsNavigation")}>
            {dashboardTabs.map((tab, index) => <button
              id={`dashboard-tab-${tab.id}`}
              data-dashboard-tab={tab.id}
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="dashboard-tab-panel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleDashboardTabKeyDown(event, index, setActiveTab)}
            >{t(tab.label)}</button>)}
          </nav>
          <div className="settings-content">
            <div id="dashboard-tab-panel" className="settings-tab-panel" role="tabpanel" aria-labelledby={`dashboard-tab-${activeTab}`}>
          {activeTab === "setup" && <>
          <CollapsibleSection
            title={t("spotifySetup")}
            subtitle={spotifyStatus === "reauthorize" ? t("spotifyReauthorize") : config.spotify.authorizedAt ? t("spotifySetupComplete") : t("spotifySetupRequired")}
            complete={Boolean(config.spotify.authorizedAt) && spotifyStatus !== "reauthorize"}
            open={spotifySetupOpen}
            onToggle={() => setSpotifySetupOpen((open) => !open)}
            expandLabel={t("expandSection")}
            collapseLabel={t("collapseSection")}
          >
            <div className="setup-intro">
              <div className="setup-icon"><MusicNoteIcon /></div>
              <div><strong>{t("spotifyIntroTitle")}</strong><p>{t("spotifyIntroText")}</p></div>
            </div>

            <div className="setup-step">
              <span className="step-number">1</span>
              <div className="step-content">
                <strong>{t("spotifyStep1Title")}</strong>
                <p>{t("spotifyStep1Text")}</p>
                <a className="secondary-button" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">{t("spotifyDashboard")}<ExternalLinkIcon /></a>
              </div>
            </div>

            <div className="setup-step">
              <span className="step-number">2</span>
              <div className="step-content">
                <strong>{t("spotifyStep2Title")}</strong>
                <p>{t("spotifyStep2Text")}</p>
                <div className="copy-field"><code>{redirectUri}</code><button type="button" onClick={() => void copyRedirectUri()}>{copied ? t("copied") : t("copy")}</button></div>
                <label className="field-label client-label" htmlFor="client-id">{t("clientIdLabel")}</label>
                <input id="client-id" value={config.spotify.clientId} placeholder={t("clientIdPlaceholder")}
                  spellCheck={false} autoComplete="off"
                  onChange={(event) => save({ ...config, spotify: { ...config.spotify, clientId: event.target.value.trim() } })} />
                <p className="hint">{t("clientIdHint")}</p>
              </div>
            </div>

            <div className="setup-step last">
              <span className="step-number">3</span>
              <div className="step-content">
                <strong>{t("spotifyStep3Title")}</strong>
                <p>{t("spotifyStep3Text")}</p>
                <div className="connect-row">
                  <button type="button" className="primary connect-button" disabled={!config.spotify.clientId} onClick={() => void connectSpotify()}>
                    {config.spotify.authorizedAt ? t("spotifyReconnect") : t("spotifyConnect")}
                  </button>
                  {config.spotify.authorizedAt && <button type="button" className="text-button" onClick={() => void disconnectSpotify()}>{t("spotifyDisconnect")}</button>}
                </div>
                {config.spotify.authorizedAt && <div className="connected-note"><CheckIcon /> {t("spotifyAuthorized")} {new Date(config.spotify.authorizedAt).toLocaleDateString(language)}</div>}
              </div>
            </div>
          </CollapsibleSection>

          <Section title={t("profiles")}>
            <div className="profile-heading">
              <label className="profile-select" htmlFor="profile-select">
                <span className="field-label">{t("selectedProfile")}</span>
                <span className="select-control">
                  <select id="profile-select" value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}>
                    {profileIds.map((profileId) => <option key={profileId} value={profileId}>
                      {profileId === MAIN_PRESET_ID ? `${config.presets[profileId].name} (${t("profileDefault")})` : config.presets[profileId].name}
                    </option>)}
                  </select>
                  <ChevronDownIcon />
                </span>
              </label>
              <span className="profile-count">{profileIds.length} / {MAX_PRESET_COUNT}</span>
            </div>

            <label className="stacked-field" htmlFor="profile-name">
              <strong>{t("profileName")}</strong>
              <input id="profile-name" maxLength={40} value={profileNameDraft} disabled={selectedPresetId === MAIN_PRESET_ID}
                onChange={(event) => setProfileNameDraft(event.target.value)} onBlur={commitProfileName}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
              <small>{selectedPresetId === MAIN_PRESET_ID ? t("mainProfileHint") : t("profileNameHint")}</small>
            </label>

            <div className="profile-create-row">
              <input aria-label={t("newProfileName")} maxLength={40} value={newProfileName} placeholder={t("newProfileName")}
                disabled={!canCreateProfile} onChange={(event) => setNewProfileName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") createProfile(); }} />
              <button type="button" className="secondary-button" disabled={!canCreateProfile || !newProfileName.trim()} onClick={createProfile}>{t("profileCreate")}</button>
            </div>
            <p className="profile-hint">{canCreateProfile ? t("profileCreateHint") : t("profileLimitReached")}</p>

            {selectedPresetId !== MAIN_PRESET_ID && <button type="button" className="danger-button" onClick={deleteSelectedProfile}>{t("profileDelete")}</button>}
          </Section>
          </>}

          {activeTab === "layout" &&
          <Section title={t("appearance")}>
            <span className="field-label">{t("playerAppearance")}</span>
            <div className="choice-grid layouts">
              {(["compact", "boxy", "portrait", "minimal"] as const).map((layout) => (
                <Choice key={layout} active={preset.layout === layout} label={t(layout === "compact" ? "layoutCompact" : layout === "boxy" ? "layoutBoxy" : layout === "portrait" ? "layoutPortrait" : "layoutMinimal")} onClick={() => updatePreset({ layout })}>
                  <div className={`layout-icon ${layout}`}><i /><i /><i /></div>
                </Choice>
              ))}
            </div>
            <span className="field-label">{t("coverAppearance")}</span>
            <div className="choice-grid cover-grid">
              {(["square", "none"] as const).map((mode) => (
                <Choice key={mode} active={preset.cover.mode === mode} label={t(mode === "square" ? "coverSquare" : "coverNone")} onClick={() => updatePreset({ cover: { ...preset.cover, mode } })}>
                  <div className={`cover-mode-icon ${mode}`}>{mode === "none" && <XIcon />}</div>
                </Choice>
              ))}
            </div>
            <div className="row-setting">
              <div><strong>{t("coverGlow")}</strong><small>{t("coverGlowHint")}</small></div>
              <Toggle label={t("coverGlow")} checked={preset.cover.glow} disabled={preset.coverPalette.enabled} onChange={(glow) => updatePreset({ cover: { ...preset.cover, glow } })} />
            </div>
          </Section>}

          {activeTab === "idle" &&
          <Section title={t("nothingPlaying")}>
            <div className="row-setting">
              <div><strong>{t("rememberLastPlayback")}</strong><small>{t("rememberLastPlaybackHint")}</small></div>
              <Toggle label={t("rememberLastPlayback")} checked={preset.emptyState.useLastPlayback} onChange={(useLastPlayback) => updateEmptyState({ useLastPlayback })} />
            </div>

            <fieldset className="idle-state-fields" disabled={preset.emptyState.useLastPlayback}>
              <label className="stacked-field" htmlFor="idle-title">
                <strong>{t("nothingPlayingTitle")}</strong>
                <input id="idle-title" maxLength={80} value={preset.emptyState.title} onChange={(event) => updateEmptyState({ title: event.target.value })} />
                <small>{t("nothingPlayingTitleHint")}</small>
              </label>
              <label className="stacked-field" htmlFor="idle-artist">
                <strong>{t("nothingPlayingArtist")}</strong>
                <input id="idle-artist" maxLength={80} value={preset.emptyState.artist} onChange={(event) => updateEmptyState({ artist: event.target.value })} />
                <small>{t("nothingPlayingArtistHint")}</small>
              </label>

              <div className="idle-media-card">
                <div className="idle-media-heading">
                  <div><strong>{t("nothingPlayingMedia")}</strong><small>{t("nothingPlayingMediaHint")}</small></div>
                  <div className="idle-media-actions">
                    <input ref={idleMediaInput} className="visually-hidden" type="file" accept=".gif,.webp,.webm,.png,.jpg,.jpeg,image/gif,image/webp,video/webm,image/png,image/jpeg"
                      onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadIdleMedia(file); }} />
                    <button type="button" className="secondary-button" disabled={idleMediaState === "uploading"} onClick={() => idleMediaInput.current?.click()}>
                      {idleMediaState === "uploading" ? t("mediaUploading") : preset.emptyState.media.kind ? t("mediaReplace") : t("mediaUpload")}
                    </button>
                    {preset.emptyState.media.kind && <button type="button" className="text-button" disabled={idleMediaState === "uploading"} onClick={() => void removeIdleMedia()}>{t("mediaRemove")}</button>}
                  </div>
                </div>
                {idleMediaState === "error" && <p className="field-error" role="alert">{t("mediaUploadError")}</p>}
                {preset.cover.mode === "none" && <p className="field-note">{t("mediaRequiresCover")}</p>}

                {preset.emptyState.media.kind && <>
                  <div className="idle-media-preview">
                    {preset.emptyState.media.kind === "video"
                      ? <video key={preset.emptyState.media.revision} src={`/api/empty-state-media/${encodeURIComponent(selectedPresetId)}?v=${preset.emptyState.media.revision}`} style={idleMediaPreviewStyle(preset)} autoPlay loop muted playsInline />
                      : <img key={preset.emptyState.media.revision} src={`/api/empty-state-media/${encodeURIComponent(selectedPresetId)}?v=${preset.emptyState.media.revision}`} style={idleMediaPreviewStyle(preset)} alt="" />}
                  </div>
                  <div className="row-setting compact-row">
                    <div><strong>{t("showIdleMedia")}</strong><small>{t("showIdleMediaHint")}</small></div>
                    <Toggle label={t("showIdleMedia")} checked={preset.emptyState.media.enabled} onChange={(enabled) => updateEmptyState({ media: { ...preset.emptyState.media, enabled } })} />
                  </div>
                  <div className="row-setting compact-row">
                    <div><strong>{t("cropMedia")}</strong><small>{t("cropMediaHint")}</small></div>
                    <Toggle label={t("cropMedia")} checked={preset.emptyState.media.crop} onChange={(crop) => updateEmptyState({ media: { ...preset.emptyState.media, crop } })} />
                  </div>
                  <div className={`crop-controls ${preset.emptyState.media.crop ? "" : "disabled"}`}>
                    <RangeField label={t("cropHorizontal")} value={preset.emptyState.media.positionX} min={0} max={100} suffix="%" disabled={!preset.emptyState.media.crop}
                      onChange={(positionX) => updateEmptyState({ media: { ...preset.emptyState.media, positionX } })} />
                    <RangeField label={t("cropVertical")} value={preset.emptyState.media.positionY} min={0} max={100} suffix="%" disabled={!preset.emptyState.media.crop}
                      onChange={(positionY) => updateEmptyState({ media: { ...preset.emptyState.media, positionY } })} />
                    <RangeField label={t("cropZoom")} value={preset.emptyState.media.zoom} min={1} max={3} step={.05} suffix="x" disabled={!preset.emptyState.media.crop}
                      onChange={(zoom) => updateEmptyState({ media: { ...preset.emptyState.media, zoom } })} />
                  </div>
                </>}
              </div>
            </fieldset>

            <div className="row-setting idle-dim-setting">
              <div><strong>{t("dimWhenIdle")}</strong><small>{t("dimWhenIdleHint")}</small></div>
              <Toggle label={t("dimWhenIdle")} checked={preset.emptyState.dim.enabled} onChange={(enabled) => updateEmptyState({ dim: { ...preset.emptyState.dim, enabled } })} />
            </div>
            {preset.emptyState.dim.enabled && <RangeField label={t("dimAmount")} value={preset.emptyState.dim.percent} min={0} max={90} suffix="%"
              onChange={(percent) => updateEmptyState({ dim: { ...preset.emptyState.dim, percent } })} />}
          </Section>}

          {activeTab === "colors" &&
          <Section title={t("colors")}>
            <div className="row-setting chromagic-setting">
              <div><strong>{t("chromagic")}</strong><small>{t("chromagicHint")}</small></div>
              <Toggle label={t("chromagic")} checked={preset.coverPalette.enabled}
                onChange={(enabled) => updatePreset({ coverPalette: { enabled } })} />
            </div>
            <fieldset className="palette-manual-fields" disabled={preset.coverPalette.enabled}>
              <span className="field-label">{t("theme")}</span>
              <div className="choice-grid theme-grid">
                {(["dark", "light"] as const).map((theme) => (
                  <Choice key={theme} active={preset.theme === theme} label={t(theme === "dark" ? "darkMode" : "lightMode")} onClick={() => updatePreset({ theme })}>
                    <div className={`theme-icon ${theme}`}><b><MusicNoteIcon /></b><span /><span /></div>
                  </Choice>
                ))}
              </div>
              <span className="field-label">{t("tintColor")}</span>
              <div className="color-row">
                {colors.map((color) => <button type="button" key={color} aria-label={color} aria-pressed={preset.accentColor === color} className={preset.accentColor === color ? "selected" : ""} style={{ background: color }} onClick={() => updatePreset({ accentColor: color })} />)}
                <label className="custom-color" aria-label={t("tintColor")}><PlusIcon /><input aria-label={t("tintColor")} type="color" value={preset.accentColor} onChange={(event) => updatePreset({ accentColor: event.target.value })} /></label>
              </div>
            </fieldset>

            <div className="style-card">
              <div className="widget-surface-controls">
                <RangeField label={t("widgetSurfaceOpacity")} value={widgetStyle.surfaceOpacity} min={0} max={100} suffix="%"
                  onChange={(surfaceOpacity) => updateWidgetStyle({ surfaceOpacity })} />
                <small>{t("widgetSurfaceOpacityHint")}</small>
              </div>

              <div className="row-setting compact-row">
                <div><strong>{t("widgetOutline")}</strong><small>{t("widgetOutlineHint")}</small></div>
                <Toggle label={t("widgetOutline")} checked={widgetStyle.outline.enabled}
                  onChange={(enabled) => updateWidgetStyle({ outline: { ...widgetStyle.outline, enabled } })} />
              </div>
              {widgetStyle.outline.enabled && <div className="widget-style-controls">
                <ColorField label={t("outlineColor")}
                  value={widgetStyle.outline.color ?? (preset.theme === "dark" ? "#ffffff" : "#000000")}
                  resetLabel={widgetStyle.outline.color ? t("useThemeColor") : undefined}
                  onReset={widgetStyle.outline.color ? () => updateWidgetStyle({ outline: { ...widgetStyle.outline, color: null } }) : undefined}
                  onChange={(color) => updateWidgetStyle({ outline: { ...widgetStyle.outline, color } })} />
                <RangeField label={t("outlineOpacity")} value={widgetStyle.outline.opacity} min={0} max={100} suffix="%"
                  onChange={(opacity) => updateWidgetStyle({ outline: { ...widgetStyle.outline, opacity } })} />
                <RangeField label={t("outlineWidth")} value={widgetStyle.outline.width} min={1} max={4} suffix=" px"
                  onChange={(width) => updateWidgetStyle({ outline: { ...widgetStyle.outline, width } })} />
              </div>}

              <div className="row-setting compact-row widget-inset-setting">
                <div><strong>{t("widgetInset")}</strong><small>{t("widgetInsetHint")}</small></div>
                <Toggle label={t("widgetInset")} checked={widgetStyle.inset.enabled}
                  onChange={(enabled) => updateWidgetStyle({ inset: { ...widgetStyle.inset, enabled } })} />
              </div>
              {widgetStyle.inset.enabled && <div className="widget-style-controls widget-inset-controls">
                <div className="row-setting compact-row custom-inset-setting">
                  <div><strong>{t("customInsetColor")}</strong><small>{t("customInsetColorHint")}</small></div>
                  <Toggle label={t("customInsetColor")} checked={widgetStyle.inset.customColor}
                    onChange={(customColor) => updateWidgetStyle({ inset: { ...widgetStyle.inset, customColor } })} />
                </div>
                <fieldset className="text-style-fields widget-inset-color-fields" disabled={!widgetStyle.inset.customColor}>
                  <ColorField label={t("insetColor")}
                    value={widgetStyle.inset.color}
                    onChange={(color) => updateWidgetStyle({ inset: { ...widgetStyle.inset, color } })} />
                </fieldset>
                <RangeField label={t("insetOpacity")} value={widgetStyle.inset.opacity} min={0} max={100} suffix="%"
                  onChange={(opacity) => updateWidgetStyle({ inset: { ...widgetStyle.inset, opacity } })} />
                <RangeField label={t("insetWidth")} value={widgetStyle.inset.width} min={1} max={4} suffix=" px"
                  onChange={(width) => updateWidgetStyle({ inset: { ...widgetStyle.inset, width } })} />
              </div>}

              <div className="row-setting compact-row">
                <div><strong>{t("widgetShadow")}</strong><small>{t("widgetShadowHint")}</small></div>
                <Toggle label={t("widgetShadow")} checked={widgetStyle.shadow.enabled}
                  onChange={(enabled) => updateWidgetStyle({ shadow: { ...widgetStyle.shadow, enabled } })} />
              </div>
              {widgetStyle.shadow.enabled && <div className="widget-style-controls">
                <ColorField label={t("shadowColor")}
                  value={widgetStyle.shadow.color ?? "#000000"}
                  resetLabel={widgetStyle.shadow.color ? t("useThemeColor") : undefined}
                  onReset={widgetStyle.shadow.color ? () => updateWidgetStyle({ shadow: { ...widgetStyle.shadow, color: null } }) : undefined}
                  onChange={(color) => updateWidgetStyle({ shadow: { ...widgetStyle.shadow, color } })} />
                <RangeField label={t("shadowOpacity")} value={widgetStyle.shadow.opacity} min={0} max={100} suffix="%"
                  onChange={(opacity) => updateWidgetStyle({ shadow: { ...widgetStyle.shadow, opacity } })} />
                <RangeField label={t("shadowBlur")} value={widgetStyle.shadow.blur} min={0} max={30} suffix=" px"
                  onChange={(blur) => updateWidgetStyle({ shadow: { ...widgetStyle.shadow, blur } })} />
              </div>}

              <fieldset className="palette-manual-fields palette-style-fields" disabled={preset.coverPalette.enabled}>
                <div className="row-setting compact-row">
                  <div><strong>{t("automaticReadability")}</strong><small>{t("automaticReadabilityHint")}</small></div>
                  <Toggle label={t("automaticReadability")} checked={textStyle.autoContrast} onChange={(autoContrast) => updateTextStyle({ autoContrast })} />
                </div>

                <fieldset className="text-style-fields" disabled={textStyle.autoContrast}>
                  <ColorField label={t("textColor")} hint={t("textColorHint")}
                    value={textStyle.color ?? (preset.theme === "dark" ? "#f6f6f7" : "#14151a")}
                    resetLabel={textStyle.color ? t("useThemeColor") : undefined}
                    onReset={textStyle.color ? () => updateTextStyle({ color: null }) : undefined}
                    onChange={(color) => updateTextStyle({ color })} />

                  <div className="row-setting compact-row">
                    <div><strong>{t("textShadow")}</strong><small>{t("textShadowHint")}</small></div>
                    <Toggle label={t("textShadow")} checked={textStyle.shadow.enabled}
                      onChange={(enabled) => updateTextStyle({ shadow: { ...textStyle.shadow, enabled } })} />
                  </div>

                  {textStyle.shadow.enabled && <div className="shadow-controls">
                    <ColorField label={t("shadowColor")} value={textStyle.shadow.color}
                      onChange={(color) => updateTextStyle({ shadow: { ...textStyle.shadow, color } })} />
                    <RangeField label={t("shadowOpacity")} value={textStyle.shadow.opacity} min={0} max={100} suffix="%"
                      onChange={(opacity) => updateTextStyle({ shadow: { ...textStyle.shadow, opacity } })} />
                    <RangeField label={t("shadowBlur")} value={textStyle.shadow.blur} min={0} max={12} suffix=" px"
                      onChange={(blur) => updateTextStyle({ shadow: { ...textStyle.shadow, blur } })} />
                  </div>}
                </fieldset>

                <div className="row-setting compact-row">
                  <div><strong>{t("customProgressTrackColor")}</strong><small>{t("customProgressTrackColorHint")}</small></div>
                  <Toggle label={t("customProgressTrackColor")} checked={customTrackColor}
                    onChange={(customProgressTrackColor) => updatePreset({ progressStyle: { ...progressStyle, customTrackColor: customProgressTrackColor } })} />
                </div>
                <fieldset className="text-style-fields progress-color-fields" disabled={!customTrackColor}>
                  <ColorField label={t("progressTrackColor")} hint={t("progressTrackColorHint")}
                    value={customTrackColor ? progressStyle.trackColor : getDerivedProgressTrackColor(preset.accentColor, preset.theme)}
                    onChange={(trackColor) => updatePreset({ progressStyle: { customTrackColor: true, trackColor } })} />
                </fieldset>
              </fieldset>
            </div>
          </Section>}

          {activeTab === "motion" &&
          <Section title={t("animations")}>
            <span className="field-label">{t("revealAnimation")}</span>
            <div className="animation-grid">
              {animations.map((animation) => <AnimationChoice key={animation.value} active={preset.animations.enter === animation.value} label={t(animation.label)} onClick={() => updatePreset({ animations: { ...preset.animations, enter: animation.value } })} />)}
            </div>
            <span className="field-label spaced">{t("exitAnimation")}</span>
            <div className="animation-grid">
              {animations.map((animation) => <AnimationChoice key={animation.value} active={preset.animations.exit === animation.value} label={t(animation.label)} onClick={() => updatePreset({ animations: { ...preset.animations, exit: animation.value } })} />)}
            </div>
            <GoogleFontPicker preset={preset} t={t} onChange={(fontFamily, fontSource) => updatePreset({ fontFamily, fontSource })} />
          </Section>}

          {activeTab === "behavior" &&
          <Section title={t("visibility")}>
            <div className="row-setting">
              <div><strong>{t("hideOnPause")}</strong><small>{t("hideOnPauseHint")}</small></div>
              <Toggle label={t("hideOnPause")} checked={preset.visibility.hideOnPause} onChange={(hideOnPause) => updatePreset({ visibility: { ...preset.visibility, hideOnPause } })} />
            </div>
            <div className="row-setting">
              <div><strong>{t("songChangeOnly")}</strong><small>{t("songChangeOnlyHint")}</small></div>
              <Toggle label={t("songChangeOnly")} checked={preset.visibility.songChangeOnly} onChange={(songChangeOnly) => updatePreset({ visibility: { ...preset.visibility, songChangeOnly } })} />
            </div>
            <div className="row-setting">
              <div><strong>{t("visualizer")}</strong><small>{t("visualizerHint")}</small></div>
              <Toggle label={t("visualizer")} checked={preset.visualizer.visible} onChange={(visible) => updatePreset({ visualizer: { visible } })} />
            </div>
          </Section>}
            </div>
          </div>
        </div>

        <aside className="preview-panel">
          <div className="preview-header">
            <span>{t("livePreview")} <b>{sourceSize.width} × {sourceSize.height}</b></span>
            <a href={widgetUrl} target="_blank" rel="noreferrer">{t("openSeparately")}<ExternalLinkIcon /></a>
          </div>
          <PreviewFrame src={widgetUrl} width={sourceSize.width} height={sourceSize.height} title={t("previewTitle")} />
          <div className="source-url">
            <span>{t("obsBrowserSource")}</span>
            <code>{new URL(widgetUrl, location.origin).toString()}</code>
            <span className="alternative-source-label">{t("alternativeBrowserSource")}</span>
            <code>{profileBootstrapUrl || t("bootstrapUrlUnavailable")}</code>
            <p className="source-hint bootstrap-hint">{t("bootstrapSourceHint")}</p>
            <div className="source-settings">
              <div><small>{t("width")}</small><strong>{sourceSize.width} px</strong></div>
              <div><small>{t("height")}</small><strong>{sourceSize.height} px</strong></div>
              <div><small>FPS</small><strong>30</strong></div>
            </div>
            <p className="source-hint">{t("sourceHint")}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function handleDashboardTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number, selectTab: (tab: DashboardTab) => void) {
  let nextIndex = index;
  if (event.key === "ArrowRight") nextIndex = (index + 1) % dashboardTabs.length;
  else if (event.key === "ArrowLeft") nextIndex = (index - 1 + dashboardTabs.length) % dashboardTabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = dashboardTabs.length - 1;
  else return;
  event.preventDefault();
  const nextTab = dashboardTabs[nextIndex];
  selectTab(nextTab.id);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[nextIndex]?.focus();
}

function idleMediaPreviewStyle(preset: Preset): React.CSSProperties {
  return {
    objectFit: preset.emptyState.media.crop ? "cover" : "contain",
    objectPosition: `${preset.emptyState.media.positionX}% ${preset.emptyState.media.positionY}%`,
    transform: `scale(${preset.emptyState.media.crop ? preset.emptyState.media.zoom : 1})`
  };
}
