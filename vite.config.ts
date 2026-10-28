import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_AUTH_PROXY_TARGET;
  return { plugins: [react()], server: { host: '127.0.0.1', strictPort: true, proxy: target ? { '/api/auth': { target, changeOrigin: false }, '/auth/google/callback': { target, changeOrigin: false } } : undefined } };
});
