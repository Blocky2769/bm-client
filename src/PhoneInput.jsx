import { useState, useEffect, useMemo } from 'react';

// Country-code selector + national-number input that always emits a full E.164
// string (e.g. "+67571619316"). PNG users default to +675; diaspora pick their
// country so AU/NZ/US/etc. numbers carry the right code (never guessed as +675).
//
//   <PhoneInput label="Phone number" value={phone} onChange={setPhone} onEnter={send} />
// `value` is the E.164 string; `onChange(e164)` fires on every edit.
export const COUNTRIES = [
  { code: 'PG', name: 'Papua New Guinea', dial: '675', flag: '🇵🇬', min: 7 },
  { code: 'AU', name: 'Australia',        dial: '61',  flag: '🇦🇺', min: 9 },
  { code: 'NZ', name: 'New Zealand',      dial: '64',  flag: '🇳🇿', min: 8 },
  { code: 'US', name: 'United States',    dial: '1',   flag: '🇺🇸', min: 10 },
  { code: 'GB', name: 'United Kingdom',   dial: '44',  flag: '🇬🇧', min: 9 },
  { code: 'FJ', name: 'Fiji',             dial: '679', flag: '🇫🇯', min: 7 },
  { code: 'SB', name: 'Solomon Islands',  dial: '677', flag: '🇸🇧', min: 7 },
  { code: 'VU', name: 'Vanuatu',          dial: '678', flag: '🇻🇺', min: 7 },
];

// Longest dial-code first so e.g. +675 matches before +6 / +67 would.
const BY_DIAL_LEN = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

// Split an E.164 string into { dial, national }. Defaults to PNG when unknown.
export function splitE164(value) {
  const d = (value || '').replace(/\D/g, '');
  const c = BY_DIAL_LEN.find(x => d.startsWith(x.dial));
  return c ? { dial: c.dial, national: d.slice(c.dial.length) } : { dial: '675', national: d };
}

// Loose validity: national part long enough for the selected country.
export function isValidPhone(value) {
  const { dial, national } = splitE164(value);
  const c = COUNTRIES.find(x => x.dial === dial);
  return national.length >= (c ? c.min : 7);
}

export default function PhoneInput({ value, onChange, onEnter, label, dark = false, autoFocus = false, id }) {
  const { dial: derivedDial, national } = useMemo(() => splitE164(value), [value]);
  const [dial, setDial] = useState(derivedDial);

  // Sync dial from value when value has actual digits (e.g. parent resets the field)
  useEffect(() => { if (national) setDial(derivedDial); }, [derivedDial, national]);

  const emit = (nextDial, nextNational) => {
    setDial(nextDial);
    const n = (nextNational || '').replace(/\D/g, '');
    onChange(n ? `+${nextDial}${n}` : '');
  };

  const wrapCls = dark
    ? 'bg-gray-800 border-2 border-gray-700 focus-within:border-purple-600'
    : 'bg-white border border-gray-300 focus-within:border-gray-900 focus-within:ring-2 focus-within:ring-gray-900/10';
  const textCls = dark ? 'text-white placeholder:text-gray-500' : 'text-gray-900 placeholder:text-gray-400';

  return (
    <div className="block">
      {label && <span className={`block text-xs font-semibold ${dark ? 'text-gray-400' : 'text-gray-700'} mb-1`}>{label}</span>}
      <div className={`flex items-stretch rounded-xl transition-colors ${wrapCls}`}>
        <select
          aria-label="Country"
          value={dial}
          onChange={e => emit(e.target.value, national)}
          className={`bg-transparent ${dark ? 'text-white' : 'text-gray-900'} pl-3 pr-1 py-2.5 text-sm font-medium focus:outline-none cursor-pointer`}
        >
          {COUNTRIES.map(c => (
            <option key={c.code} value={c.dial}>{c.flag} +{c.dial}</option>
          ))}
        </select>
        <input
          id={id}
          value={national}
          onChange={e => emit(dial, e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onEnter && onEnter()}
          inputMode="tel"
          autoFocus={autoFocus}
          placeholder="Phone number"
          className={`flex-1 min-w-0 bg-transparent ${textCls} pr-3 py-2.5 text-sm focus:outline-none`}
        />
      </div>
    </div>
  );
}
