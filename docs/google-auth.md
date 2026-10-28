# Google identity API (in progress)

This backend implements the server-side Google OpenID Connect authorization-code flow described in [Google's documentation](https://developers.google.com/identity/openid-connect/openid-connect), with state, nonce and PKCE, MySQL-backed one-use flows and server-side sessions. The frontend remains a local-only preview; an opt-in authentication mode integrates these endpoints. Mock identity-provider tests are not proof of a live Google login.

The service uses `COKE_GROK_PUBLIC_ORIGIN` (an HTTPS origin, or HTTP loopback for development), `COKE_GROK_GOOGLE_CLIENT_ID`, `COKE_GROK_GOOGLE_SECRET_FILE`, `COKE_GROK_MYSQL_HOST`, `COKE_GROK_MYSQL_PORT` (default 3306), `COKE_GROK_MYSQL_USER`, `COKE_GROK_MYSQL_PASSWORD_FILE`, and `COKE_GROK_MYSQL_DATABASE`. Secret files must be private (no group/other permissions). It binds to `127.0.0.1:3001` by default; `COKE_GROK_AUTH_HOST` and `COKE_GROK_AUTH_PORT` override this. Run `npm run start:auth`. The database must already exist; startup creates the identity tables. The Google OAuth client must register the exact callback `<origin>/auth/google/callback`.

A trusted reverse proxy must preserve the public Host, terminate HTTPS, and route `/api/auth/` and `/auth/google/callback` to this service. Do not log callback query strings or cookies. Do not expose this service publicly until its deployment, secrets, origin, and browser flow have been verified. The runtime currently uses the development `tsx` dependency; a production image and K3D deployment remain future work.

For isolated tests, start a disposable MySQL instance with an empty root password accessible only on loopback, then set `COKE_GROK_TEST_MYSQL_PORT` and run `npm run test:auth` and `npm run test:mysql`. Tests create and drop their own randomly named databases. Never point them at an existing shared database server.

## Browser integration

Set `VITE_REQUIRE_AUTH=true` when starting or building the frontend to enable the login gate; without it the app is an unauthenticated visual-research preview. For local Vite development, set `VITE_AUTH_PROXY_TARGET` to the local auth service URL. Configure `COKE_GROK_PUBLIC_ORIGIN` to the browser-facing Vite origin, not the backend port. A production reverse proxy must route both the frontend and auth paths under the same origin. `VITE_REQUIRE_AUTH` is embedded at build time and is not an authorization boundary by itself. The API must enforce authorization independently.

Preview data is scoped by tenant and user IDs in browser localStorage to avoid accidental display when switching accounts. It is not secure storage, server-persisted data, or a substitute for backend authorization: other scripts or users with access to the browser profile can inspect it. Actual Bot data must be stored and authorized on the server.

`npm run test:auth-browser` uses a local simulated identity provider but real Chromium, the frontend proxy, the HTTP auth service and disposable MySQL. It checks login, refresh, sign-out and account switching in one browser profile. It does not contact Google and is not live OAuth acceptance.
