# Cloud desktop internet outage: 2026-11-11

## Confirmed cause

Both existing Grok cloud desktop Pods were configured to use
`http://host.docker.internal:17891`. Their NetworkPolicies already allowed only
the Mac Docker host address on TCP port 17891, and the Mac's Clash/Mihomo proxy
was healthy at `127.0.0.1:7890` (Google `generate_204` returned HTTP 204).

The repository already contained `scripts/desktop-proxy-bridge.mjs`, but the
Mac had no listener on `127.0.0.1:17891` and no loaded desktop proxy bridge
LaunchAgent. Desktop Chromium therefore could not connect to its configured
proxy and reported `ERR_PROXY_CONNECTION_FAILED`. This was a missing host
service lifecycle, not a bad Pod proxy URL, an Agent/DeepSeek failure, or a
Gmail login-state problem.

## Recovery

Install or repair the persistent current-user LaunchAgent with:

```sh
node scripts/install-desktop-proxy-bridge-launchagent.mjs
```

The job runs the existing bridge on login and restarts it if it exits. The
bridge binds only `127.0.0.1:17891` and forwards to the existing
`127.0.0.1:7890` proxy. Do not expose it on `0.0.0.0`, enable LAN access, change
the Pod's proxy URL, or create a proxy container.

## Verification evidence

At 2026-11-11, installed `com.coke.grok-bot.desktop-proxy-bridge` as a
current-user LaunchAgent. `launchctl print` reported `state = running`; `lsof`
showed its listener only at `127.0.0.1:17891` (PID 3396 at the time of the
check). The Mac's existing proxy returned HTTP 204 from Google's
`generate_204` endpoint. Both existing Desktop Pods also returned HTTP 204 via
the configured bridge:

- `grok-user-00213195e832242e4afea5b264424355/desktop-7c4c6f647f-6wk8f`: 204
- `grok-user-9aeae4430eb3728b46e7551a937c6f87/desktop-cddb7658c-lp84r`: 204

No Desktop Pod was recreated or restarted for this repair. The first visible
computer screenshot after installing the bridge still showed the pre-fix
`ERR_PROXY_CONNECTION_FAILED` page. Then, through the signed-in public Grok UI,
the BSE Frontend Dev Bot used Browser User to navigate to
`https://www.bse.cn/jygl_list/200029608.html`; it reported the page title
`关于实施〈北京证券交易所交易规则〉相关条款的公告`, visible page content,
and no approval or takeover. The computer preview continued to show the old
error screenshot after that task. Thus Browser User page loading and Desktop
Pod proxy egress are verified; the cached Desktop screenshot itself was not
refreshed during this check.
