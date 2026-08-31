import { networkInterfaces } from "node:os";

function runtimeNetworkInterfaces() {
  try {
    return networkInterfaces();
  } catch {
    return {};
  }
}

export function externalIpv4Addresses(interfaces = null) {
  const availableInterfaces = interfaces || runtimeNetworkInterfaces();
  const preferred = [];
  const fallback = [];
  for (const [name, entries] of Object.entries(availableInterfaces)) {
    for (const entry of entries || []) {
      const ipv4 = entry.family === "IPv4" || entry.family === 4;
      if (ipv4 && !entry.internal && entry.address && entry.address !== "0.0.0.0") {
        const target = /^(docker|br-|veth|lo)/i.test(name) ? fallback : preferred;
        target.push(entry.address);
      }
    }
  }
  return [...new Set([...preferred, ...fallback])];
}

export function accessUrls(port, interfaces = null) {
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new RangeError(`Puerto no valido: ${port}`);
  }
  return externalIpv4Addresses(interfaces).map(address => `http://${address}:${normalizedPort}`);
}

export function selectWslIpv4(addresses) {
  const candidates = [...new Set(addresses || [])].filter(address =>
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(String(address))
  );
  return candidates[0] || null;
}

export function isWslRuntime(version = "", environment = process.env) {
  return /microsoft/i.test(String(version)) || Boolean(environment.WSL_DISTRO_NAME || environment.WSL_INTEROP);
}

export function isDevContainerRuntime(environment = process.env) {
  return Boolean(
    environment.REMOTE_CONTAINERS ||
    environment.REMOTE_CONTAINERS_IPC ||
    environment.CODESPACES ||
    environment.DEVCONTAINER
  );
}
