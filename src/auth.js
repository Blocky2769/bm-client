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
  if (access && idleExpired()) { access = null; refresh = null; persist(); clearActivity(); }
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
  return call('/auth/request-otp', { phone }); // { ok, expires_in, dev_otp? }
}

export async function verifyOtp(phone, code) {
  const res = await call('/auth/verify-otp', { phone, code, app: bmConfig().app });
  access = res.access_token; refresh = res.refresh_token;
  await bmSignIn(access);  // bridge into a Supabase session before listeners query data
  markActivity();          // start the idle clock for this session
  persist(); notify();
  return { ok: true, claims: decodeJwt(access), user_id: res.user_id };
}

async function doRefresh() {
  if (!refresh) { access = null; persist(); return null; }
  try {
    const res = await call('/auth/refresh', { refresh_token: refresh });
    access = res.access_token; refresh = res.refresh_token; persist();
    return access;
  } catch { access = null; refresh = null; persist(); notify(); return null; }
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
    throw e;
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
export async function webauthnLogin(email) {
  const { options } = await call('/auth/webauthn/login-options', { email });
  const response = await startAuthentication({ optionsJSON: options });
  const res = await call('/auth/webauthn/login-verify', { email, app: bmConfig().app, response });
  access = res.access_token; refresh = res.refresh_token;
  await bmSignIn(access); markActivity(); persist(); notify();
  return { ok: true, claims: decodeJwt(access), user_id: res.user_id };
}

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

export function logout() { access = null; refresh = null; bmSignOut(); clearActivity(); persist(); notify(); }
