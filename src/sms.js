// Shared transactional SMS — sends via the IdP's /sms/send with the caller's BM
// JWT (receipts, reminders, voucher codes). Best-effort and NEVER throws:
// transactional SMS must not break a payment/reminder flow. No-ops when there's
// no IdP configured or the user isn't BM-authenticated. `isSms` lives in config.js.
// Exported as both `send` (Rentim) and `sendSms` (Konekt) so either name works.
import { bmConfig } from './config.js';
import { getToken } from './auth.js';

export async function send(to, text) {
  const BASE = bmConfig().idpUrl;
  if (!BASE || !to || !text) return false;
  try {
    const tok = await getToken();
    if (!tok) return false;                 // only BM-authenticated users can send
    const r = await fetch(BASE + '/sms/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify({ to, text, app: bmConfig().app }),
    });
    return r.ok;
  } catch { return false; }
}

// Alias — Konekt/some apps import this name.
export const sendSms = send;
