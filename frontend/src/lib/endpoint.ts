export function endpointFor(bindAddr: string, browserHost: string): string {
  const port = bindAddr.slice(bindAddr.lastIndexOf(":") + 1);
  return `${browserHost}:${port}`;
}
