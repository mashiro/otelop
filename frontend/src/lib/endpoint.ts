// Builds the host:port a client should send to, from a server bind address
// ("0.0.0.0:4317", ":4318", "127.0.0.1:4317"). Only the port is taken from
// the bind: its host describes the server's own interfaces, not a name a
// client elsewhere can use, while the host the browser reached otelop
// through is known to route here (localhost, a LAN name, a Docker port
// map...). No scheme: whether a proxy in front terminates TLS is unknowable
// here, and SDK options like Go's WithEndpoint take a bare host:port.
export function endpointFor(bindAddr: string, browserHost: string): string {
  const port = bindAddr.slice(bindAddr.lastIndexOf(":") + 1);
  return `${browserHost}:${port}`;
}
