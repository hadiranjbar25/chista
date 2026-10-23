import { isTauri } from '@tauri-apps/api/core';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
export function endpoint(value: string, allowLoopback = false): URL {
  const url = new URL(value);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search) throw new Error('Use an endpoint without credentials, query parameters or a fragment.');
  if (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) throw new Error('Use HTTPS (MCP also supports HTTP on loopback).');
  if (!allowLoopback && loopback) throw new Error('Configure a hosted model endpoint, not a local model.');
  return url;
}
export const desktopFetch: typeof fetch = async (input, init) => {
  if (!isTauri()) throw new Error('Live connections require the Tauri desktop app. Browser mode supports local file review only.');
  return nativeFetch(input, { ...init, maxRedirections: 0, connectTimeout: 15_000 });
};
