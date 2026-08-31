import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  externalIpv4Addresses,
  isDevContainerRuntime,
  isWslRuntime,
  selectWslIpv4
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

const listenPort = numericArgument("listen-port", 18080);
const connectPort = numericArgument("connect-port", process.env.EMULATOR_PORT || 8080);
const version = await procVersion();

if (!isWslRuntime(version)) {
  console.error("Este comando solo aplica a WSL. En Dev Container use los forwardPorts incluidos en .devcontainer/devcontainer.json.");
  process.exit(1);
}

if (isDevContainerRuntime()) {
  console.error("Esta terminal pertenece a un Dev Container. Ejecute 'Dev Containers: Rebuild and Reopen in Container' para aplicar forwardPorts.");
  process.exit(1);
}

await access(powershell);
const connectAddress = selectWslIpv4(externalIpv4Addresses());
if (!connectAddress) {
  throw new Error("No se encontro una direccion IPv4 privada de WSL para crear el puente.");
}

const translated = await execFileAsync("wslpath", ["-w", scriptPath]);
const windowsSource = translated.stdout.trim();
const command = [
  `$source = ${psLiteral(windowsSource)}`,
  "$target = Join-Path $env:TEMP 'emulator-wsl-portproxy.ps1'",
  "Copy-Item -LiteralPath $source -Destination $target -Force",
  "$arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$target,",
  `  '-ConnectAddress',${psLiteral(connectAddress)},'-ListenPort','${listenPort}','-ConnectPort','${connectPort}')`,
  "$process = Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru",
  "exit $process.ExitCode"
].join("; ");

console.log(`Creando puente seguro 127.0.0.1:${listenPort} -> ${connectAddress}:${connectPort}`);
console.log("Windows mostrara una confirmacion de administrador para configurar netsh portproxy.");
await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
  timeout: 120000,
  windowsHide: false
});
console.log(`Puente instalado. Abra http://127.0.0.1:${listenPort}`);
