import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accessUrls, externalIpv4Addresses, isDevContainerRuntime, isWslRuntime } from "../lib/network.mjs";

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

test("detecta WSL y Dev Container sin depender del equipo de CI", () => {
  assert.equal(isWslRuntime("Linux version 6.6.87.2-microsoft-standard-WSL2", {}), true);
  assert.equal(isWslRuntime("Linux version 6.8.0-generic", {}), false);
  assert.equal(isDevContainerRuntime({ REMOTE_CONTAINERS_IPC: "/tmp/vscode.sock" }), true);
  assert.equal(isDevContainerRuntime({}), false);
});

test("configura el reenvio automatico de VS Code", async () => {
  const source = await readFile(new URL("../.vscode/settings.json", import.meta.url), "utf8");
  const settings = JSON.parse(source);
  assert.equal(settings["remote.autoForwardPorts"], true);
  assert.equal(settings["remote.restoreForwardedPorts"], true);
  assert.equal(settings["remote.portsAttributes"]["8080"].protocol, "http");
});
