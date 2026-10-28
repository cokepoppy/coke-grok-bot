import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_AUTH_PROXY_TARGET;
  const base = env.VITE_BASE_PATH || '/';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('VITE_BASE_PATH must be a slash-terminated path');
  return { base, plugins: [react()], server: { host: '127.0.0.1', strictPort: true, proxy: target ? { [`${base}api/auth`]: { target, changeOrigin: false }, [`${base}auth/google/callback`]: { target, changeOrigin: false } } : undefined } };
});
