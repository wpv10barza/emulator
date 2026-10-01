import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  externalIpv4Addresses,
  isDevContainerRuntime,
  isWslRuntime,
  selectReachableWslIpv4,
  wslIpv4Candidates
} from "../lib/network.mjs";

const execFileAsync = promisify(execFile);
const powershell = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const scriptPath = fileURLToPath(new URL("./windows-portproxy.ps1", import.meta.url));

function numericArgument(name, fallback) {
  const value = process.argv.find(argument => argument.startsWith(`--${name}=`));
  const parsed = Number(value?.slice(name.length + 3) || fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new RangeError(`Puerto no valido para --${name}: ${parsed}`);
  }
  return parsed;
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function procVersion() {
  try {
    return await readFile("/proc/version", "utf8");
  } catch {
    return "";
  }
}

async function emulatorHealthy(host, port) {
  const url = `http://${host}:${port}/healthz`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const body = await response.json();
    return response.ok && body.ok === true && body.service === "esp32-4848s040-emulator";
  } catch {
    return false;
  }
}

async function verifyEmulator(host, port) {
  const url = `http://${host}:${port}/healthz`;
  if (!(await emulatorHealthy(host, port))) {
    throw new Error(
      `El emulador no responde correctamente en ${url}. Ejecute 'npm start' y confirme 'curl http://127.0.0.1:${port}/healthz'.`
    );
  }
}

async function main() {
  const listenPort = numericArgument("listen-port", 18080);
  const connectPort = numericArgument("connect-port", process.env.EMULATOR_PORT || 8080);
  const version = await procVersion();

  // No son errores de ejecución: simplemente este puente no aplica en esos entornos.
  // Salir con 0 evita que VS Code marque la terminal como fallida por una operación opcional.
  if (!isWslRuntime(version)) {
    console.warn("SKIP WSL FORWARD: esta terminal no es WSL. Use el puerto local/forward del entorno actual.");
    return;
  }

  if (isDevContainerRuntime()) {
    console.warn("SKIP WSL FORWARD: Dev Container detectado. Use los forwardPorts de .devcontainer/devcontainer.json.");
    return;
  }

  try {
    await access(powershell);
  } catch {
    throw new Error(`PowerShell de Windows no esta disponible en ${powershell}. Confirme que WSL monta /mnt/c.`);
  }

  // Primero comprobamos el servicio local. Si 8080 pertenece a otro proceso,
  // no se intenta elevar PowerShell ni crear un portproxy incorrecto.
  await verifyEmulator("127.0.0.1", connectPort);

  const addresses = externalIpv4Addresses();
  const candidates = wslIpv4Candidates(addresses);
  const connectAddress = await selectReachableWslIpv4(
    addresses,
    address => emulatorHealthy(address, connectPort)
  );

  if (!connectAddress) {
    const diagnostic = candidates.length ? candidates.join(", ") : "ninguna";
    throw new Error(
      `Ninguna IPv4 privada de WSL alcanza el emulador en el puerto ${connectPort}. Candidatas probadas: ${diagnostic}.`
    );
  }

  const translated = await execFileAsync("wslpath", ["-w", scriptPath]);
  const windowsSource = translated.stdout.trim();
  const command = [
    `$source = ${psLiteral(windowsSource)}`,
    "$target = Join-Path $env:TEMP 'emulator-wsl-portproxy.ps1'",
    "$log = Join-Path $env:TEMP 'emulator-wsl-portproxy.log'",
    "Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue",
    "Copy-Item -LiteralPath $source -Destination $target -Force",
    `$arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$target,'-ConnectAddress',${psLiteral(connectAddress)},'-ListenPort','${listenPort}','-ConnectPort','${connectPort}','-LogPath',$log)`,
    "$process = Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru",
    "if (Test-Path -LiteralPath $log) { Get-Content -Raw -LiteralPath $log | Write-Output }",
    "exit $process.ExitCode"
  ].join("; ");

  console.log(`Creando puente seguro 127.0.0.1:${listenPort} -> ${connectAddress}:${connectPort}`);
  console.log("Windows mostrara una confirmacion de administrador para configurar netsh portproxy.");

  try {
    const result = await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      timeout: 120000,
      windowsHide: false,
      encoding: "utf8"
    });
    const diagnostic = result.stdout.trim();
    if (diagnostic) console.log(diagnostic);
  } catch (error) {
    const diagnostic = String(error.stdout || error.stderr || "").trim();
    throw new Error(
      diagnostic || "El proceso elevado fallo sin diagnostico. Verifique que acepto la solicitud de administrador."
    );
  }

  console.log(`Puente instalado. Abra http://127.0.0.1:${listenPort}`);
}

try {
  await main();
} catch (error) {
  console.error(`ERROR WSL FORWARD: ${error.message || error}`);
  process.exitCode = 1;
}
