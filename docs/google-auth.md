# Google identity API (in progress)

This backend implements the server-side Google OpenID Connect authorization-code flow described in [Google's documentation](https://developers.google.com/identity/openid-connect/openid-connect), with state, nonce and PKCE, MySQL-backed one-use flows and server-side sessions. The frontend remains a local-only preview; an opt-in authentication mode integrates these endpoints. Mock identity-provider tests are not proof of a live Google login.

The service uses `COKE_GROK_PUBLIC_ORIGIN` (an HTTPS base URL, or HTTP loopback for development; an optional slash-delimited path prefix is supported), `COKE_GROK_GOOGLE_CLIENT_ID`, `COKE_GROK_GOOGLE_SECRET_FILE`, `COKE_GROK_MYSQL_HOST`, `COKE_GROK_MYSQL_PORT` (default 3306), `COKE_GROK_MYSQL_USER`, `COKE_GROK_MYSQL_PASSWORD_FILE`, and `COKE_GROK_MYSQL_DATABASE`. Secret files must be private (no group/other permissions). It binds to `127.0.0.1:3001` by default; `COKE_GROK_AUTH_HOST` and `COKE_GROK_AUTH_PORT` override this. Run `npm run start:auth`. The database must already exist; startup creates the identity tables. The Google OAuth client must register the exact callback `<base URL>/auth/google/callback`.

A trusted reverse proxy must preserve the public Host, terminate HTTPS, and route `/api/auth/` and `/auth/google/callback` to this service. Do not log callback query strings or cookies. Do not expose this service publicly until its deployment, secrets, origin, and browser flow have been verified. An independently bundled auth runtime and a local ARM64 image have been smoke-tested; K3D deployment and a full release image remain future work.

For isolated tests, start a disposable MySQL instance with an empty root password accessible only on loopback, then set `COKE_GROK_TEST_MYSQL_PORT` and run `npm run test:auth` and `npm run test:mysql`. Tests create and drop their own randomly named databases. Never point them at an existing shared database server.

## Browser integration

Set `VITE_REQUIRE_AUTH=true` when starting or building the frontend to enable the login gate; without it the app is an unauthenticated visual-research preview. For local Vite development, set `VITE_AUTH_PROXY_TARGET` to the local auth service URL. Configure `COKE_GROK_PUBLIC_ORIGIN` to the browser-facing Vite URL, not the backend port. For a prefix such as `/grok-bot/`, set `VITE_BASE_PATH=/grok-bot/` and `COKE_GROK_PUBLIC_ORIGIN` to the origin plus `/grok-bot`; the proxy must preserve the prefix, and Google must register the prefixed callback. A production reverse proxy must route both the frontend and auth paths under the same origin and preserve any prefix. `VITE_REQUIRE_AUTH` is embedded at build time and is not an authorization boundary by itself. The API must enforce authorization independently.

Preview data is scoped by tenant and user IDs in browser localStorage to avoid accidental display when switching accounts. It is not secure storage, server-persisted data, or a substitute for backend authorization: other scripts or users with access to the browser profile can inspect it. Actual Bot data must be stored and authorized on the server.

`npm run test:auth-browser` uses a local simulated identity provider but real Chromium, the frontend proxy, the HTTP auth service and disposable MySQL. It checks login, refresh, sign-out and account switching in one browser profile. It does not contact Google and is not live OAuth acceptance.

To test prefix routing, run `COKE_GROK_TEST_BASE=/grok-bot/ npm run test:auth-browser` with the disposable MySQL test port set. The browser test checks the callback, cookie path, session recovery and account switching through the prefixed route.

## Google OAuth network access

`COKE_GROK_GOOGLE_OAUTH_PROXY_URL` optionally sets a dedicated HTTP(S) proxy origin for the Google client transporter. It must not contain credentials, a path, query, or fragment. This setting applies to Google token exchange and certificate retrieval; it does not modify the machine's global proxy. One-use authorization-code exchanges have retries disabled. `npm run test:google-proxy` checks proxy configuration and proves a failed proxied exchange is attempted only once with a local simulated proxy.

On 2026-10-28, direct access from this Mac to Google's OpenID configuration timed out, while the existing loopback HTTP proxy returned HTTP 200. A loopback address inside a K3D Pod refers to the Pod itself, not the Mac; a separately configured and restricted host-accessible endpoint must be tested from the Pod before deploying there. No live Google sign-in has yet been verified.

## Auth runtime image

Build the frontend first if needed, then run `npm run build:server` followed by `docker build -f Dockerfile.auth -t coke-grok-auth:<version> .`. Vite's frontend build clears `dist`, so build the auth bundle after it. The image runs as the non-root `node` user and includes the bundled auth service only; it does not serve the frontend. Secret files must be readable by that UID and have no group or other permissions. For K3D, provision appropriately owned private files rather than assuming default projected Secret permissions satisfy this requirement. Do not put secret values in the build context, image, or Docker environment.

The bundle and local ARM64 image were tested against a disposable MySQL instance using a synthetic OAuth client. `COKE_GROK_TEST_IMAGE=coke-grok-auth:local-test npm run test:bundle` runs the image test with a disposable test MySQL port set; the ordinary `npm run test:bundle` tests the host bundle. These checks do not prove real OAuth, browser login, K3D deployment, persistent storage, public access, or release rollback.
