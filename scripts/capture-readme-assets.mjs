import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = process.cwd();
const outputDirectory = join(projectRoot, "docs", "images");
let baseUrl = process.env.MUSIC_WIDGET_CAPTURE_URL ?? "http://127.0.0.1:3847";
const edgePath = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const layouts = {
  boxy: { width: 740, height: 128 },
  compact: { width: 600, height: 240 },
  portrait: { width: 420, height: 640 },
  minimal: { width: 800, height: 100 }
};

const demoCover = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#17273a"/>
      <stop offset=".52" stop-color="#265d6f"/>
      <stop offset="1" stop-color="#d07853"/>
    </linearGradient>
    <radialGradient id="glow" cx=".7" cy=".22" r=".7">
      <stop stop-color="#f7c982" stop-opacity=".8"/>
      <stop offset="1" stop-color="#f7c982" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="800" height="800" rx="32" fill="url(#background)"/>
  <rect width="800" height="800" rx="32" fill="url(#glow)"/>
  <circle cx="400" cy="400" r="238" fill="#0d1722" fill-opacity=".55" stroke="#fff" stroke-opacity=".16" stroke-width="8"/>
  <circle cx="400" cy="400" r="72" fill="#f1bd78"/>
  <path d="M310 510V276l248-54v220" fill="none" stroke="#f6f2eb" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="264" cy="520" r="70" fill="#f6f2eb"/>
  <circle cx="512" cy="452" r="70" fill="#f6f2eb"/>
</svg>`);

const demoScript = `(() => {
  const layoutNames = new Set(["boxy", "compact", "portrait", "minimal"]);
  const captureParams = new URL(location.href).searchParams;
  const requestedLayout = captureParams.get("captureLayout");
  const startupDelay = captureParams.has("captureStartupDelay") ? 600 : 20;
  const layout = layoutNames.has(requestedLayout) ? requestedLayout : "boxy";
  const preset = {
    name: "Main",
    layout,
    theme: "dark",
    accentColor: "#e89b62",
    textStyle: { color: null, autoContrast: false, shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 } },
    progressStyle: { customTrackColor: false, trackColor: "#f5f5f5" },
    coverPalette: { enabled: false },
    fontFamily: "Poppins",
    fontSource: "local",
    cover: { mode: "square", glow: false },
    visibility: { hideOnPause: false, hideDelaySeconds: 0, songChangeOnly: false, visibleDurationSeconds: 8 },
    visualizer: { visible: true },
    animations: { enter: "fade", exit: "fade" },
    emptyState: {
      title: "Nothing Playing",
      artist: "Start the music",
      useLastPlayback: false,
      dim: { enabled: false, percent: 35 },
      media: { enabled: false, kind: null, crop: false, positionX: 50, positionY: 50, zoom: 1, revision: 0 }
    }
  };
  let config = {
    version: 1,
    language: "en",
    server: { port: 3847 },
    spotify: { clientId: "demo-client-id", authorizedAt: "2026-01-01T00:00:00.000Z" },
    activePreset: "main",
    presets: { main: preset }
  };
  let playback = {
    connected: true,
    status: "ready",
    error: null,
    retryAt: null,
    isPlaying: true,
    progressMs: 86400,
    observedAt: Date.now(),
    item: {
      id: "readme-demo-track",
      title: "Afterglow Avenue",
      artist: "The Midnight Signals",
      album: "Neon Horizons",
      durationMs: 218000,
      coverUrl: "https://i.scdn.co/image/readme-demo",
      spotifyUrl: "https://open.spotify.com"
    },
    lastPlayback: null
  };
  const sockets = new Set();
  const broadcast = (message) => {
    for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify(message) });
  };
  class DemoWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = DemoWebSocket.CONNECTING;
    constructor() {
      sockets.add(this);
      setTimeout(() => {
        this.readyState = DemoWebSocket.OPEN;
        this.onopen?.({ type: "open" });
        this.onmessage?.({ data: JSON.stringify({ type: "snapshot", config, playback }) });
      }, startupDelay);
    }
    close() {
      sockets.delete(this);
      this.readyState = DemoWebSocket.CLOSED;
    }
    send() {}
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.pathname === "/api/config") {
      if (startupDelay > 20) await new Promise((resolve) => setTimeout(resolve, startupDelay));
      if ((init.method ?? "GET").toUpperCase() === "PUT") {
        config = JSON.parse(init.body);
        broadcast({ type: "config", config });
      }
      return new Response(JSON.stringify(config), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/playback") {
      if (startupDelay > 20) await new Promise((resolve) => setTimeout(resolve, startupDelay));
      return new Response(JSON.stringify(playback), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/system/bootstrap") return new Response(JSON.stringify({ url: "file:///C:/OBS/obs-bootstrap.html" }), { status: 200, headers: { "content-type": "application/json" } });
    return nativeFetch(input, init);
  };
  window.WebSocket = DemoWebSocket;
  window.__readmeDemo = {
    updatePreset(patch) {
      config = { ...config, presets: { ...config.presets, main: { ...config.presets.main, ...patch } } };
      broadcast({ type: "config", config });
    },
    setCover(mode) {
      config = { ...config, presets: { ...config.presets, main: { ...config.presets.main, cover: { ...config.presets.main.cover, mode } } } };
      broadcast({ type: "config", config });
    },
    setPlaying(isPlaying) {
      playback = { ...playback, isPlaying, observedAt: Date.now() };
      broadcast({ type: "playback", playback });
    },
    reportProgress(progressMs) {
      playback = { ...playback, progressMs, observedAt: Date.now() };
      broadcast({ type: "playback", playback });
    },
    configureVisibility() {
      config = { ...config, presets: { ...config.presets, main: {
        ...config.presets.main,
        visualizer: { visible: false },
        visibility: { ...config.presets.main.visibility, hideOnPause: true, hideDelaySeconds: 0 },
        animations: { enter: "fade", exit: "fade" }
      } } };
      broadcast({ type: "config", config });
    }
  };
})();`;

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error("Could not connect to Edge DevTools."));
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params);
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function waitForJson(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function waitForPage(client, selector) {
  const expression = `new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (document.querySelector(${JSON.stringify(selector)}) && document.fonts.status === "loaded") resolve(true);
      else if (Date.now() - startedAt > 10000) reject(new Error("Page did not become ready"));
      else setTimeout(check, 50);
    };
    check();
  })`;
  await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function navigate(client, path, width, height, selector, previewBackdrop = false) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await client.send("Page.navigate", { url: `${baseUrl}${path}` });
  await waitForPage(client, selector);
  if (previewBackdrop) {
    await client.send("Runtime.evaluate", { expression: `
      document.documentElement.style.background = "#0c0d12";
      document.body.style.backgroundColor = "#0c0d12";
      document.body.style.backgroundImage = "linear-gradient(45deg,#15171d 25%,transparent 25%),linear-gradient(-45deg,#15171d 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#15171d 75%),linear-gradient(-45deg,transparent 75%,#15171d 75%)";
      document.body.style.backgroundSize = "24px 24px";
      document.body.style.backgroundPosition = "0 0,0 12px,12px -12px,-12px 0";
    ` });
  }
}

async function capture(client, outputPath) {
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function captureAnimation(client, frameDirectory, outputPath, timeline) {
  await mkdir(frameDirectory, { recursive: true });
  const frameCount = 48;
  const frameDuration = 1000 / 12;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const startedAt = performance.now();
    await timeline(client, frame);
    await capture(client, join(frameDirectory, `frame-${String(frame).padStart(3, "0")}.png`));
    const remaining = frameDuration - (performance.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  await run(ffmpegPath, [
    "-y", "-framerate", "12", "-i", join(frameDirectory, "frame-%03d.png"),
    "-vf", "fps=12,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    "-loop", "0", outputPath
  ]);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed with exit code ${code}:\n${errorOutput}`)));
  });
}

async function ensureCaptureServer(temporaryDirectory) {
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    if (health.ok) return null;
  } catch {}

  const configuredPort = Number(new URL(baseUrl).port);
  const port = Number.isInteger(configuredPort) && await portIsAvailable(configuredPort)
    ? configuredPort
    : await findFreePort();
  const dataDirectory = join(temporaryDirectory, "server-data");
  const config = {
    version: 1,
    language: "en",
    server: { port },
    spotify: { clientId: "", authorizedAt: null },
    activePreset: "main",
    presets: {
      main: {
        name: "Main",
        layout: "boxy",
        theme: "dark",
        accentColor: "#39bde0",
        textStyle: { color: null, autoContrast: false, shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 } },
        progressStyle: { customTrackColor: false, trackColor: "#f5f5f5" },
        coverPalette: { enabled: false },
        fontFamily: "Poppins",
        fontSource: "local",
        cover: { mode: "square", glow: false },
        visibility: { hideOnPause: false, hideDelaySeconds: 0, songChangeOnly: false, visibleDurationSeconds: 8 },
        visualizer: { visible: true },
        animations: { enter: "fade", exit: "fade" },
        emptyState: {
          title: "Nothing Playing",
          artist: "Start the music",
          useLastPlayback: false,
          dim: { enabled: false, percent: 35 },
          media: { enabled: false, kind: null, crop: false, positionX: 50, positionY: 50, zoom: 1, revision: 0 }
        }
      }
    }
  };
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(join(dataDirectory, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const server = spawn(process.execPath, [join(projectRoot, "build", "server", "server", "index.js"), "start"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MUSIC_WIDGET_TEST_DATA_DIRECTORY: dataDirectory
    },
    stdio: "ignore",
    windowsHide: true
  });
  baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForJson(`${baseUrl}/api/health`);
    return server;
  } catch (error) {
    server.kill();
    throw error;
  }
}

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "music-widget-readme-"));
  let captureServer;
  let edge;
  let client;
  try {
    captureServer = await ensureCaptureServer(temporaryDirectory);
    await mkdir(outputDirectory, { recursive: true });
    const debugPort = await findFreePort();
    edge = spawn(edgePath, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${join(temporaryDirectory, "edge-profile")}`,
      "about:blank"
    ], { stdio: "ignore", windowsHide: true });
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const pageTarget = targets.find((target) => target.type === "page");
    if (!pageTarget) throw new Error("Edge did not create a page target.");
    client = new DevToolsClient(pageTarget.webSocketDebuggerUrl);
    await client.open();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*api/cover/current*", requestStage: "Request" }] });
    client.on("Fetch.requestPaused", async ({ requestId, request }) => {
      void client.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "image/svg+xml" },
          { name: "Cache-Control", value: "no-store" }
        ],
        body: demoCover.toString("base64")
      });
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: demoScript });

    await client.send("Emulation.setDeviceMetricsOverride", { width: layouts.boxy.width, height: layouts.boxy.height, deviceScaleFactor: 1, mobile: false });
    await client.send("Page.navigate", { url: `${baseUrl}/widget?captureLayout=boxy&captureStartupDelay=1` });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const startupFrame = (await client.send("Runtime.evaluate", {
      expression: `({
        hasWidget: Boolean(document.querySelector(".widget")),
        hasStatus: Boolean(document.querySelector(".widget-status")),
        rootChildren: document.querySelector("#widget-root")?.childElementCount ?? -1
      })`,
      returnByValue: true
    })).result.value;
    if (startupFrame.hasWidget || startupFrame.hasStatus || startupFrame.rootChildren !== 0) {
      throw new Error("The widget did not keep its first connection-check frame transparent.");
    }
    await waitForPage(client, ".widget.is-visible");
    const startupAnimation = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.widget .metadata')).animationName",
      returnByValue: true
    })).result.value;
    if (startupAnimation !== "reveal-fade") {
      throw new Error("The widget did not use the selected entrance animation after startup.");
    }

    await navigate(client, "/dashboard", 1600, 1000, ".app-shell");
    const dashboardGeometry = (await client.send("Runtime.evaluate", {
      expression: `(() => ({
        pageFits: document.documentElement.scrollHeight <= innerHeight + 1,
        tabs: document.querySelectorAll('[role="tab"]').length,
        selectedTabs: document.querySelectorAll('[role="tab"][aria-selected="true"]').length,
        panels: document.querySelectorAll('[role="tabpanel"]').length,
        previewVisible: document.querySelector('.preview-panel').getBoundingClientRect().bottom <= innerHeight
      }))()`,
      returnByValue: true
    })).result.value;
    if (!dashboardGeometry.pageFits || dashboardGeometry.tabs !== 6 || dashboardGeometry.selectedTabs !== 1
      || dashboardGeometry.panels !== 1 || !dashboardGeometry.previewVisible) {
      throw new Error(`The tabbed dashboard workspace did not fit the desktop viewport: ${JSON.stringify(dashboardGeometry)}`);
    }
    await capture(client, join(outputDirectory, "dashboard.png"));
    await client.send("Runtime.evaluate", { expression: "document.querySelector('[data-dashboard-tab=motion]').click()" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const animationChoices = (await client.send("Runtime.evaluate", {
      expression: "[...document.querySelectorAll('.animation-grid')].map((grid) => grid.children.length)",
      returnByValue: true
    })).result.value;
    if (animationChoices.length !== 2 || animationChoices.some((count) => count !== 2)) {
      throw new Error(`The dashboard exposed animation choices other than None and Fade: ${JSON.stringify(animationChoices)}`);
    }
    await client.send("Runtime.evaluate", { expression: "document.querySelector('[data-dashboard-tab=colors]').click()" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await client.send("Runtime.evaluate", { expression: "document.querySelector('.chromagic-setting .toggle').click()" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.send("Runtime.evaluate", { expression: "document.querySelector('.settings-content').scrollTop = 360" });
    await capture(client, join(outputDirectory, "dashboard-colors.png"));
    const chromagicControlState = (await client.send("Runtime.evaluate", {
      expression: `(() => {
        const toggle = document.querySelector(".chromagic-setting .toggle");
        const thumb = toggle.querySelector("span");
        const toggleBounds = toggle.getBoundingClientRect();
        const thumbBounds = thumb.getBoundingClientRect();
        return {
          checked: toggle.getAttribute("aria-checked"),
          width: toggleBounds.width,
          thumbInside: thumbBounds.left >= toggleBounds.left && thumbBounds.right <= toggleBounds.right,
          manualColorsDisabled: document.querySelector(".palette-manual-fields").disabled
        };
      })()`,
      returnByValue: true
    })).result.value;
    if (chromagicControlState.checked !== "true" || chromagicControlState.width !== 44
      || !chromagicControlState.thumbInside || !chromagicControlState.manualColorsDisabled) {
      throw new Error(`The Chromagic dashboard control is malformed: ${JSON.stringify(chromagicControlState)}`);
    }
    const inheritedInsetState = (await client.send("Runtime.evaluate", {
      expression: `(() => ({
        enabled: document.querySelector('.widget-inset-setting .toggle')?.getAttribute('aria-checked'),
        custom: document.querySelector('.custom-inset-setting .toggle')?.getAttribute('aria-checked'),
        colorInputDisabled: document.querySelector('.widget-inset-controls input[type=color]')?.matches(':disabled'),
        ranges: document.querySelectorAll('.widget-inset-controls input[type=range]').length
      }))()`,
      returnByValue: true
    })).result.value;
    if (inheritedInsetState.enabled !== "true" || inheritedInsetState.custom !== "false"
      || inheritedInsetState.colorInputDisabled !== true || inheritedInsetState.ranges !== 2) {
      throw new Error(`The theme-derived inset controls are malformed: ${JSON.stringify(inheritedInsetState)}`);
    }
    await client.send("Runtime.evaluate", { expression: "document.querySelector('.custom-inset-setting .toggle').click()" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const customInsetColorEnabled = (await client.send("Runtime.evaluate", {
      expression: "document.querySelector('.widget-inset-controls input[type=color]')?.matches(':disabled') === false",
      returnByValue: true
    })).result.value;
    if (!customInsetColorEnabled) throw new Error("Enabling the custom inset color did not enable its retained color input.");
    await client.send("Runtime.evaluate", { expression: "document.querySelector('.custom-inset-setting .toggle').click()" });
    await client.send("Runtime.evaluate", { expression: "document.querySelector('.chromagic-setting .toggle').click()" });

    for (const [layout, dimensions] of Object.entries(layouts)) {
      await navigate(client, `/widget?captureLayout=${layout}`, dimensions.width, dimensions.height, ".widget.is-visible .cover img", true);
      await capture(client, join(outputDirectory, `layout-${layout}.png`));
      const layoutGeometry = (await client.send("Runtime.evaluate", {
        expression: `(() => {
          const rect = (selector) => {
            const bounds = document.querySelector(selector)?.getBoundingClientRect();
            return bounds ? { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height } : null;
          };
          const centerY = (selector) => {
            const bounds = document.querySelector(selector)?.getBoundingClientRect();
            return bounds ? (bounds.top + bounds.bottom) / 2 : null;
          };
          return {
            widget: rect(".widget"),
            cover: rect(".cover"),
            metadata: rect(".metadata"),
            copy: rect(".metadata .copy"),
            title: rect(".metadata .scroll-viewport.title"),
            spotify: rect(".metadata .spotify-logo"),
            progressPanel: rect(".progress-panel"),
            timeRow: rect(".time-row"),
            currentTime: rect(".time-row > span:first-child"),
            duration: rect(".time-row > span:last-child"),
            visualizer: rect(".visualizer"),
            progressTrack: rect(".progress-track"),
            minimalAttribution: rect(".minimal-attribution"),
            centers: {
              widget: centerY(".widget"), cover: centerY(".cover"), metadata: centerY(".metadata"),
              progressPanel: centerY(".progress-panel"), currentTime: centerY(".time-row > span:first-child"),
              visualizer: centerY(".visualizer"), duration: centerY(".time-row > span:last-child"),
              minimalAttribution: centerY(".minimal-attribution")
            },
            titleFontSize: getComputedStyle(document.querySelector(".scroll-viewport.title strong")).fontSize,
            timeFontSize: getComputedStyle(document.querySelector(".time-row")).fontSize,
            progressShadow: getComputedStyle(document.querySelector(".progress-track")).boxShadow,
            progressBorderWidth: getComputedStyle(document.querySelector(".progress-track")).borderTopWidth,
            progressBorderColor: getComputedStyle(document.querySelector(".progress-track")).borderTopColor,
            progressBackground: getComputedStyle(document.querySelector(".progress-track")).backgroundColor,
            progressPadding: getComputedStyle(document.querySelector(".progress-track")).padding,
            timeRowBorderColor: getComputedStyle(document.querySelector(".time-row")).borderTopColor,
            timeRowBackground: getComputedStyle(document.querySelector(".time-row")).backgroundColor
          };
        })()`,
        returnByValue: true
      })).result.value;
      const approximatelyEqual = (first, second, tolerance = 1) => Math.abs(first - second) <= tolerance;
      if (layout === "compact") {
        const metadataInsets = [layoutGeometry.copy.left - layoutGeometry.metadata.left, layoutGeometry.metadata.right - layoutGeometry.copy.right];
        const timeInsets = [layoutGeometry.currentTime.left - layoutGeometry.timeRow.left, layoutGeometry.timeRow.right - layoutGeometry.duration.right];
        const metadataVerticalInsets = [layoutGeometry.title.top - layoutGeometry.metadata.top, layoutGeometry.metadata.bottom - layoutGeometry.spotify.bottom];
        if (!metadataInsets.every((inset, index) => approximatelyEqual(inset, timeInsets[index], 1))
          || !approximatelyEqual(metadataVerticalInsets[0], metadataVerticalInsets[1], 1)
          || !approximatelyEqual(layoutGeometry.centers.currentTime, layoutGeometry.centers.visualizer, 1)
          || !approximatelyEqual(layoutGeometry.centers.visualizer, layoutGeometry.centers.duration, 1)
          || !approximatelyEqual(layoutGeometry.cover.top, layoutGeometry.metadata.top, 1)
          || !approximatelyEqual(layoutGeometry.cover.bottom, layoutGeometry.timeRow.bottom, 1)
          || layoutGeometry.progressBorderColor !== layoutGeometry.timeRowBorderColor
          || layoutGeometry.progressBackground !== layoutGeometry.timeRowBackground
          || layoutGeometry.progressPadding !== "0px"
          || !layoutGeometry.progressShadow.includes("4px 9px") || layoutGeometry.progressBorderWidth !== "1px") {
          throw new Error(`Compact spacing, vertical alignment, or progress shadow is inconsistent: ${JSON.stringify({ metadataInsets, timeInsets, metadataVerticalInsets, ...layoutGeometry })}`);
        }
      }
      if (layout === "boxy" && layoutGeometry.titleFontSize !== layoutGeometry.timeFontSize) {
        throw new Error(`Boxy title and time font sizes differ: ${JSON.stringify({ titleFontSize: layoutGeometry.titleFontSize, timeFontSize: layoutGeometry.timeFontSize })}`);
      }
      if (layout === "portrait") {
        const metadataInsets = [layoutGeometry.copy.left - layoutGeometry.metadata.left, layoutGeometry.metadata.right - layoutGeometry.copy.right];
        const progressInsets = [layoutGeometry.currentTime.left - layoutGeometry.progressPanel.left, layoutGeometry.progressPanel.right - layoutGeometry.duration.right];
        const trackInsets = [layoutGeometry.progressTrack.left - layoutGeometry.progressPanel.left, layoutGeometry.progressPanel.right - layoutGeometry.progressTrack.right];
        if (![...progressInsets, ...trackInsets].every((inset, index) => approximatelyEqual(inset, metadataInsets[index % 2], 1))) {
          throw new Error(`Portrait panel insets are inconsistent: ${JSON.stringify({ metadataInsets, progressInsets, trackInsets })}`);
        }
      }
      if (layout === "minimal") {
        const centered = [layoutGeometry.centers.cover, layoutGeometry.centers.metadata, layoutGeometry.centers.progressPanel, layoutGeometry.centers.minimalAttribution]
          .every((center) => center === null || approximatelyEqual(center, layoutGeometry.centers.widget, 1));
        if (!centered) throw new Error(`Minimal elements are not vertically centered: ${JSON.stringify(layoutGeometry.centers)}`);
      }
      await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.setCover('none')" });
      await new Promise((resolve) => setTimeout(resolve, 450));
      const noCoverBounds = (await client.send("Runtime.evaluate", {
        expression: `(() => {
          const widget = document.querySelector(".widget").getBoundingClientRect();
          return [...document.querySelectorAll(".metadata, .progress-panel")].every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= widget.left - 1 && bounds.right <= widget.right + 1 && bounds.top >= widget.top - 1 && bounds.bottom <= widget.bottom + 1;
          });
        })()`,
        returnByValue: true
      })).result.value;
      if (!noCoverBounds) throw new Error(`${layout} panels leave the widget bounds when the cover is hidden.`);
      await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.setCover('square')" });
      await new Promise((resolve) => setTimeout(resolve, 450));
    }

    await navigate(client, "/widget?captureLayout=boxy", layouts.boxy.width, layouts.boxy.height, ".widget.is-visible .cover img", true);
    const readTextPresentation = async () => (await client.send("Runtime.evaluate", {
      expression: `(() => {
        const title = getComputedStyle(document.querySelector(".scroll-viewport.title strong"));
        const titleViewport = getComputedStyle(document.querySelector(".scroll-viewport.title"));
        const artist = getComputedStyle(document.querySelector(".scroll-viewport.artist .artist"));
        return { color: title.color, artistColor: artist.color, shadow: title.textShadow, filter: titleViewport.filter };
      })()`,
      returnByValue: true
    })).result.value;
    const originalTextPresentation = await readTextPresentation();
    const derivedProgressTrackColor = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.progress-track')).backgroundColor",
      returnByValue: true
    })).result.value;
    if (derivedProgressTrackColor !== "rgb(92, 67, 50)") {
      throw new Error("The automatic progress-track color was not derived from the accent color.");
    }
    const squareVisualizerBars = (await client.send("Runtime.evaluate", {
      expression: "document.querySelectorAll('.layout-boxy .visualizer i').length",
      returnByValue: true
    })).result.value;
    const readCurrentTime = async () => (await client.send("Runtime.evaluate", {
      expression: "document.querySelector('.time-row > span:first-child').textContent",
      returnByValue: true
    })).result.value;
    const timeBeforeDrift = await readCurrentTime();
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.reportProgress(85500)" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const timeAfterDrift = await readCurrentTime();
    if (timeAfterDrift < timeBeforeDrift) {
      throw new Error("A small backward Spotify polling drift moved the displayed time backwards.");
    }
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.reportProgress(80000)" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await readCurrentTime() !== "01:20") {
      throw new Error("A deliberate backward seek was not reflected in the displayed time.");
    }
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.setCover('none')" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const boxyWithoutCoverGeometry = (await client.send("Runtime.evaluate", {
      expression: `(() => {
        const metadata = document.querySelector(".layout-boxy .metadata").getBoundingClientRect();
        const copy = document.querySelector(".layout-boxy .copy").getBoundingClientRect();
        const progress = document.querySelector(".layout-boxy .progress-panel").getBoundingClientRect();
        const currentTime = document.querySelector(".layout-boxy .time-row > span:first-child").getBoundingClientRect();
        const duration = document.querySelector(".layout-boxy .time-row > span:last-child").getBoundingClientRect();
        const track = document.querySelector(".layout-boxy .progress-track").getBoundingClientRect();
        const visualizer = document.querySelector(".layout-boxy .visualizer").getBoundingClientRect();
        const bars = [...document.querySelectorAll(".layout-boxy .visualizer i")].map((bar) => bar.getBoundingClientRect());
        return {
          metadataInsets: [copy.left - metadata.left, metadata.right - copy.right],
          timeInsets: [currentTime.left - progress.left, progress.right - duration.right],
          trackInsets: [track.left - progress.left, progress.right - track.right],
          titleOffset: copy.top - metadata.top,
          timeOffset: currentTime.top - progress.top,
          visualizerBars: bars.length,
          visualizerUnusedWidth: bars.length ? visualizer.width - (bars.at(-1).right - bars[0].left) : visualizer.width
        };
      })()`,
      returnByValue: true
    })).result.value;
    const alignedInsets = [...boxyWithoutCoverGeometry.timeInsets, ...boxyWithoutCoverGeometry.trackInsets]
      .every((inset, index) => Math.abs(inset - boxyWithoutCoverGeometry.metadataInsets[index % 2]) <= 1);
    if (!alignedInsets || Math.abs(boxyWithoutCoverGeometry.titleOffset - boxyWithoutCoverGeometry.timeOffset) > 1) {
      throw new Error(`The Boxy progress panel did not align with the metadata panel when the cover was hidden: ${JSON.stringify(boxyWithoutCoverGeometry)}`);
    }
    if (boxyWithoutCoverGeometry.visualizerBars <= squareVisualizerBars || boxyWithoutCoverGeometry.visualizerUnusedWidth > 8) {
      throw new Error("The Boxy visualizer did not fill the additional no-cover width with more bars.");
    }
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.setCover('square')" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.updatePreset({ cover: { mode: 'square', glow: true } })" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const tintedTextPresentation = await readTextPresentation();
    if (JSON.stringify(originalTextPresentation) !== JSON.stringify(tintedTextPresentation)) {
      throw new Error("Cover tint changed text presentation without automatic readability enabled.");
    }
    const opaqueTintBackground = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.metadata.cover-tint')).backgroundImage",
      returnByValue: true
    })).result.value;
    if (opaqueTintBackground.includes("transparent") || /\/\s*0(?:\.\d+)?(?:\s|\))/.test(opaqueTintBackground)) {
      throw new Error(`Cover tint remained transparent at full panel opacity: ${opaqueTintBackground}`);
    }
    await client.send("Runtime.evaluate", { expression: `window.__readmeDemo.updatePreset({
      widgetStyle: {
        surfaceOpacity: 50,
        outline: { enabled: true, color: "#123456", opacity: 50, width: 2 },
        inset: { enabled: true, customColor: true, color: "#abcdef", opacity: 40, width: 3 },
        shadow: { enabled: true, color: "#654321", opacity: 60, blur: 18 }
      }
    })` });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const customWidgetStyle = (await client.send("Runtime.evaluate", {
      expression: `(() => {
        const metadata = getComputedStyle(document.querySelector(".metadata"));
        return {
          surfaceOpacity: getComputedStyle(document.querySelector(".widget")).getPropertyValue("--surface-opacity").trim(),
          borderWidth: metadata.borderLeftWidth,
          borderColor: metadata.borderLeftColor,
          shadow: metadata.boxShadow,
          inset: getComputedStyle(document.querySelector(".widget")).getPropertyValue("--widget-inset-outline").trim(),
          coverOpacity: getComputedStyle(document.querySelector(".cover img")).opacity,
          logoOpacity: getComputedStyle(document.querySelector(".spotify-logo")).opacity
        };
      })()`,
      returnByValue: true
    })).result.value;
    if (customWidgetStyle.surfaceOpacity !== "50%" || customWidgetStyle.borderWidth !== "2px"
      || customWidgetStyle.borderColor !== "rgba(18, 52, 86, 0.5)" || customWidgetStyle.shadow === "none"
      || !customWidgetStyle.inset.includes("3px rgba(171, 205, 239, 0.4")
      || customWidgetStyle.coverOpacity !== "1" || customWidgetStyle.logoOpacity !== "1") {
      throw new Error(`Custom widget surfaces were not applied without dimming Spotify assets: ${JSON.stringify(customWidgetStyle)}`);
    }
    await client.send("Runtime.evaluate", { expression: `window.__readmeDemo.updatePreset({
      widgetStyle: {
        surfaceOpacity: 100,
        outline: { enabled: true, color: null, opacity: 100, width: 1 },
        inset: { enabled: true, customColor: false, color: "#000000", opacity: 100, width: 1 },
        shadow: { enabled: true, color: null, opacity: 100, blur: 9 }
      }
    })` });
    await client.send("Runtime.evaluate", { expression: `window.__readmeDemo.updatePreset({
      textStyle: { color: "#abcdef", autoContrast: false, shadow: { enabled: true, color: "#102030", opacity: 70, blur: 12 } }
    })` });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const manualPresentation = await readTextPresentation();
    if (manualPresentation.color !== "rgb(171, 205, 239)" || manualPresentation.filter === "none") {
      throw new Error("The custom text color or text shadow was not applied.");
    }
    await client.send("Runtime.evaluate", { expression: `window.__readmeDemo.updatePreset({
      textStyle: { color: null, autoContrast: true, shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 } },
      progressStyle: { customTrackColor: true, trackColor: "#123456" }
    })` });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const automaticPresentation = await readTextPresentation();
    const progressTrackColor = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.progress-track')).backgroundColor",
      returnByValue: true
    })).result.value;
    if (automaticPresentation.filter === "none" || automaticPresentation.artistColor === automaticPresentation.color || progressTrackColor !== "rgb(18, 52, 86)") {
      throw new Error("Automatic readability or the custom progress-track color was not applied.");
    }
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.updatePreset({ cover: { mode: 'square', glow: false }, coverPalette: { enabled: true } })" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const chromagicPresentation = (await client.send("Runtime.evaluate", {
      expression: `(() => {
        const widget = document.querySelector(".widget");
        const metadata = document.querySelector(".metadata");
        const widgetStyle = getComputedStyle(widget);
        const metadataStyle = getComputedStyle(metadata);
        return {
          active: widget.classList.contains("cover-palette"),
          tinted: metadata.classList.contains("cover-tint"),
          panel: widgetStyle.getPropertyValue("--panel").trim(),
          accent: widgetStyle.getPropertyValue("--accent").trim(),
          track: getComputedStyle(document.querySelector(".progress-track")).backgroundColor,
          text: getComputedStyle(document.querySelector(".scroll-viewport.title strong")).color,
          backgroundImage: metadataStyle.backgroundImage,
          washAnimation: getComputedStyle(metadata, "::after").animationName
        };
      })()`,
      returnByValue: true
    })).result.value;
    if (!chromagicPresentation.active || chromagicPresentation.tinted || chromagicPresentation.backgroundImage !== "none"
      || chromagicPresentation.panel === "#141519" || chromagicPresentation.accent === "#e89b62"
      || !chromagicPresentation.washAnimation.startsWith("palette-cascade")) {
      throw new Error(`Chromagic did not override the manual colors with a solid cover palette: ${JSON.stringify(chromagicPresentation)}`);
    }
    const paletteTransition = (await client.send("Runtime.evaluate", {
      expression: `(() => {
        const classes = [...document.querySelector(".widget").classList];
        return {
          transition: classes.find((name) => name.startsWith("palette-transition-")),
          cycle: classes.find((name) => name.startsWith("palette-cycle-")),
          metadataOpacity: getComputedStyle(document.querySelector(".metadata"), "::after").opacity,
          progressOpacity: getComputedStyle(document.querySelector(".progress-panel"), "::after").opacity
        };
      })()`,
      returnByValue: true
    })).result.value;
    if (paletteTransition.transition !== "palette-transition-cascade" || !paletteTransition.cycle) {
      throw new Error(`Chromagic did not use its fixed Panel Cascade: ${JSON.stringify(paletteTransition)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    const middlePaletteFrame = (await client.send("Runtime.evaluate", {
      expression: `(() => ({
        metadataOpacity: getComputedStyle(document.querySelector(".metadata"), "::after").opacity,
        progressOpacity: getComputedStyle(document.querySelector(".progress-panel"), "::after").opacity
      }))()`,
      returnByValue: true
    })).result.value;
    if (paletteTransition.metadataOpacity === middlePaletteFrame.metadataOpacity
      || Number(middlePaletteFrame.metadataOpacity) >= Number(middlePaletteFrame.progressOpacity)) {
      throw new Error(`Panel Cascade did not fade panels in sequence: ${JSON.stringify({ paletteTransition, middlePaletteFrame })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const settledChromagicTrack = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.progress-track')).backgroundColor",
      returnByValue: true
    })).result.value;
    if (settledChromagicTrack === "rgb(18, 52, 86)") {
      throw new Error("Chromagic did not replace the retained manual progress-track color.");
    }
    await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const reducedMotionWashDisplay = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.metadata'), '::after').display",
      returnByValue: true
    })).result.value;
    if (reducedMotionWashDisplay !== "none") throw new Error("Chromagic washes did not respect reduced-motion preferences.");
    await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await capture(client, join(outputDirectory, "layout-chromagic.png"));
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.updatePreset({ coverPalette: { enabled: false } })" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const restoredProgressTrackColor = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.progress-track')).backgroundColor",
      returnByValue: true
    })).result.value;
    if (restoredProgressTrackColor !== "rgb(18, 52, 86)") {
      throw new Error("Disabling Chromagic did not restore the retained manual progress-track color.");
    }
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.updatePreset({ theme: 'light' })" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const lightPanelBorder = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.panel')).borderColor",
      returnByValue: true
    })).result.value;
    if (lightPanelBorder !== "rgba(0, 0, 0, 0.15)" && lightPanelBorder !== "color(srgb 0 0 0 / 0.14902)") {
      throw new Error(`The light theme did not apply its dedicated panel border: ${lightPanelBorder}`);
    }

    await navigate(client, "/widget?captureLayout=minimal", layouts.minimal.width, layouts.minimal.height, ".widget.is-visible .cover img", true);
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.configureVisibility(); window.__readmeDemo.setPlaying(false)" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    const hiddenMinimalFrame = (await client.send("Runtime.evaluate", {
      expression: `(() => {
        const widget = document.querySelector(".layout-minimal");
        return {
          hidden: widget.classList.contains("is-hidden"),
          frameOpacity: getComputedStyle(widget, "::before").opacity,
          contentOpacity: getComputedStyle(widget.querySelector(".metadata")).opacity
        };
      })()`,
      returnByValue: true
    })).result.value;
    if (!hiddenMinimalFrame.hidden || hiddenMinimalFrame.frameOpacity !== "0" || hiddenMinimalFrame.contentOpacity !== "0") {
      throw new Error("The Minimal layout did not hide its frame together with its contents.");
    }

    await navigate(client, "/widget?captureLayout=compact", layouts.compact.width, layouts.compact.height, ".widget.is-visible .cover img", true);
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.setPlaying(true)" });
    await captureAnimation(client, join(temporaryDirectory, "cover-frames"), join(outputDirectory, "cover-reflow.gif"), async (activeClient, frame) => {
      if (frame === 10) await activeClient.send("Runtime.evaluate", { expression: "window.__readmeDemo.setCover('none')" });
      if (frame === 29) await activeClient.send("Runtime.evaluate", { expression: "window.__readmeDemo.setCover('square')" });
    });

    await navigate(client, "/widget?captureLayout=boxy", layouts.boxy.width, layouts.boxy.height, ".widget.is-visible .cover img", true);
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.configureVisibility()" });
    await captureAnimation(client, join(temporaryDirectory, "visibility-frames"), join(outputDirectory, "visibility-animation.gif"), async (activeClient, frame) => {
      if (frame === 10) await activeClient.send("Runtime.evaluate", { expression: "window.__readmeDemo.setPlaying(false)" });
      if (frame === 29) await activeClient.send("Runtime.evaluate", { expression: "window.__readmeDemo.setPlaying(true)" });
    });
  } finally {
    if (client) await client.send("Browser.close").catch(() => undefined);
    else edge?.kill();
    if (edge?.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => edge.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    }
    if (captureServer?.exitCode === null) {
      captureServer.kill();
      await Promise.race([
        new Promise((resolve) => captureServer.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    }
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
