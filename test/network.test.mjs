import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  accessUrls,
  externalIpv4Addresses,
  isDevContainerRuntime,
  isWslRuntime,
  selectWslIpv4
} from "../lib/network.mjs";

const interfaces = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  eth0: [
    { address: "172.25.112.44", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false }
  ],
  docker0: [{ address: "172.17.0.1", family: 4, internal: false }]
};

test("genera URLs IPv4 accesibles fuera del loopback", () => {
  assert.deepEqual(externalIpv4Addresses(interfaces), ["172.25.112.44", "172.17.0.1"]);
  assert.deepEqual(accessUrls(8080, interfaces), ["http://172.25.112.44:8080", "http://172.17.0.1:8080"]);
  assert.throws(() => accessUrls(70000, interfaces), /Puerto no valido/);
});

test("elige una direccion privada valida para el puente WSL", () => {
  assert.equal(selectWslIpv4(["127.0.0.1", "172.25.112.44", "8.8.8.8"]), "172.25.112.44");
  assert.equal(selectWslIpv4(["8.8.8.8"]), null);
});

test("detecta WSL y Dev Container sin depender del equipo de CI", () => {
  assert.equal(isWslRuntime("Linux version 6.6.87.2-microsoft-standard-WSL2", {}), true);
  assert.equal(isWslRuntime("Linux version 6.8.0-generic", {}), false);
  assert.equal(isDevContainerRuntime({ REMOTE_CONTAINERS_IPC: "/tmp/vscode.sock" }), true);
  assert.equal(isDevContainerRuntime({}), false);
});

test("configura reenvio remoto sin exigir que 8080 este libre en Windows", async () => {
  const source = await readFile(new URL("../.vscode/settings.json", import.meta.url), "utf8");
  const settings = JSON.parse(source);
  assert.equal(settings["remote.autoForwardPorts"], true);
  assert.equal(settings["remote.restoreForwardedPorts"], true);
  assert.equal(settings["remote.portsAttributes"]["8080"].protocol, "http");
  assert.equal(settings["remote.portsAttributes"]["8080"].requireLocalPort, false);
});

test("define Dev Container reproducible con los puertos 8080 y 3000", async () => {
  const source = await readFile(new URL("../.devcontainer/devcontainer.json", import.meta.url), "utf8");
  const configuration = JSON.parse(source);
  assert.deepEqual(configuration.forwardPorts, [8080, 3000]);
  assert.equal(configuration.portsAttributes["8080"].requireLocalPort, false);
  assert.equal(configuration.containerEnv.EMULATOR_HOST, "0.0.0.0");
  assert.equal(configuration.postCreateCommand, "npm ci");
});

test("el puente de respaldo queda limitado al loopback de Windows", async () => {
  const source = await readFile(new URL("../scripts/windows-portproxy.ps1", import.meta.url), "utf8");
  assert.match(source, /listenaddress=127\.0\.0\.1/);
  assert.doesNotMatch(source, /listenaddress=0\.0\.0\.0/);
  assert.match(source, /esp32-4848s040-emulator/);

  const packageSource = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.scripts["wsl:forward"], "node scripts/wsl-forward.mjs");
});
