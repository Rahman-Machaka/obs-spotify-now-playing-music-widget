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
  compact: { width: 600, height: 200 },
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
  const requestedLayout = new URL(location.href).searchParams.get("captureLayout");
  const layout = layoutNames.has(requestedLayout) ? requestedLayout : "boxy";
  const preset = {
    name: "Main",
    layout,
    theme: "dark",
    accentColor: "#e89b62",
    textStyle: { color: null, autoContrast: false, shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 } },
    progressStyle: { customTrackColor: false, trackColor: "#f5f5f5" },
    fontFamily: "Poppins",
    fontSource: "local",
    cover: { mode: "square", glow: false },
    visibility: { hideOnPause: false, hideDelaySeconds: 0, songChangeOnly: false, visibleDurationSeconds: 8 },
    visualizer: { visible: true },
    animations: { enter: "slide-left", exit: "fade" },
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
      }, 20);
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
      if ((init.method ?? "GET").toUpperCase() === "PUT") {
        config = JSON.parse(init.body);
        broadcast({ type: "config", config });
      }
      return new Response(JSON.stringify(config), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/playback") return new Response(JSON.stringify(playback), { status: 200, headers: { "content-type": "application/json" } });
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
    configureVisibility() {
      config = { ...config, presets: { ...config.presets, main: {
        ...config.presets.main,
        visualizer: { visible: false },
        visibility: { ...config.presets.main.visibility, hideOnPause: true, hideDelaySeconds: 0 },
        animations: { enter: "slide-left", exit: "fade" }
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
        fontFamily: "Poppins",
        fontSource: "local",
        cover: { mode: "square", glow: false },
        visibility: { hideOnPause: false, hideDelaySeconds: 0, songChangeOnly: false, visibleDurationSeconds: 8 },
        visualizer: { visible: true },
        animations: { enter: "slide-left", exit: "fade" },
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
    client.on("Fetch.requestPaused", ({ requestId }) => {
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

    await navigate(client, "/dashboard", 1600, 1000, ".app-shell");
    await capture(client, join(outputDirectory, "dashboard.png"));
    await client.send("Runtime.evaluate", { expression: `
      [...document.querySelectorAll("section h2")]
        .find((heading) => heading.textContent?.trim() === "Colors")
        ?.closest("section")
        ?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -20);
    ` });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await capture(client, join(outputDirectory, "dashboard-colors.png"));

    for (const [layout, dimensions] of Object.entries(layouts)) {
      await navigate(client, `/widget?captureLayout=${layout}`, dimensions.width, dimensions.height, ".widget.is-visible .cover img", true);
      await capture(client, join(outputDirectory, `layout-${layout}.png`));
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
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.updatePreset({ cover: { mode: 'square', glow: true } })" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const tintedTextPresentation = await readTextPresentation();
    if (JSON.stringify(originalTextPresentation) !== JSON.stringify(tintedTextPresentation)) {
      throw new Error("Cover tint changed text presentation without automatic readability enabled.");
    }
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
    await client.send("Runtime.evaluate", { expression: "window.__readmeDemo.updatePreset({ theme: 'light' })" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const lightPanelBorder = (await client.send("Runtime.evaluate", {
      expression: "getComputedStyle(document.querySelector('.panel')).borderColor",
      returnByValue: true
    })).result.value;
    if (lightPanelBorder !== "rgba(0, 0, 0, 0.15)") {
      throw new Error("The light theme did not apply its dedicated panel border.");
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
