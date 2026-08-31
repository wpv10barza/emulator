import { access, readFile } from "node:fs/promises";
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
    const payload = await response.json();
    const expected = payload?.ok === true && payload?.service === "esp32-4848s040-emulator";
    return {
      ok: response.ok && expected,
      status: response.status,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      reason: expected ? "" : "La respuesta no pertenece al emulador esperado."
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      reason: String(error.message || error)
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

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function windowsProbe(url) {
  try {
    await access(powershell);
  } catch {
    return { available: false, ok: false, reason: "PowerShell de Windows no esta montado" };
  }

  const command = [
    "$ProgressPreference='SilentlyContinue'",
    `try { $response=Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 -Uri ${psLiteral(url)}`,
    "if ($response.ok -eq $true -and $response.service -eq 'esp32-4848s040-emulator') { Write-Output 'OK'; exit 0 }",
    "Write-Error 'La respuesta no pertenece al emulador esperado.'; exit 2",
    "} catch { Write-Error $_.Exception.Message; exit 1 }"
  ].join("; ");

  try {
    const result = await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      timeout: 6000,
      windowsHide: true
    });
    return { available: true, ok: /OK/.test(result.stdout), output: result.stdout.trim() };
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
  console.error(`- No responde correctamente ${localHealthUrl}: ${internal.reason}`);
  console.error("- Inicie primero el emulador actualizado con: npm start");
  process.exitCode = 1;
} else {
  const directUrls = accessUrls(port);
  console.log(`- URL dentro de WSL/Linux: http://127.0.0.1:${port}`);
  for (const url of directUrls) console.log(`- Candidato directo Windows/red: ${url}`);

  if (wsl || devContainer) {
    const windowsLoopback = await windowsProbe(localHealthUrl);
    if (windowsLoopback.ok) {
      console.log(`- Acceso Windows verificado: http://127.0.0.1:${port}`);
    } else {
      console.warn("- Acceso Windows por localhost: NO DISPONIBLE");
      if (windowsLoopback.reason) console.warn(`  ${windowsLoopback.reason.split(/\r?\n/)[0]}`);

      const reachable = [];
      for (const url of directUrls) {
        const result = await windowsProbe(`${url}/healthz`);
        if (result.ok) reachable.push(url);
      }

      if (reachable.length) {
        console.log(`- Abra desde Windows: ${reachable[0]}`);
      } else if (devContainer) {
        console.warn("- Aplique la configuracion versionada: Dev Containers: Rebuild and Reopen in Container.");
        console.warn("- Luego abra el puerto 8080 desde la pestana Ports.");
      } else if (wsl) {
        console.warn("- Ejecute el puente de respaldo: npm run wsl:forward");
        console.warn("- Tras aceptar UAC, abra http://127.0.0.1:18080");
      }
      process.exitCode = 2;
    }
  }
}
