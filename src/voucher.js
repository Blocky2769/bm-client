// Konekt voucher client — routes through the BM Core API (the IdP proxy), which
// forwards to Konekt's Supabase with a service key, so BM JWTs work without a
// Konekt Supabase session. IdP URL comes from configureBm(); `isVoucherEnabled`
// lives in config.js (true when an IdP URL is set).
import { bmConfig } from './config';

async function call(path, { method = 'POST', body, getToken } = {}) {
  const BASE = bmConfig().idpUrl;
  if (!BASE) throw new Error('BM IdP URL is not configured (configureBm)');
  const tok = getToken ? await getToken() : null;
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `konekt-voucher ${r.status}`);
  return d;
}

// Vouchers owned by the authenticated user (IdP derives the phone from the JWT).
export async function myVouchers(getToken) {
  try {
    const d = await call('/wallet/vouchers', { method: 'GET', getToken });
    return d.vouchers || [];
  } catch { return []; }
}

// Transfer a voucher to another phone (cross-app payment). `app` = the sender app.
export const transferVoucher = (code, toPhone, app, note, getToken) =>
  call('/wallet/vouchers/transfer', { body: { code, toPhone, app, note }, getToken });

// Cash out a voucher at a Konekt agent.
export const cashoutVoucher = (code, getToken) =>
  call('/wallet/vouchers/cashout', { body: { code }, getToken });

export const BUNDLE_LABELS = {
  b1: '1 Hour', b2: 'Day Pass', b3: 'Weekly',
  b4: 'Monthly', b5: '14-Day', b6: '28-Day',
};

export const fmtRemaining = (s) => {
  if (!s || s <= 0) return 'Expired';
  const h = Math.floor(s / 3600), d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h left`;
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

export const fmtBytes = (b) => {
  if (b === null || b === undefined) return null;
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  return `${b} B`;
};
