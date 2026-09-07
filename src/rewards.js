// @bm/client/rewards — the shared BM rewards rail (SERVER-SIDE ONLY).
//
// One call mints a Konekt reward voucher for a person from any BM app:
//
//   import { awardVoucher } from '@bm/client/rewards'
//   const r = await awardVoucher({ app: 'rentim', program: 'trade-award-gold', sourceRef: award.id,
//                                  phone: tp.phone, name: tp.name, amountPgk: 20, tier: 'gold' })
//   // → { ok, code: 'ACDE-FGHJ', faceValue: 20, bundle: 'b3', bundleLabel, deduped }
//
// Idempotent on (app, sourceRef) — safe to retry from a cron, a webhook or a
// dashboard button. The voucher lands under the person's phone in Konekt
// ("My Vouchers"), cashable at any Konekt agent or usable for Wi-Fi.
//
// ⚠️ Holds BM_REWARD_KEY: use ONLY from a backend, an edge function or the BM
// Dashboard BFF. Never import this into browser code — a leaked key lets anyone
// mint vouchers. Env (Node `process.env` or Deno `Deno.env`):
//   BM_REWARD_KEY   shared secret (same value as the Konekt function's secret)
//   BM_REWARDS_URL  optional; default = Konekt's award-voucher function
const DEFAULT_URL = 'https://qazbxytdguruuwytnfvj.supabase.co/functions/v1/award-voucher';

function env(name) {
  try { if (typeof Deno !== 'undefined' && Deno.env) return Deno.env.get(name) || ''; } catch { /* not deno */ }
  try { return (globalThis.process && globalThis.process.env && globalThis.process.env[name]) || ''; } catch { return ''; }
}

export class RewardError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

/**
 * Mint a Konekt reward voucher. Throws RewardError on a non-2xx reply.
 * @param {object} o
 * @param {string} o.app        calling app id ('rentim', 'wanpmv', 'hausstap', 'dinau', 'pngx', …)
 * @param {string} o.program    program slug ('trade-award-gold', 'km-100', 'driver-tier-silver', 'referral')
 * @param {string} o.sourceRef  the app's own id for THIS reward (idempotency key)
 * @param {string} o.phone      recipient phone (any format; normalised to PNG digits)
 * @param {number} [o.amountPgk] face value wanted (server picks the matching bundle, capped)
 * @param {string} [o.bundle]   or an explicit Konekt bundle id ('b3')
 * @param {string} [o.tier]     'gold' | 'silver' | 'bronze' | tier name (recorded)
 * @param {string} [o.name]     recipient name (for messages)
 * @param {object} [opts]       { url, key, fetch, timeoutMs }
 */
export async function awardVoucher(o, opts = {}) {
  const url = opts.url || env('BM_REWARDS_URL') || DEFAULT_URL;
  const key = opts.key || env('BM_REWARD_KEY');
  if (!key) throw new RewardError('BM_REWARD_KEY not configured', 0);
  if (!o || !o.app || !o.sourceRef || !o.phone) throw new RewardError('app, sourceRef and phone are required', 0);
  if (!o.bundle && !(Number(o.amountPgk) > 0)) throw new RewardError('amountPgk or bundle is required', 0);
  const f = opts.fetch || globalThis.fetch;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs || 15000) : null;
  try {
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-reward-key': key },
      body: JSON.stringify({ app: o.app, program: o.program || 'reward', sourceRef: String(o.sourceRef), phone: o.phone, name: o.name || null, amountPgk: o.amountPgk, bundle: o.bundle, tier: o.tier || null }),
      signal: ctl ? ctl.signal : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new RewardError(body.error || ('reward_' + res.status), res.status, body);
    return body;
  } finally { if (t) clearTimeout(t); }
}

/** Standard SMS text for a minted reward (EN + Tok Pisin), for the caller to send via /sms/send. */
export function rewardSms({ name, faceValue, code, reason, app = 'Blockchain Melanesia' }) {
  const hi = name ? `Hi ${String(name).split(' ')[0]}! ` : '';
  return `${hi}You earned a K${Number(faceValue).toFixed(0)} Konekt voucher${reason ? ' for ' + reason : ''}: ${code}. Show it at any Konekt agent for Wi-Fi or cash. Yu winim K${Number(faceValue).toFixed(0)} Konekt vausa — ${code}. — ${app}`;
}
