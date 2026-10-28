import { writeFile } from 'node:fs/promises';
const basePath = process.env.VITE_BASE_PATH || '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath) || process.env.VITE_REQUIRE_AUTH !== 'true') throw new Error('Build the deployment frontend with a valid VITE_BASE_PATH and VITE_REQUIRE_AUTH=true.');
await writeFile('dist/web-build.json', JSON.stringify({ basePath, requireAuth: true }) + '\n');
