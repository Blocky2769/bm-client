// Konekt Wallet client — stored-value credit on the BM Core API (the IdP). Lets
// unbanked users pay from wallet credit (cashed in at a Konekt agent) and lets
// payees receive + cash out. The app id (from configureBm) drives the per-app
// fee_rate on the server. `isWallet` lives in config.js (true when an IdP URL is set).
import { bmConfig } from './config.js';
import { getToken } from './auth.js';

async function call(path, { method = 'GET', body } = {}) {
  const BASE = bmConfig().idpUrl;
  if (!BASE) throw new Error('BM IdP URL is not configured (configureBm)');
  const tok = await getToken();
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `wallet ${r.status}`);
  return d;
}

// The logged-in user's own wallet balance.
export const balance = () => call('/wallet/balance');

// A payee wallet's balance (e.g. an owner receiving rent).
export const payeeBalance = owner => call('/wallet/payee-balance?owner=' + encodeURIComponent(owner));

// Pay `amount` from the caller's wallet to `payee`, tagged with `ref`. The
// server applies the app fee_rate keyed on the configured app id.
export const pay = (payee, amount, ref) =>
  call('/wallet/pay', { method: 'POST', body: { payee, app: bmConfig().app, amount, ref } });

// Redeem a single-use Konekt voucher into the caller's wallet.
export const redeemVoucher = code =>
  call('/wallet/voucher/redeem', { method: 'POST', body: { code } });
