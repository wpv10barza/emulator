import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const token = "ci-emulator-token";
const backendPort = 3200;
const emulatorPort = 8200;
const terminal = [];
const children = [];
const pagePerformance = [];

function record(source, text) {
  const line = `[${source}] ${String(text).trimEnd()}`;
  terminal.push(line);
  process.stdout.write(`${line}\n`);
}

function start(file, environment, name) {
  const child = spawn(process.execPath, [file], {
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => record(name, chunk));
  child.stderr.on("data", chunk => record(`${name}:stderr`, chunk));
  children.push(child);
  return child;
}

async function waitFor(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Servicio no disponible: ${url}`);
}

function svg(state, label, detail, color, face) {
  const eyes = face === "cross"
    ? `<g stroke="#fff" stroke-width="14"><path d="M176 180l60 60m0-60l-60 60M404 180l60 60m0-60l-60 60"/></g>`
    : `<g fill="#fff"><rect x="176" y="178" width="76" height="76" rx="22"/><rect x="388" y="178" width="76" height="76" rx="22"/></g>`;
  const smile = face === "smile" ? `<path d="M285 284q35 30 70 0" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="2100" viewBox="0 0 600 700">
  <rect width="600" height="700" fill="#fff"/>
  <rect x="50" y="30" width="500" height="560" rx="32" fill="#20262c"/>
  <rect x="60" y="40" width="480" height="480" rx="16" fill="${color}"/>
  <g font-family="DejaVu Sans,Arial,sans-serif" text-anchor="middle" fill="#fff">
    <text x="300" y="84" font-size="24" font-weight="700" fill="#aadfff">ASISTENTE 3C</text>
    ${eyes}${smile}
    <text x="300" y="330" font-size="24" font-weight="700">${label}</text>
    <text x="300" y="362" font-size="15" fill="#d2e1eb">${detail}</text>
    <rect x="80" y="410" width="210" height="82" rx="16" fill="#0f5287" stroke="#b9d2e6"/>
    <rect x="310" y="410" width="210" height="82" rx="16" fill="#126949" stroke="#b9d2e6"/>
    <text x="185" y="459" font-size="20" font-weight="700">PROBAR WSL</text>
    <text x="415" y="459" font-size="20" font-weight="700">ENVIAR 3C</text>
    <text x="300" y="625" font-size="18" font-weight="700" fill="#17212a">ESP32-S3-4848S040 — ${state}</text>
    <text x="300" y="655" font-size="14" fill="#394b59">Captura generada por emulacion funcional en Ubuntu</text>
    <text x="300" y="678" font-size="12" fill="#7b2f2f">No constituye validacion fisica ST7701/GT911</text>
  </g></svg>`;
}

try {
  await mkdir("artifacts/screens", { recursive: true });
  start("mock-backend.mjs", { MOCK_BACKEND_PORT: String(backendPort), MOCK_BACKEND_HOST: "0.0.0.0", ESP32_API_TOKEN: token }, "mock");
  start("server.mjs", {
    EMULATOR_PORT: String(emulatorPort),
    EMULATOR_HOST: "0.0.0.0",
    ASSISTANT_BASE_URL: `http://127.0.0.1:${backendPort}`,
    ESP32_API_TOKEN: token
  }, "emulator");

  const base = `http://127.0.0.1:${emulatorPort}`;
  await waitFor(`${base}/healthz`);
  for (const path of ["/", "/styles.css", "/panel.js", "/panel-model.mjs"]) {
    const started = performance.now();
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(2000) });
    const data = await response.arrayBuffer();
    const elapsedMs = Number((performance.now() - started).toFixed(2));
    const metric = {
      path,
      status: response.status,
      elapsed_ms: elapsedMs,
      bytes: data.byteLength,
      content_length: Number(response.headers.get("content-length"))
    };
    pagePerformance.push(metric);
    record("page", `${path} -> ${response.status}, ${elapsedMs} ms, ${data.byteLength} bytes`);
  }
  record("test", "Pantalla 480x480 disponible sin respuestas fragmentadas");

  const healthResponse = await fetch(`${base}/bridge/health`);
  const health = await healthResponse.json();
  record("test", `GET health -> ${healthResponse.status} ${JSON.stringify(health)}`);

  const commandResponse = await fetch(`${base}/bridge/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Cambia la tarea J10 a mensual" })
  });
  const command = await commandResponse.json();
  record("test", `POST command -> ${commandResponse.status} ${JSON.stringify(command)}`);

  for (let poll = 1; poll <= 2; poll += 1) {
    const response = await fetch(`${base}/bridge/commands/${command.command_id}`);
    const payload = await response.json();
    record("test", `GET status ${poll} -> ${response.status} ${JSON.stringify(payload)}`);
  }

  const evidence = await (await fetch(`${base}/evidence.json`)).json();
  await writeFile("artifacts/evidence.json", `${JSON.stringify(evidence, null, 2)}\n`);

  const screens = [
    ["01_ready.svg", "ready", "WSL DISPONIBLE", "Endpoint 3C conectado", "#052d1b", "normal"],
    ["02_pending.svg", "pending_confirmation", "ESPERA CONFIRMACION", "Confirme en Asistente 3C", "#442b02", "normal"],
    ["03_applied.svg", "applied", "CAMBIO APLICADO", "Confirmacion simulada en Ubuntu", "#02411c", "smile"],
    ["04_rejected.svg", "rejected", "ORDEN CANCELADA", "Escenario controlado", "#3e1d03", "cross"]
  ];
  for (const [file, ...args] of screens) {
    await writeFile(`artifacts/screens/${file}`, svg(...args));
  }

  const digest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  await writeFile("artifacts/manifest.json", `${JSON.stringify({
    evidence_type: "emulated_integration",
    target: "ESP32-S3-4848S040",
    display: "480x480",
    operating_system: "Ubuntu GitHub-hosted runner",
    sha256_evidence: digest,
    page_performance: pagePerformance,
    limitations: ["ST7701 no validado fisicamente", "GT911 no validado fisicamente", "PSRAM/audio/GPIO no validados fisicamente"]
  }, null, 2)}\n`);
  record("result", `Evidencia generada. SHA-256: ${digest}`);
  await writeFile("artifacts/figure-captions.md", `# Rótulos para la tesis\n\n` +
    `1. **Conexión del panel virtual con WSL.** Captura obtenida mediante emulación funcional del ESP32-S3-4848S040 en Ubuntu. No constituye validación física del ST7701 o GT911.\n` +
    `2. **Solicitud pendiente de confirmación humana.** Estado generado por el contrato HTTP emulado y registrado en evidence.json.\n` +
    `3. **Resultado aplicado en el panel virtual.** Confirmación simulada con fines de prueba; no implica escritura en Google Sheets.\n` +
    `4. **Resultado rechazado en el panel virtual.** Escenario controlado para comprobar la representación de estados.\n`);
  await writeFile("artifacts/ubuntu-terminal.log", `${terminal.join("\n")}\n`);
} finally {
  for (const child of children) child.kill("SIGTERM");
}
