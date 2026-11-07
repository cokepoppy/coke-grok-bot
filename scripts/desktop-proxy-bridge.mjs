import net from 'node:net';

const listenHost = '127.0.0.1';
const listenPort = 17891;
const upstreamHost = '127.0.0.1';
const upstreamPort = Number(process.env.COKE_GROK_DESKTOP_PROXY_UPSTREAM_PORT || 7890);

if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535 || listenPort === upstreamPort) {
  throw new Error('Invalid loopback proxy bridge ports');
}

function probeUpstream() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: upstreamHost, port: upstreamPort });
    const timer = setTimeout(() => socket.destroy(new Error('UPSTREAM_TIMEOUT')), 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

await probeUpstream();

const clients = new Set();
const server = net.createServer(client => {
  clients.add(client);
  client.once('close', () => clients.delete(client));
  const upstream = net.createConnection({ host: upstreamHost, port: upstreamPort });
  client.once('error', () => upstream.destroy());
  upstream.once('error', () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
});

server.on('error', error => {
  process.stderr.write(`Desktop proxy bridge stopped: ${error.code || 'LISTEN_ERROR'}\n`);
  process.exitCode = 1;
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(`Desktop proxy bridge listening on ${listenHost}:${listenPort}; upstream ${upstreamHost}:${upstreamPort}\n`);
});

function shutdown() {
  for (const client of clients) client.destroy();
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
