export function endpointFor(bindAddr: string, browserHost: string): string | null {
  const sep = bindAddr.lastIndexOf(":");
  const port = sep < 0 ? "" : bindAddr.slice(sep + 1);
  return port ? `${browserHost}:${port}` : null;
}
