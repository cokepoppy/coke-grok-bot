import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'com.coke.grok-bot.desktop-proxy-bridge';
const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
if (uid === undefined) throw new Error('This installer requires macOS user launchd');

const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
const plistPath = join(launchAgentsDir, `${label}.plist`);
const logDir = join(homedir(), 'Library', 'Logs');
const scriptPath = fileURLToPath(new URL('./desktop-proxy-bridge.mjs', import.meta.url));
const domain = `gui/${uid}`;
const service = `${domain}/${label}`;

const xmlEscape = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');
const stringElement = value => `    <string>${xmlEscape(value)}</string>`;

mkdirSync(launchAgentsDir, { recursive: true, mode: 0o755 });
mkdirSync(logDir, { recursive: true, mode: 0o755 });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
${stringElement(label)}
  <key>ProgramArguments</key>
  <array>
${stringElement(process.execPath)}
${stringElement(scriptPath)}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
${stringElement(join(logDir, 'coke-grok-bot-desktop-proxy-bridge.log'))}
  <key>StandardErrorPath</key>
${stringElement(join(logDir, 'coke-grok-bot-desktop-proxy-bridge.err'))}
</dict>
</plist>
`;

writeFileSync(plistPath, plist, { mode: 0o600 });
chmodSync(plistPath, 0o600);

// Replace only this project's dedicated job; never stop other launchd services.
try {
  execFileSync('launchctl', ['bootout', service], { stdio: 'ignore' });
} catch {
  // The job may not have been loaded yet.
}
execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'inherit' });
execFileSync('launchctl', ['kickstart', '-k', service], { stdio: 'inherit' });

process.stdout.write(`Installed and started ${label} (${plistPath})\n`);
