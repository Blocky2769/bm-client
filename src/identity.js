// BM ID identity verification (v1.19.0) — ONE shared check for every BM app
// (Academy exams, Konekt agents, BM Pay limits, Rentim, …). The person proves who
// they are once, in BM ID, and every app gets the same answer.
//
// Two ways in (BM IdP 1.11.0+, contract: bm-identity-contract.md):
//   - SevisPass (PNG's national digital ID) — instant, when the IdP has it configured;
//   - a photo of an ID + a selfie, which BM staff check in BM Dash.
//
// Uses the app's existing BM session token, exactly like wallet.js. App id and IdP
// URL come from configureBm(). The UI is <IdentityCheck> (IdentityCheck.jsx).
//
// 🚨 Status here is for the UI only. Anything with weight (an exam, money, a
// licence) must ask the IdP server-side with POST /identity/lookup.
import { bmConfig } from './config.js';
import { getToken } from './auth.js';

export const IDENTITY_STATUSES = ['none', 'pending', 'verified', 'rejected', 'expired'];
// The photo-ID types a person can pick (`sevispass` is set by the IdP, never sent).
export const ID_TYPES = ['png_nid', 'png_passport', 'png_drivers_licence', 'foreign_passport', 'other_photo_id'];
// The IdP refuses images over 1.5 MB (after base64 decode). We stop a little under
// it on the phone so a person never uploads a photo only to have it bounced.
export const MAX_IDENTITY_JPEG_BYTES = 1_500_000;

// An error from the identity endpoints. `code` is stable, so the UI can show its
// own words in English or Tok Pisin; `message` is the server's text (or a default).
export class IdentityError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
    this.status = status;
  }
}

// HTTP status (+ the server's error text) → a stable code.
function codeFor(status, msg) {
  const m = String(msg || '').toLowerCase();
  if (status === 409) return m.includes('verified') ? 'already_verified' : 'already_pending';
  if (status === 413) return 'too_big';
  if (status === 415) return 'not_jpeg';
  if (status === 429) return 'rate_limited';
  if (status === 503) return m.includes('sevispass') ? 'sevispass_not_ready' : 'not_ready';
  if (status === 401) return 'signed_out';
  if (status === 400) return 'invalid';
  return 'failed';
}

async function call(path, { method = 'GET', body } = {}) {
  const BASE = bmConfig().idpUrl;
  if (!BASE) throw new IdentityError('not_configured', 'BM IdP URL is not configured (configureBm)');
  const tok = await getToken();
  if (!tok) throw new IdentityError('signed_out', 'Sign in to BM ID first', 401);
  let r;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new IdentityError('offline', 'BM ID unreachable — check your connection');
  }
  const d = (await r.json().catch(() => null)) || {};   // a null or non-JSON body (proxy error page) too
  if (!r.ok) {
    const msg = d.error || d.message || `identity ${r.status}`;
    throw new IdentityError(codeFor(r.status, msg), msg, r.status);
  }
  return d;
}

/** The signed-in person's check:
 *  { status, method, id_type, assurance, full_name, dob, verified_at, expires_at,
 *    pending_since, reason, providers: { sevispass: { ready }, document: { ready } } } */
export const identityStatus = () => call('/identity/status');

// Base64 with any `data:…;base64,` prefix removed (the IdP wants the bare string).
const bare = s => String(s || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
// Bytes a base64 string decodes to.
export const base64Bytes = b64 => {
  const s = bare(b64);
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
};

/** Send a photo-ID check. Images are JPEG base64 (resizeToJpeg() makes them).
 *  Resolves { id, status: 'pending' }. Throws IdentityError: already_pending /
 *  already_verified (409), too_big (413), not_jpeg (415), rate_limited (429),
 *  not_ready (503). */
export function submitIdentityDocument({ idType, country, fullName, dob, idNumberLast4, docExpiry, docJpeg, selfieJpeg, app } = {}) {
  if (!ID_TYPES.includes(idType)) return Promise.reject(new IdentityError('invalid', 'Pick the type of ID'));
  const doc = bare(docJpeg), selfie = bare(selfieJpeg);
  if (!doc || !selfie) return Promise.reject(new IdentityError('invalid', 'Both photos are needed'));
  if (base64Bytes(doc) > MAX_IDENTITY_JPEG_BYTES || base64Bytes(selfie) > MAX_IDENTITY_JPEG_BYTES)
    return Promise.reject(new IdentityError('too_big', 'A photo is too big — take it again'));
  const last4 = String(idNumberLast4 || '').trim();
  const body = {
    id_type: idType,
    country: String(country || 'PG').trim().toUpperCase(),
    full_name: String(fullName || '').trim(),
    dob,
    ...(last4 ? { id_number_last4: last4 } : {}),
    ...(docExpiry ? { doc_expiry: docExpiry } : {}),
    doc_jpeg: doc,
    selfie_jpeg: selfie,
    app: app || bmConfig().app,
  };
  return call('/identity/document', { method: 'POST', body });
}

// The current page without ?identity= (the flag the IdP adds after SevisPass).
export function identityReturnUrl(href = typeof window !== 'undefined' ? window.location.href : '') {
  try { const u = new URL(href); u.searchParams.delete('identity'); return u.toString(); }
  catch { return href; }
}

/** Start SevisPass. Resolves the URL to send the browser to — the caller navigates
 *  (window.location.assign(url)). The IdP brings the person back to `returnTo` with
 *  ?identity=verified|failed. Throws IdentityError 'sevispass_not_ready' (503) until
 *  the IdP has SevisPass configured. */
export async function startSevisPass({ returnTo, app } = {}) {
  const d = await call('/identity/sevispass/start', {
    method: 'POST',
    body: { return_to: returnTo || identityReturnUrl(), app: app || bmConfig().app },
  });
  if (!d.url) throw new IdentityError('failed', 'SevisPass did not return a link');
  return d.url;
}

/** Withdraw the person's pending check (so they can send new photos). */
export const withdrawIdentity = () => call('/identity/withdraw', { method: 'POST', body: {} });

/** After SevisPass: read ?identity=verified|failed, remove it from the address bar
 *  (history.replaceState, no reload) and return 'verified' | 'failed' | null. */
export function takeIdentityReturn() {
  if (typeof window === 'undefined') return null;
  try {
    const u = new URL(window.location.href);
    const v = u.searchParams.get('identity');
    if (!v) return null;
    u.searchParams.delete('identity');
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    return v === 'verified' ? 'verified' : 'failed';
  } catch { return null; }
}

// ── Photos on the phone ─────────────────────────────────────────────
// Decode a picked/captured file. createImageBitmap first: it reads iPhone HEIC on
// Safari and applies the EXIF rotation where `imageOrientation` is supported. If it
// can't (older browsers), draw through an <img>, which modern browsers also rotate
// by EXIF (CSS image-orientation: from-image is the default).
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close && bmp.close() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new IdentityError('unreadable', 'This photo could not be opened — take a new one with the camera');
  }
}

const toBlob = (canvas, q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
const blobToBase64 = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(bare(fr.result));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

/** Shrink a photo on the phone (data costs in PNG): longest side ≤ maxPx, JPEG at
 *  `quality`. Resolves bare base64 (no data: prefix). Throws IdentityError
 *  'too_big' if the result is still over 1.5 MB, 'unreadable' if it can't be opened. */
export async function resizeToJpeg(file, maxPx = 1280, quality = 0.8) {
  if (!file) throw new IdentityError('invalid', 'No photo');
  const img = await decode(file);
  try {
    if (!img.w || !img.h) throw new IdentityError('unreadable', 'This photo could not be opened — take a new one with the camera');
    const scale = Math.min(1, maxPx / Math.max(img.w, img.h));
    const w = Math.max(1, Math.round(img.w * scale)), h = Math.max(1, Math.round(img.h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // transparent PNGs → white, not black
    ctx.drawImage(img.src, 0, 0, w, h);
    const blob = await toBlob(canvas, quality);
    if (!blob) throw new IdentityError('unreadable', 'This photo could not be opened — take a new one with the camera');
    if (blob.size > MAX_IDENTITY_JPEG_BYTES) throw new IdentityError('too_big', 'This photo is too big — take it again');
    return await blobToBase64(blob);
  } finally { img.done(); }
}
