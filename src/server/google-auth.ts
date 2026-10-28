import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { TenantStore } from './tenant-store.ts';
import { parsePublicUrl } from './public-url.ts';

// Google OIDC flow adapted from Coke Dots origin/main 4213e769e49da7a479ab2ad186584c77b721fa69.
type Claims = { sub?: string; email?: string; email_verified?: boolean; name?: string; nonce?: string };
export interface IdentityProvider {
  authorizationUrl(state: string, nonce: string, challenge: string): string;
  exchange(code: string, verifier: string): Promise<Claims>;
}
export class GoogleIdentityProvider implements IdentityProvider {
  private client: OAuth2Client;
  constructor(private clientId: string, secret: string, private callback: string, proxyUrl = '') {
    const proxy = parseGoogleProxy(proxyUrl);
    this.client = new OAuth2Client({ clientId, clientSecret: secret, redirectUri: callback, transporterOptions: { timeout: 15000, ...(proxy ? { proxy } : {}) } });
    const original = this.client.transporter.request.bind(this.client.transporter);
    this.client.transporter.request = options => {
      if (options?.method?.toUpperCase() === 'POST' && options.url && new URL(String(options.url)).pathname.endsWith('/token')) return original({ ...options, retry: false, retryConfig: { retry: 0, httpMethodsToRetry: [] } });
      return original(options);
    };
  }
  authorizationUrl(state: string, nonce: string, challenge: string): string {
    const url = new URL(this.client.generateAuthUrl({ response_type: 'code', access_type: 'online', scope: ['openid', 'email', 'profile'], state, code_challenge: challenge, code_challenge_method: CodeChallengeMethod.S256, prompt: 'select_account' }));
    url.searchParams.set('nonce', nonce); return url.toString();
  }
  async exchange(code: string, verifier: string): Promise<Claims> {
    const { tokens } = await this.client.getToken({ code, codeVerifier: verifier, redirect_uri: this.callback });
    if (!tokens.id_token) throw new Error('Missing identity token');
    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.clientId });
    return ticket.getPayload() || {};
  }
}
export function parseGoogleProxy(configured: string): string {
  if (!configured.trim()) return '';
  try {
    const proxy = new URL(configured.trim());
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error();
    return proxy.origin;
  } catch { throw new Error('Google OAuth proxy must be an HTTP(S) origin without credentials or a path'); }
}
const sessionCookie = 'coke_grok_session';
const stateCookie = 'coke_grok_oauth_state';
const token = () => randomBytes(32).toString('base64url');
const hash = (input: string) => createHash('sha256').update(input).digest('hex');
const cookies = (header: string): Record<string,string> => Object.fromEntries(header.split(';').map(part => part.trim().split(/=(.*)/s).slice(0,2)).filter(parts => parts.length === 2));
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function appendCookie(res: ServerResponse, value: string) { const previous = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [String(previous)] : []), value]); }
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function redirect(res: ServerResponse, url: string) { res.writeHead(302, { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); }

export class GoogleAuthService {
  private origin: string;
  private secure: boolean;
  private baseUrl: string;
  private prefix: string;
  constructor(private store: TenantStore, private provider: IdentityProvider, publicUrl: string) {
    const url = parsePublicUrl(publicUrl);
    this.origin = url.origin; this.baseUrl = url.baseUrl; this.prefix = url.prefix; this.secure = url.secure;
  }
  private setCookie(res: ServerResponse, name: string, value: string, age: number, path: string) {
    appendCookie(res, `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${age}${this.secure ? '; Secure' : ''}`);
  }
  async ready(): Promise<void> { await this.store.ready(); }
  async begin(res: ServerResponse) {
    const state = token(), nonce = token(), verifier = token();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.store.createOAuthFlow({ stateHash: hash(state), nonce, codeVerifier: verifier, expiresAt: new Date(Date.now() + 600000) });
    this.setCookie(res, stateCookie, hash(state), 600, `${this.prefix}/auth/google/callback`);
    redirect(res, this.provider.authorizationUrl(state, nonce, challenge));
  }
  async finish(req: IncomingMessage, res: ServerResponse, url: URL) {
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
    const cookie = cookies(req.headers.cookie || '')[stateCookie] || '';
    this.setCookie(res, stateCookie, '', 0, `${this.prefix}/auth/google/callback`);
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[a-f0-9]{64}$/.test(cookie) || !same(hash(state), cookie)) return redirect(res, `${this.baseUrl}/?authError=invalid`);
    const flow = await this.store.consumeOAuthFlow(hash(state));
    if (!flow || !code || code.length > 4096 || url.searchParams.has('error')) return redirect(res, `${this.baseUrl}/?authError=cancelled`);
    try {
      const identity = await this.provider.exchange(code, flow.codeVerifier);
      if (!identity.sub || !identity.email || identity.email_verified !== true || identity.nonce !== flow.nonce) return redirect(res, `${this.baseUrl}/?authError=invalid_identity`);
      const account = await this.store.signInGoogle({ subject: identity.sub, email: identity.email, name: identity.name || identity.email });
      const session = token();
      const oldSession = cookies(req.headers.cookie || '')[sessionCookie] || '';
      await this.store.replaceSession(hash(session), account.userId, account.tenantId, new Date(Date.now() + 30 * 86400000), /^[A-Za-z0-9_-]{43}$/.test(oldSession) ? hash(oldSession) : undefined);
      this.setCookie(res, sessionCookie, session, 30 * 86400, `${this.prefix}/`); redirect(res, `${this.baseUrl}/`);
    } catch { redirect(res, `${this.baseUrl}/?authError=sign_in_failed`); }
  }
  async me(req: IncomingMessage, res: ServerResponse) {
    const value = cookies(req.headers.cookie || '')[sessionCookie] || '';
    const session = /^[A-Za-z0-9_-]{43}$/.test(value) ? await this.store.getSession(hash(value)) : null;
    return json(res, session ? 200 : 401, session || { error: 'Unauthenticated' });
  }
  async logout(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.origin !== this.origin) return json(res, 403, { error: 'Invalid origin' });
    const value = cookies(req.headers.cookie || '')[sessionCookie] || '';
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) await this.store.removeSession(hash(value));
    this.setCookie(res, sessionCookie, '', 0, `${this.prefix}/`); return json(res, 200, { ok: true });
  }
}
