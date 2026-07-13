// Best-effort convert a raw input to E.164. PNG (+675) default; an AU mobile
// (9 digits starting 4) → +61; a number already carrying 675/61 is kept.
// Mostly idempotent now that PhoneInput emits E.164, but a safety net for
// free-text entry.
export function toE164(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('675')) return '+' + d;
  if (d.startsWith('61')) return '+' + d;
  d = d.replace(/^0+/, '');
  if (d.length === 9 && d.startsWith('4')) return '+61' + d;
  return '+675' + d;
}
