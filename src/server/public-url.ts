export function parsePublicUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Public URL must use HTTPS or loopback HTTP');
  // Keep cookie paths and proxy matching unambiguous; encoded paths are not supported.
  if (!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/.test(url.pathname)) throw new Error('Invalid public URL path');
  const prefix = url.pathname.replace(/\/$/, '');
  return { origin: url.origin, host: url.host, prefix, baseUrl: `${url.origin}${prefix}`, secure: url.protocol === 'https:' };
}
