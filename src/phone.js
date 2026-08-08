// Convert a raw input to E.164, stripping the national trunk prefix.
//
// 🚨 The trunk "0" is the whole point of this file. Australians, New Zealanders
// and Britons write their mobile WITH a leading 0 ("0439 978 005"), because 0 is
// the national trunk code — it is dropped in international format. Before
// v1.6.1 this function returned early for anything already starting with a dial
// code, so "+61" + "0439978005" survived as +610439978005: not a real number,
// but long enough to pass isValidPhone(), so the IdP sent an SMS to it and
// Supabase minted a whole separate identity for it. Downstream, bm_phone()
// returned 610439978005 and matched nothing, and the user was told their number
// wasn't registered. PNG mobiles carry no trunk 0, which is why this only ever
// bit the +61/+64/+44 users.
//
// Kept in step with PhoneInput's COUNTRIES list — it is the single source of
// truth for dial codes.
import { COUNTRIES } from './PhoneInput.jsx';

// Longest dial code first so +675 matches before +67 / +6 would.
const BY_DIAL_LEN = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

// Drop leading zeros from the subscriber part. None of the countries we support
// keep a significant leading zero in E.164 (Italy would, and isn't in the list).
export const stripTrunk = national => String(national || '').replace(/^0+/, '');

export function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  const c = BY_DIAL_LEN.find(x => d.startsWith(x.dial));
  if (c) return '+' + c.dial + stripTrunk(d.slice(c.dial.length));
  const n = stripTrunk(d);
  if (n.length === 9 && n.startsWith('4')) return '+61' + n;  // bare AU mobile
  return '+675' + n;                                          // default: PNG
}
