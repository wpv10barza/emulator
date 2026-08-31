import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessUrls, isDevContainerRuntime, isWslRuntime } from "../lib/network.mjs";

const execFileAsync = promisify(execFile);
const portArgument = process.argv.find(value => value.startsWith("--port="));
const port = Number(portArgument?.slice(7) || process.env.EMULATOR_PORT || 8080);
const localHealthUrl = `http://127.0.0.1:${port}/healthz`;
const powershell = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

async function probe(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Number((performance.now() - started).toFixed(2))
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      error: String(error.message || error)
    };
  }
}

async function procVersion() {
  try {
    return await readFile("/proc/version", "utf8");
  } catch {
    return "";
  }
}

async function windowsLoopbackProbe() {
  try {
    await access(powershell);
  } catch {
    return { available: false, ok: false, reason: "PowerShell de Windows no esta montado" };
  }

  const command = "$ProgressPreference='SilentlyContinue'; " +
    `try { $response=Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri '${localHealthUrl}'; ` +
    "Write-Output $response.StatusCode; exit 0 } " +
    "catch { Write-Error $_.Exception.Message; exit 1 }";

  try {
    const result = await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      timeout: 6000,
      windowsHide: true
    });
    return { available: true, ok: /200/.test(result.stdout), output: result.stdout.trim() };
  } catch (error) {
    return {
      available: true,
      ok: false,
      reason: String(error.stderr || error.message || error).trim()
    };
  }
}

const version = await procVersion();
const wsl = isWslRuntime(version);
const devContainer = isDevContainerRuntime();
const internal = await probe(localHealthUrl);

console.log("Diagnostico de acceso al emulador ESP32-S3-4848S040");
console.log(`- Entorno: ${wsl ? "WSL" : "Linux"}${devContainer ? " + Dev Container" : ""}`);
console.log(`- Servicio interno: ${internal.ok ? "OK" : "FALLO"} (${internal.status || "sin respuesta"}, ${internal.elapsedMs} ms)`);

if (!internal.ok) {
  console.error(`- No responde ${localHealthUrl}: ${internal.error || "estado HTTP no valido"}`);
  console.error("- Inicie primero el emulador con: npm start");
  process.exitCode = 1;
} else {
  const directUrls = accessUrls(port);
  console.log("- URL dentro de WSL/Linux: http://127.0.0.1:" + port);
  for (const url of directUrls) console.log(`- URL directa desde Windows/red: ${url}`);

  if (wsl) {
    const windows = await windowsLoopbackProbe();
    if (windows.ok) {
      console.log(`- Reenvio Windows -> WSL: OK (http://127.0.0.1:${port})`);
    } else {
      console.warn("- Reenvio Windows -> WSL: NO DISPONIBLE");
      if (windows.reason) console.warn(`  ${windows.reason.split(/\r?\n/)[0]}`);
      console.warn(`- Solucion: VS Code > Ports > Forward a Port > ${port} > Open in Browser.`);
      console.warn("- Alternativa: abra una de las URL directas mostradas arriba.");
    }
  } else if (devContainer) {
    console.log(`- Dev Container: reenvie el puerto ${port} desde la pestana Ports de VS Code.`);
  }
}
