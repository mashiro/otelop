// Bind addresses that listen on every interface, where the host part says
// nothing about how a client should reach the server.
const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "[::]"]);

// Turns a server bind address ("0.0.0.0:4317", ":4319", "127.0.0.1:4318")
// into a URL a client can actually connect to. A wildcard host is replaced
// with the host the browser reached otelop through, since that is the name
// known to route to this server (localhost, a LAN IP, a Docker port map...).
export function reachableEndpoint(bindAddr: string, browserHost: string): string {
  const sep = bindAddr.lastIndexOf(":");
  const host = bindAddr.slice(0, sep);
  const port = bindAddr.slice(sep + 1);
  return `http://${WILDCARD_HOSTS.has(host) ? browserHost : host}:${port}`;
}
