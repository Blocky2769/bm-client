// BM Identity Provider client — phone-OTP + email/password/TOTP + WebAuthn/passkey
// + QR device-link. Every successful method bridges into a Supabase session via
// bmSignIn(). App id + IdP URL come from configureBm() (see config.js), so this
// single module serves every BM app.
import { bmConfig, bmSignIn, bmSignOut } from './config';
import { markActivity, clearActivity, idleExpired } from './idle';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

let access = null;
let refresh = null;
let restored = false;
const subs = new Set();

// localStorage key is per-app (matches the apps' existing `${app}_bm_auth`, so
// migrating onto this package does NOT log existing users out).
const lsKey = () => `${bmConfig().app}_bm_auth`;

// Restore the persisted token lazily on first access — configureBm() has run by
// the time anything reads auth state, so the app id (and thus lsKey) is set.
function ensureRestored() {
  if (restored) return;
  restored = true;
  try { const r = localStorage.getItem(lsKey()); if (r) { const o = JSON.parse(r); access = o.access; refresh = o.refresh; } }
  catch { /* ignore */ }
  // A session that idled out while the app was closed must not come back to life
  // on the next open (the stolen-handset case — see idle.js).
  if (access && idleExpired()) { access = null; refresh = null; persist(); clearActivity(); bmSignOut(() => !access); }
}
function persist() {
  try { access ? localStorage.setItem(lsKey(), JSON.stringify({ access, refresh })) : localStorage.removeItem(lsKey()); }
  catch { /* ignore */ }
}

function notify() { subs.forEach(cb => { try { cb(); } catch { /* ignore */ } }); }
export function onAuthChange(cb) { subs.add(cb); return () => subs.delete(cb); }

export function decodeJwt(tok) {
  try {
    const b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(b).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    return JSON.parse(json);
  } catch { return null; }
}
export function currentClaims() { ensureRestored(); return access ? decodeJwt(access) : null; }
export const lastKnownClaims = currentClaims;  // alias used by some apps (Bisnis Stoa)

// Set the caller's display name at the IdP; refreshes so the new token carries
// the `name` claim. Best-effort, returns bool. (Used by Rentim.)
export async function setBmName(name) {
  if (!bmConfig().idpUrl) return false;
  const tok = await getToken();
  if (!tok) return false;
  try {
    const r = await fetch(`${bmConfig().idpUrl}/me/name`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) return false;
    await doRefresh();   // new token includes the name claim
    notify();
    return true;
  } catch { return false; }
}

async function call(path, body, headers = {}) {
  const r = await fetch(`${bmConfig().idpUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `BM IdP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

// phone is already E.164 (the caller normalises it — see toE164/PhoneInput).
export async function requestOtp(phone) {
  // `app` tells the IdP which app is asking, so it can pick the channel
  // (WhatsApp where that app is switched on) and label the delivery record.
  // It only picks the channel: the code still goes to the phone that owns it,
  // and the token's `aud` is set at verify-otp as before.
  // → { ok, expires_in, channel?: 'whatsapp'|'sms', dev_otp? }
  return call('/auth/request-otp', { phone, app: bmConfig().app });
}

// "Send it by SMS instead" — the user's own way out when a WhatsApp code never
// arrives (no data, basic handset). Sends the SAME code, so it can never cost
// more than one extra message, and the IdP allows it once per code after a
// short wait. Returns false when there is nothing to re-send or WhatsApp is not
// in use, so a login screen can simply hide the button.
export async function requestOtpSms(phone) {
  try {
    await call('/auth/request-otp-sms', { phone });
    return true;
  } catch { return false; }
}

export async function verifyOtp(phone, code) {
  const res = await call('/auth/verify-otp', { phone, code, app: bmConfig().app });
  access = res.access_token; refresh = res.refresh_token;
  await bmSignIn(access);  // bridge into a Supabase session before listeners query data
  markActivity();          // start the idle clock for this session
  persist(); notify();
  return { ok: true, claims: decodeJwt(access), user_id: res.user_id };
}

// SINGLE-FLIGHT + cross-instance-safe refresh (20 Oct 2026). The IdP rotates
// refresh tokens (one use, no grace) and access tokens live 15 minutes, so near
// expiry EVERY data call's getToken() wants a refresh at once — in bridge /
// accessToken mode that is every Supabase request. Without a lock, concurrent
// refreshes raced the SAME refresh token: the first won and rotated it, every
// loser got 401 invalid-refresh and wiped the session — the app "randomly"
// logged the user out mid-task (found live 20 Oct: Konekt logged Concillia out
// right after a successful Dinau repayment). One refresh now runs at a time and
// everyone awaits it; and before giving up we re-read localStorage, because an
// installed PWA and a browser tab of the same app SHARE that storage — the
// other instance may have already rotated and saved newer tokens we can adopt.
//
// v1.18.1 (23 Oct 2026, Bisnis Stoa review batch B): only a refresh the IdP REFUSED ends the sign-in (400/401/403: the refresh token is invalid,
// already used or revoked). A refresh that could not be MADE - no signal, a timeout, the IdP down (5xx) - used to end it too, so a till phone
// was signed out whenever its 15-minute token ran out in a weak-signal spot (and, from this release, its cloud session with it). Now the
// sign-in is kept, getToken() just has no fresh token for now, and the next call tries again.
const refused = err => !!err && [400, 401, 403].includes(err.status);
// A reply that does not carry BOTH tokens is not a renewal (a captive-portal page, a proxy, a half-deployed IdP answering 200 with something else).
// Accepting it wiped the tokens and ended the sign-in without a word: it is treated like any other failed attempt instead.
const goodPair = r => !!r && typeof r.access_token === 'string' && !!r.access_token && typeof r.refresh_token === 'string' && !!r.refresh_token;
const unreadable = () => Object.assign(new Error('The sign-in service sent a reply with no tokens'), { status: 0 });
let refreshing = null;
function doRefresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!refresh) { access = null; persist(); return null; }
    const used = refresh;
    try {
      const res = await call('/auth/refresh', { refresh_token: used });
      if (!goodPair(res)) throw unreadable();
      access = res.access_token; refresh = res.refresh_token; persist();
      return access;
    } catch (err) {
      // Another instance of this app (PWA vs tab) may have rotated first and
      // persisted the new pair — adopt it instead of logging the user out.
      try {
        const r = localStorage.getItem(lsKey());
        if (r) {
          const o = JSON.parse(r);
          if (o && o.access && o.refresh && o.refresh !== used) {
            const c = decodeJwt(o.access);
            if (c && c.exp && c.exp > Math.floor(Date.now() / 1000) + 30) {
              access = o.access; refresh = o.refresh;
              return access;
            }
            access = o.access; refresh = o.refresh;
            // awaited: `refreshing` must stay set until the retry is DONE, or a second caller starts its own refresh with the very token the retry is
            // sending (a single-use token sent twice is refused the second time) - final review of 23 Oct 2026
            return await doRefreshAgain();
          }
        }
      } catch { /* fall through */ }
      if (!refused(err)) return null;   // no signal / IdP down: the sign-in stays, there is just no fresh token right now
      access = null; refresh = null; persist(); notify(); return null;
    } finally { refreshing = null; }
  })();
  return refreshing;
}
// One retry with tokens adopted from another instance (never recurses further:
// a second failure falls through to the signed-out state above).
async function doRefreshAgain() {
  if (!refresh) { access = null; persist(); return null; }
  try {
    const res = await call('/auth/refresh', { refresh_token: refresh });
    if (!goodPair(res)) throw unreadable();
    access = res.access_token; refresh = res.refresh_token; persist();
    return access;
  } catch (err) {
    if (!refused(err)) return null;
    access = null; refresh = null; persist(); notify(); return null;
  }
}

// Current BM JWT for API calls / the Supabase accessToken option.
export async function getToken() {
  ensureRestored();
  if (!access) return null;
  // Defence in depth: never hand out a token for an idled-out session. In
  // accessToken mode this runs on every Supabase request.
  if (idleExpired()) { logout(); return null; }
  const c = decodeJwt(access);
  if (c && c.exp && c.exp - Math.floor(Date.now() / 1000) < 60) return doRefresh();
  return access;
}

// ── Non-phone identity (email+password+TOTP, WebAuthn) + QR device-link ────
export async function registerEmail(email, password, name) {
  const res = await call('/auth/register-email', { email, password, name, app: bmConfig().app });
  access = res.access_token; refresh = res.refresh_token;
  await bmSignIn(access); markActivity(); persist(); notify();
  return { ok: true, claims: decodeJwt(access), user_id: res.user_id };
}
export async function loginEmail(email, password) {
  const res = await call('/auth/login-email', { email, password, app: bmConfig().app });
  access = res.access_token; refresh = res.refresh_token;
  await bmSignIn(access); markActivity(); persist(); notify();
  return { ok: true, claims: decodeJwt(access), user_id: res.user_id };
}

// Google-Authenticator TOTP. 404 = endpoint not deployed (honest `missing`);
// 409 totp_not_enrolled = account has no authenticator yet.
export async function enrolTotp(currentCode) {
  return call('/mfa/totp/enrol', currentCode ? { code: currentCode } : {}, { authorization: 'Bearer ' + access });
}
export async function verifyTotp(code) {
  try {
    const res = await call('/mfa/totp/verify', { code }, { authorization: 'Bearer ' + access });
    access = res.access_token; refresh = res.refresh_token; markActivity(); persist(); notify();
    return { ok: true };
  } catch (e) {
    if (e.status === 404) return { ok: false, missing: true };
    if (e.status === 409) return { ok: false, notEnrolled: true };
    // 401 bad_totp_code — the everyday case (mistyped, or the 30s window
    // rolled while typing). This used to RETHROW, and every app's Rentim-
    // lineage submitTotp has no try/catch around it, so one wrong code froze
    // the login button on "Checking…" forever (found live by Chris in Dinau
    // Buk, 30 Sep 2026). verifyTotp now NEVER throws: callers branch on the
    // returned shape and their existing else-path shows "wrong code".
    if (e.status === 401) return { ok: false, badCode: true };
    return { ok: false, error: e.message || 'network error' };
  }
}

// Passkey. Omit `email` to add a passkey to the current account; pass it for a
// brand-new passkey-first signup.
export async function webauthnRegister(email) {
  const auth = access ? { authorization: 'Bearer ' + access } : {};
  const { options } = await call('/auth/webauthn/register-options', access ? {} : { email }, auth);
  const response = await startRegistration({ optionsJSON: options });
  const res = await call('/auth/webauthn/register-verify', { email, app: bmConfig().app, response }, auth);
  access = res.access_token; refresh = res.refresh_token;
  await bmSignIn(access); markActivity(); persist(); notify();
  return { ok: true, claims: decodeJwt(access), user_id: res.user_id };
}
// Sign in with a passkey. `email` is OPTIONAL: without it the browser offers any BM passkey saved on this device (discoverable
// credential) and the credential itself says whose account it is. The IdP's challenge_id ties the options to the verify call.
// Only works on a page whose address ends in the passkey domain (blockchainmelanesia.com) — see `passkeysAvailable()`.
export async function webauthnLogin(email) {
  const { options, challenge_id } = await call('/auth/webauthn/login-options', email ? { email } : {});
  const response = await startAuthentication({ optionsJSON: options });
  const res = await call('/auth/webauthn/login-verify', { email: email || undefined, app: bmConfig().app, response, challenge_id });
  access = res.access_token; refresh = res.refresh_token;
  await bmSignIn(access); markActivity(); persist(); notify();
  return { ok: true, claims: decodeJwt(access), user_id: res.user_id };
}
// Passkeys are bound to blockchainmelanesia.com: a page on netlify.app (or another domain) cannot use them.
export const passkeysAvailable = (host = typeof location !== 'undefined' ? location.hostname : '') =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && (host === 'blockchainmelanesia.com' || host.endsWith('.blockchainmelanesia.com') || host === 'localhost');   // localhost: local IdP with BM_RP_ID=localhost
// The IdP's hosted page where a signed-in person adds a passkey to their account (needs a fresh code sign-in there).
export const passkeyAddUrl = () => `${bmConfig().idpUrl.replace(/\/$/, '')}/passkey`;

// QR device-link: an unauthenticated device starts + polls; an authenticated
// device (on /pair) approves.
export async function startQrPairing() {
  const res = await call('/auth/qr/start', { app: bmConfig().app });
  return { pairingId: res.pairing_id, qrValue: `${window.location.origin}/pair?pid=${res.pairing_id}`, expiresIn: res.expires_in };
}
export async function pollQrPairing(pairingId, { intervalMs = 2000, timeoutMs = 120000, signal } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) return false;
    const r = await fetch(`${bmConfig().idpUrl}/auth/qr/poll?pairing_id=${encodeURIComponent(pairingId)}&app=${bmConfig().app}`);
    if (r.status === 404) return false; // expired
    const data = await r.json().catch(() => ({}));
    if (data.status === 'approved') {
      access = data.access_token; refresh = data.refresh_token;
      await bmSignIn(access); markActivity(); persist(); notify();
      return true;
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return false;
}
export async function approveQrPairing(pairingId) {
  if (!access) return { ok: false, error: 'not_logged_in' };
  return call('/auth/qr/approve', { pairing_id: pairingId }, { authorization: 'Bearer ' + access });
}

// Redirect mode (Supabase custom OIDC — oidc.js): the BM IdP gives Supabase an access + refresh token at
// sign-in (IdP 1.9.0+), and Supabase hands them to the app once (session.provider_token /
// provider_refresh_token). Adopting them here makes getToken() work in redirect-mode apps too, so BM APIs
// (bank + SWIFT top-up card, wallet) see the user as signed in. dropBmTokens() on Supabase sign-out.
export function adoptBmTokens(acc, ref) {
  ensureRestored();
  if (!acc || acc === access) return;
  access = acc; if (ref) refresh = ref;
  markActivity(); persist(); notify();
}
export function dropBmTokens() {
  ensureRestored();
  if (!access && !refresh) return;
  access = null; refresh = null; persist(); notify();
}

// Sign out. Besides forgetting the tokens here, tell the IdP to revoke the refresh token (v1.18.0, independent login review 21 Oct
// 2026: a refresh token copied before "logout" used to stay valid for 30 days). Best effort and never awaited: an old IdP
// without /auth/logout, or no network, just leaves things as they were.
function revokeAtIdp(rt, at, all) {
  try {
    const base = bmConfig().idpUrl;
    if (!base || (!rt && !all)) return;
    fetch(`${base}/auth/logout`, {
      method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json', ...(all && at ? { authorization: 'Bearer ' + at } : {}) },
      body: JSON.stringify({ ...(rt ? { refresh_token: rt } : {}), ...(all ? { all: true } : {}) }),
    }).catch(() => { /* offline / old IdP */ });
  } catch { /* never block a logout */ }
}
export function logout() { const rt = refresh; revokeAtIdp(rt, null, false); access = null; refresh = null; bmSignOut(() => !access); clearActivity(); persist(); notify(); }
// "Sign out everywhere" (a lost or borrowed phone): revokes EVERY refresh token of this person at the IdP, then signs out here.
export function logoutEverywhere() { const rt = refresh, at = access; revokeAtIdp(rt, at, true); access = null; refresh = null; bmSignOut(() => !access, 'global'); clearActivity(); persist(); notify(); }
