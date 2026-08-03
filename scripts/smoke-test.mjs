import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = process.cwd();
const testDataDirectory = await mkdtemp(join(tmpdir(), "obs-music-widget-smoke-"));
const testPort = await reserveFreePort();
const baseUrl = `http://127.0.0.1:${testPort}`;
const testEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  MUSIC_WIDGET_TEST_DATA_DIRECTORY: testDataDirectory
};
const { defaultConfig } = await import("../build/server/shared/schema.js");
const testConfig = structuredClone(defaultConfig);
testConfig.server.port = testPort;
await writeFile(join(testDataDirectory, "config.json"), `${JSON.stringify(testConfig, null, 2)}\n`, "utf8");
await runControl("stop");
const server = spawn(process.execPath, ["build/server/server/index.js", "start"], {
  cwd,
  env: testEnvironment,
  stdio: ["ignore", "pipe", "pipe"]
});
const serverExit = new Promise((resolve) => server.once("exit", resolve));

let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

try {
  await waitForHealth();
  const healthResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "null" }
  });
  if (healthResponse.headers.get("access-control-allow-origin") !== "*") {
    throw new Error("The health endpoint does not allow the local OBS bootstrap origin.");
  }
  const health = await healthResponse.json();
  if (!health.ok || health.service !== "obs-music-widget") throw new Error("The health endpoint did not identify the expected service.");

  const config = await getJson(`${baseUrl}/api/config`);
  if (config.activePreset !== "main") throw new Error("The default preset is missing.");
  const bootstrap = await getJson(`${baseUrl}/api/system/bootstrap`);
  if (!bootstrap.url.startsWith("file:///") || !bootstrap.url.endsWith("/dist/obs-bootstrap.html")) {
    throw new Error("The bootstrap file URL is unavailable or invalid.");
  }
  const socketMessage = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
    const timeout = setTimeout(() => reject(new Error("The initial WebSocket snapshot was not received.")), 2000);
    socket.onmessage = (event) => {
      clearTimeout(timeout);
      socket.close();
      resolve(JSON.parse(event.data));
    };
    socket.onerror = () => reject(new Error("The WebSocket connection failed."));
  });
  if (socketMessage.type !== "snapshot") throw new Error("The first WebSocket message is not a snapshot.");
  const savedConfig = await fetch(`${baseUrl}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!savedConfig.ok) throw new Error("The configuration could not be saved.");
  const trustedConfig = await fetch(`${baseUrl}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(config)
  });
  if (!trustedConfig.ok) throw new Error("The configuration route rejected its trusted browser origin.");
  const rejectedConfig = await fetch(`${baseUrl}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify(config)
  });
  if (rejectedConfig.status !== 403) throw new Error("The configuration route accepted an untrusted browser origin.");
  const idleMedia = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);
  const rejectedMedia = await fetch(`${baseUrl}/api/empty-state-media/main`, {
    method: "PUT",
    headers: { "content-type": "image/png", origin: "https://example.com" },
    body: idleMedia
  });
  if (rejectedMedia.status !== 403) throw new Error("The idle media route accepted an untrusted browser origin.");
  const uploadedMedia = await fetch(`${baseUrl}/api/empty-state-media/main`, {
    method: "PUT",
    headers: { "content-type": "image/png", origin: baseUrl },
    body: idleMedia
  });
  if (!uploadedMedia.ok || (await uploadedMedia.json()).kind !== "image") throw new Error("Idle media could not be uploaded.");
  const storedMedia = await fetch(`${baseUrl}/api/empty-state-media/main`);
  if (!storedMedia.ok || storedMedia.headers.get("content-type") !== "image/png" || !Buffer.from(await storedMedia.arrayBuffer()).equals(idleMedia)) {
    throw new Error("Stored idle media could not be read back.");
  }
  const rangedMedia = await fetch(`${baseUrl}/api/empty-state-media/main`, { headers: { range: "bytes=0-3" } });
  if (rangedMedia.status !== 206 || rangedMedia.headers.get("content-range") !== `bytes 0-3/${idleMedia.length}`) {
    throw new Error("Stored idle media does not support byte ranges.");
  }
  const deletedMedia = await fetch(`${baseUrl}/api/empty-state-media/main`, { method: "DELETE", headers: { origin: baseUrl } });
  if (!deletedMedia.ok || (await fetch(`${baseUrl}/api/empty-state-media/main`)).status !== 404) throw new Error("Idle media could not be removed.");
  const profileConfig = structuredClone(config);
  profileConfig.presets.scene = { ...structuredClone(config.presets.main), name: "Scene" };
  const createdProfile = await fetch(`${baseUrl}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(profileConfig)
  });
  if (!createdProfile.ok) throw new Error("An additional profile could not be created.");
  const profileMedia = await fetch(`${baseUrl}/api/empty-state-media/scene`, {
    method: "PUT",
    headers: { "content-type": "image/png", origin: baseUrl },
    body: idleMedia
  });
  if (!profileMedia.ok) throw new Error("Profile media could not be uploaded.");
  delete profileConfig.presets.scene;
  const removedProfile = await fetch(`${baseUrl}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(profileConfig)
  });
  if (!removedProfile.ok || (await fetch(`${baseUrl}/api/empty-state-media/scene`)).status !== 404) {
    throw new Error("Deleting a profile did not remove its idle media.");
  }
  const rejectedDisconnect = await fetch(`${baseUrl}/api/auth/disconnect`, {
    method: "POST",
    headers: { origin: "https://example.com" }
  });
  if (rejectedDisconnect.status !== 403) throw new Error("The disconnect route accepted an untrusted browser origin.");
  if (await websocketStatus("https://example.com") !== 403) throw new Error("The WebSocket route accepted an untrusted browser origin.");

  const dashboard = await fetch(`${baseUrl}/dashboard`);
  if (!dashboard.ok || !await dashboard.text().then((text) => text.includes("Music Widget"))) throw new Error("The dashboard route is unavailable.");

  const widget = await fetch(`${baseUrl}/widget/main`);
  if (!widget.ok || !await widget.text().then((text) => text.includes("OBS Music Widget"))) throw new Error("The widget route is unavailable.");
  const queryWidget = await fetch(`${baseUrl}/widget?preset=main`);
  if (!queryWidget.ok || !await queryWidget.text().then((text) => text.includes("OBS Music Widget"))) throw new Error("The query-parameter widget route is unavailable.");

  const stopCode = await runControl("stop", true);
  if (stopCode !== 0) throw new Error("The stop command failed.");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("The server did not stop within eight seconds.")), 8000);
    serverExit.then(() => { clearTimeout(timeout); resolve(); });
  });
  console.log("Smoke test passed: start, API, dashboard, widget, and shutdown are working.");
} catch (error) {
  server.kill("SIGTERM");
  console.error(output);
  throw error;
} finally {
  await rm(testDataDirectory, { recursive: true, force: true });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The server did not start.");
}

async function reserveFreePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local test port.");
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function websocketStatus(origin) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: testPort });
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("The WebSocket origin check timed out."));
    }, 2000);
    socket.on("connect", () => socket.write([
      "GET /ws HTTP/1.1",
      `Host: 127.0.0.1:${testPort}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
      "Sec-WebSocket-Version: 13",
      `Origin: ${origin}`,
      "",
      ""
    ].join("\r\n")));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      const match = /^HTTP\/1\.1 (\d{3})/.exec(response);
      if (!match) return;
      clearTimeout(timeout);
      socket.destroy();
      resolve(Number(match[1]));
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function runControl(command, inherit = false) {
  const child = spawn(process.execPath, ["build/server/server/index.js", command], {
    cwd,
    env: testEnvironment,
    stdio: inherit ? "inherit" : "ignore"
  });
  return new Promise((resolve) => child.once("exit", resolve));
}
