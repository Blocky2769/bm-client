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
// Every payment carries an idempotency key (`idem`): pass your own (e.g. the
// booking id) so a second tap on "Pay" can never charge twice, or let this make
// one. If the network drops before the answer arrives, the SAME request is sent
// once more — the IdP answers a repeat key with the original payment, never a
// second one. (BM IdP will require `idem` on /wallet/pay; Codex review 8 Nov 2026.)
const newIdem = () => 'pay:' + (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)));
export const pay = async (payee, amount, ref, idem = newIdem()) => {
  const req = { method: 'POST', body: { payee, app: bmConfig().app, amount, ref, idem } };
  try { return await call('/wallet/pay', req); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e; // fetch's network failure; a refusal from the IdP is never retried
    return call('/wallet/pay', req);
  }
};

// Redeem a single-use Konekt voucher into the caller's wallet.
export const redeemVoucher = code =>
  call('/wallet/voucher/redeem', { method: 'POST', body: { code } });

// Bank top-up details (BM IdP 1.8.0+, which forwards the user's own token to BM Pay):
// { crn, billerCode|null, biller_registered, fee_pct, how, swift|null }. `swift` =
// BM's BSP account for paying in from OVERSEAS (international transfer, CRN as the
// reference) — null until BM Pay has it set. Every app shows this via <BankTopUp>.
export const bankTopUp = () => call('/wallet/topup');
// The caller's recent bank top-ups: [{ id, amount_toea, bank_ref, value_date, credited, created_at }].
export const bankTopUpDeposits = () => call('/wallet/topup/deposits').then(d => d.deposits || []);
