// <IdentityCheck> — the standard "Confirm who you are" card (BM ID identity
// verification, v1.19.0). One check in BM ID, shared by every BM app: verify with
// SevisPass (PNG's national digital ID) when BM ID has it, or send a photo of an ID
// plus a selfie, which BM staff check.
//
//   import { IdentityCheck } from '@bm/client';            // or '@bm/client/identity'
//   <IdentityCheck lang={lang} onVerified={s => …} />      // lang: 'en' | 'tpi' (or 'tp')
//   <IdentityCheck lang={lang} compact />                  // one slim line until the person taps Verify
//
// Props: app (defaults to configureBm's app id), lang, onVerified(status) — called
// when the status is (or becomes) verified, compact, style.
// Inline styles only, so it looks right in Tailwind and plain-CSS apps alike.
// Renders nothing when signed out. Photos live in memory only — never localStorage.
//
// 🚨 The status shown here is a UI hint. Anything with weight (an exam, money, a
// licence) must check server-side with the IdP's POST /identity/lookup.
import { useCallback, useEffect, useRef, useState } from 'react';
import { identityStatus, submitIdentityDocument, startSevisPass, withdrawIdentity, takeIdentityReturn,
  identityReturnUrl, resizeToJpeg, ID_TYPES } from './identity.js';
import { getToken } from './auth.js';
import { bmConfig } from './config.js';
import { syncBmFromSession } from './oidc.js';

export * from './identity.js';   // one import: `from '@bm/client/identity'`

const T = {
  en: {
    title: 'Confirm who you are', sub: 'One check in BM ID, for every BM app',
    loading: 'Loading…', relogin: 'Sign out and sign in again to check your identity.',
    noneIntro: 'Some things (for example an official exam) need us to know it is really you. You only do this once — every BM app uses the same check.',
    sevis: 'Verify with SevisPass', sevisSub: 'Instant, with PNG’s national digital ID',
    doc: 'Use a photo ID', docSub: 'A photo of your ID and a selfie. BM staff check it by hand.',
    closed: 'Identity checks open soon.',
    verified: 'Identity verified', verifiedBy: 'Confirmed with {how}', viaSevis: 'SevisPass', viaDoc: 'a photo ID checked by BM staff',
    validUntil: 'Valid until {date}',
    pending: 'We are checking your photos', pendingSub: 'BM staff check every ID by hand. You can keep using the app and come back here later.',
    sentOn: 'Sent {date}', refresh: 'Check again', withdraw: 'Cancel this check',
    withdrawAsk: 'Cancel this check? You can send new photos straight after.', withdrawYes: 'Yes, cancel it', keep: 'No, keep it',
    rejected: 'We could not confirm your ID', reasonLbl: 'Reason', tryAgain: 'Try again',
    expired: 'Your ID check has run out', expiredSub: 'It ran out on {date}. Check again to keep using things that need it.', checkAgain: 'Check again',
    retSevisOk: 'SevisPass is done.', retSevisFail: 'SevisPass could not confirm you. Try again, or use a photo ID.',
    view: 'View', verify: 'Verify', lName: 'Name', lDob: 'Born', lLast4: 'Last 4', lExpiry: 'Expires',
    stepOf: 'Step {n} of 4', back: 'Back', next: 'Next', cancel: 'Cancel',
    s1: 'Your ID', s2: 'Photo of your ID', s3: 'Selfie', s4: 'Check and send',
    idType: 'Which ID do you have?',
    t_png_nid: 'PNG National ID card (NID)', t_png_passport: 'PNG passport', t_png_drivers_licence: 'PNG driver’s licence',
    t_foreign_passport: 'Passport from another country', t_other_photo_id: 'Other photo ID with your name and photo',
    country: 'Country that issued it', countryOther: 'Other country', countryCode: 'Country code (2 letters, e.g. DE)',
    name: 'Your name, exactly as on the ID', dob: 'Date of birth',
    last4: 'Last 4 digits of the ID number (optional)', expiry: 'Expiry date (optional)', optional: 'optional',
    docHow: 'Put the ID on a flat surface in good light. Fit the whole card (or the passport photo page) in the photo. Make sure the words are sharp, with no glare.',
    docTake: 'Take a photo of your ID',
    selfieHow: 'Use the front camera. Face the camera in good light, holding nothing — no ID, no phone in view. No hat or sunglasses.',
    selfieTake: 'Take a selfie',
    retake: 'Retake', working: 'Getting the photo ready…',
    previewDoc: 'Your ID photo', previewSelfie: 'Your selfie',
    consent: 'BM staff check your photos to confirm who you are. Your ID photo is deleted 90 days after the check. Your selfie is kept while your check is valid, so apps you use (for example an exam) can confirm it is you.',
    agree: 'I agree, and these are my own ID and my own face.',
    send: 'Send for checking', sending: 'Sending…',
    needType: 'Pick the type of ID.', needCountry: 'Pick the country that issued it.', needName: 'Type your name as it is on the ID.',
    needDob: 'Enter your date of birth.', dobBad: 'Check your date of birth.', last4Bad: 'The last 4 should be 4 letters or numbers.',
    docExpired: 'This ID has expired. Use an ID that is still valid.', needPhoto: 'Take the photo first.', needAgree: 'Tick the box to agree.',
    e_already_pending: 'You already have a check waiting. We will finish that one first.',
    e_already_verified: 'You are already verified.',
    e_too_big: 'That photo is too big. Take it again, a little further away.',
    e_not_jpeg: 'That photo could not be used. Take it again with the camera.',
    e_unreadable: 'That photo could not be opened. Take a new one with the camera.',
    e_rate_limited: 'Too many tries today. Please wait and try again tomorrow.',
    e_not_ready: 'Photo-ID checks are not open yet. Please try again later.',
    e_sevispass_not_ready: 'SevisPass is not available yet. Use a photo ID instead.',
    e_offline: 'No connection to BM ID. Check your data or Wi-Fi and try again.',
    e_signed_out: 'Please sign in again.',
    e_failed: 'Something went wrong. Please try again.',
  },
  tpi: {
    title: 'Soim yu husat tru', sub: 'Wanpela sek long BM ID, bilong olgeta BM app',
    loading: 'Wetim…', relogin: 'Sain aut na sain in gen bilong sekim ID bilong yu.',
    noneIntro: 'Sampela samting (olsem wanpela ofisel eksem) i nidim mipela long save olsem em yu tru. Yu mekim dispela wanpela taim tasol — olgeta BM app i usim wankain sek.',
    sevis: 'Sekim wantaim SevisPass', sevisSub: 'Kwiktaim, wantaim nesenel dijitel ID bilong PNG',
    doc: 'Usim ID i gat foto', docSub: 'Foto bilong ID bilong yu na wanpela selfi. Ol wokman bilong BM i sekim long han.',
    closed: 'Sek bilong ID i op klostu.',
    verified: 'ID i stret pinis', verifiedBy: 'Soim long {how}', viaSevis: 'SevisPass', viaDoc: 'ID i gat foto we ol wokman bilong BM i sekim',
    validUntil: 'I stap gut inap {date}',
    pending: 'Mipela i wok long sekim ol foto bilong yu', pendingSub: 'Ol wokman bilong BM i sekim olgeta ID long han. Yu ken usim app yet na kam bek hia bihain.',
    sentOn: 'Salim long {date}', refresh: 'Sekim gen', withdraw: 'Rausim dispela sek',
    withdrawAsk: 'Rausim dispela sek? Yu ken salim nupela foto stret bihain.', withdrawYes: 'Yes, rausim', keep: 'Nogat, larim',
    rejected: 'Mipela i no inap soim ID bilong yu i stret', reasonLbl: 'As bilong en', tryAgain: 'Traim gen',
    expired: 'Sek bilong ID bilong yu i pinis', expiredSub: 'Em i pinis long {date}. Sekim gen bilong usim ol samting i nidim.', checkAgain: 'Sekim gen',
    retSevisOk: 'SevisPass i pinis.', retSevisFail: 'SevisPass i no inap soim yu husat. Traim gen, o usim ID i gat foto.',
    view: 'Lukim', verify: 'Sekim', lName: 'Nem', lDob: 'Kamap long', lLast4: 'Las 4', lExpiry: 'I pinis long',
    stepOf: 'Step {n} bilong 4', back: 'Go bek', next: 'Nekis', cancel: 'Lusim',
    s1: 'ID bilong yu', s2: 'Foto bilong ID', s3: 'Selfi', s4: 'Sekim na salim',
    idType: 'Wanem kain ID yu gat?',
    t_png_nid: 'Nesenel ID kad bilong PNG (NID)', t_png_passport: 'Paspot bilong PNG', t_png_drivers_licence: 'Draiva laisens bilong PNG',
    t_foreign_passport: 'Paspot bilong narapela kantri', t_other_photo_id: 'Narapela ID i gat nem na foto bilong yu',
    country: 'Kantri i givim ID', countryOther: 'Narapela kantri', countryCode: 'Kod bilong kantri (2 leta, olsem DE)',
    name: 'Nem bilong yu, stret olsem i stap long ID', dob: 'De yu bin kamap (de bilong mama karim yu)',
    last4: 'Las 4 namba bilong ID namba (sapos yu laik)', expiry: 'De ID i pinis (sapos yu laik)', optional: 'sapos yu laik',
    docHow: 'Putim ID long wanpela plet ples we i gat gutpela lait. Olgeta kad (o pes bilong paspot i gat foto) i mas stap insait long foto. Ol rait i mas klia, na nogat lait i sain long en.',
    docTake: 'Kisim foto bilong ID bilong yu',
    selfieHow: 'Usim kamera long fran. Lukluk long kamera long gutpela lait, na no ken holim wanpela samting — no ID, no fon. No ken putim hat o san glas.',
    selfieTake: 'Kisim selfi',
    retake: 'Kisim gen', working: 'Wok long redim foto…',
    previewDoc: 'Foto bilong ID bilong yu', previewSelfie: 'Selfi bilong yu',
    consent: 'Ol wokman bilong BM i lukim ol foto bilong yu bilong save olsem yu husat tru. Foto bilong ID bilong yu bai i raus 90 de bihain long sek. Selfi bilong yu bai i stap taim sek bilong yu i stap gut yet, olsem ol app yu usim (olsem wanpela eksem) i ken save olsem em yu tru.',
    agree: 'Mi orait, na dispela em ID bilong mi yet na pes bilong mi yet.',
    send: 'Salim bilong sekim', sending: 'Wok long salim…',
    needType: 'Makim wanem kain ID.', needCountry: 'Makim kantri i givim ID.', needName: 'Raitim nem bilong yu olsem i stap long ID.',
    needDob: 'Putim de yu bin kamap.', dobBad: 'Sekim gen de yu bin kamap.', last4Bad: 'Las 4 i mas 4 leta o namba.',
    docExpired: 'Dispela ID i pinis. Usim ID i stap gut yet.', needPhoto: 'Kisim foto pastaim.', needAgree: 'Makim boks bilong tok orait.',
    e_already_pending: 'Yu gat wanpela sek i wet pinis. Mipela bai pinisim dispela pastaim.',
    e_already_verified: 'ID bilong yu i stret pinis.',
    e_too_big: 'Dispela foto i bikpela tumas. Kisim gen, liklik longwe.',
    e_not_jpeg: 'Mipela i no inap usim dispela foto. Kisim gen wantaim kamera.',
    e_unreadable: 'Mipela i no inap opim dispela foto. Kisim nupela wantaim kamera.',
    e_rate_limited: 'Yu traim planti taim tumas tude. Wet na traim gen tumora.',
    e_not_ready: 'Sek bilong ID i gat foto i no op yet. Traim gen bihain.',
    e_sevispass_not_ready: 'SevisPass i no redi yet. Usim ID i gat foto.',
    e_offline: 'Nogat koneksen long BM ID. Sekim data o Wi-Fi na traim gen.',
    e_signed_out: 'Plis sain in gen.',
    e_failed: 'Samting i no wok gut. Plis traim gen.',
  },
};
const langOf = l => (l === 'tpi' || l === 'tp' || l === 'tok') ? 'tpi' : 'en';
const errText = (t, e) => t['e_' + (e && e.code)] || t.e_failed;

// Countries for a passport / other photo ID from outside PNG. Many students live in
// Australia, New Zealand and the UK; "Other" takes any ISO-2 code.
const COUNTRIES = [
  ['PG', 'Papua New Guinea'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['GB', 'United Kingdom'], ['US', 'United States'],
  ['FJ', 'Fiji'], ['SB', 'Solomon Islands'], ['VU', 'Vanuatu'], ['NC', 'New Caledonia'], ['WS', 'Samoa'], ['TO', 'Tonga'],
  ['PH', 'Philippines'], ['ID', 'Indonesia'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['CN', 'China'], ['IN', 'India'],
  ['JP', 'Japan'], ['KR', 'South Korea'], ['CA', 'Canada'], ['IE', 'Ireland'],
];

const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-PG', { day: 'numeric', month: 'short', year: 'numeric' });
};
const today = () => new Date().toISOString().slice(0, 10);

/** Data for a custom screen: { status, loading, error, signedIn, relogin, returned, reload }.
 *  `returned` is 'verified' | 'failed' | null — set once after a SevisPass redirect
 *  (the ?identity= flag is read and removed from the address bar on mount). */
export function useIdentityStatus() {
  const [st, setSt] = useState({ status: null, loading: true, error: null, signedIn: true, relogin: false });
  const [returned, setReturned] = useState(null);
  const took = useRef(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setSt(s => ({ ...s, loading: true, error: null }));
    const session = bmConfig().mode === 'redirect' ? await syncBmFromSession().catch(() => null) : null;
    if (!(await getToken().catch(() => null))) {
      // Signed in to the app but no BM token: a session from before IdP 1.9.0 — one fresh sign-in fixes it.
      if (alive.current) setSt({ status: null, loading: false, error: null, signedIn: !!session, relogin: !!session });
      return null;
    }
    try {
      const status = await identityStatus();
      if (alive.current) setSt({ status, loading: false, error: null, signedIn: true, relogin: false });
      return status;
    } catch (e) {
      if (alive.current) setSt(s => ({ ...s, loading: false, error: e }));
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!took.current) { took.current = true; const r = takeIdentityReturn(); if (r) setReturned(r); }
    reload();
    return () => { alive.current = false; };
  }, [reload]);

  return { ...st, returned, reload };
}

const S = {
  card: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, margin: '0 0 16px', fontFamily: 'inherit', color: '#0f172a', textAlign: 'left' },
  h: { fontSize: 16, fontWeight: 800, margin: 0, outline: 'none' },
  sub: { fontSize: 13, color: '#475569', margin: '4px 0 0', lineHeight: 1.5 },
  p: { fontSize: 14, lineHeight: 1.55, margin: '12px 0 0' },
  muted: { fontSize: 12, color: '#64748b', lineHeight: 1.5, margin: '8px 0 0' },
  label: { display: 'block', fontSize: 14, fontWeight: 700, margin: '14px 0 6px' },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 48, fontSize: 16, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 12, background: '#fff', color: '#0f172a', font: 'inherit' },
  primary: { display: 'block', width: '100%', minHeight: 52, fontSize: 16, fontWeight: 800, padding: '12px 16px', border: 0, borderRadius: 12, background: '#047857', color: '#fff', cursor: 'pointer', textAlign: 'center', marginTop: 12, font: 'inherit' },
  secondary: { display: 'block', width: '100%', minHeight: 48, fontSize: 15, fontWeight: 700, padding: '10px 16px', border: '1px solid #cbd5e1', borderRadius: 12, background: '#fff', color: '#0f172a', cursor: 'pointer', textAlign: 'center', marginTop: 10, font: 'inherit' },
  link: { minHeight: 44, fontSize: 14, fontWeight: 600, padding: '10px 4px', border: 0, background: 'none', color: '#475569', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' },
  choice: { display: 'block', width: '100%', textAlign: 'left', minHeight: 64, padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 14, background: '#fff', color: '#0f172a', cursor: 'pointer', marginTop: 10, font: 'inherit' },
  radio: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 12, background: '#fff', marginTop: 8, cursor: 'pointer', fontSize: 15 },
  err: { fontSize: 14, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px 12px', margin: '12px 0 0' },
  info: { fontSize: 14, color: '#1e3a8a', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '10px 12px', margin: '12px 0 0' },
  ok: { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#064e3b' },
  warn: { background: '#fffbeb', border: '1px solid #fde68a', color: '#78350f' },
  bad: { background: '#fef2f2', border: '1px solid #fecaca', color: '#7f1d1d' },
  preview: { display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 12, background: '#0f172a', marginTop: 12 },
  thumbs: { display: 'flex', gap: 10, marginTop: 12 },
  thumb: { flex: 1, minWidth: 0, height: 120, objectFit: 'cover', borderRadius: 10, background: '#0f172a' },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', pointerEvents: 'none' },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '3px 0' },
};

const BLANK = { idType: '', country: 'PG', countryOther: '', fullName: '', dob: '', idNumberLast4: '', docExpiry: '' };

/** One capture step: instructions → camera → preview with Retake. */
function Capture({ t, facing, how, takeLabel, previewLabel, value, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pick = () => { setErr(null); if (input.current) { input.current.value = ''; input.current.click(); } };
  const onFile = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBusy(true); setErr(null);
    try { onChange(await resizeToJpeg(f, 1280, 0.8)); }
    catch (x) { setErr(x); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <p style={S.p}>{how}</p>
      <input ref={input} type="file" accept="image/*" capture={facing} onChange={onFile} style={S.hidden} tabIndex={-1} aria-hidden="true" />
      {value && <img src={'data:image/jpeg;base64,' + value} alt={previewLabel} style={S.preview} />}
      {busy && <p style={S.info} role="status">{t.working}</p>}
      {err && <p style={S.err} role="alert">{errText(t, err)}</p>}
      <button type="button" onClick={pick} disabled={busy} style={value ? S.secondary : S.primary}>
        {value ? '↻ ' + t.retake : '📷 ' + takeLabel}
      </button>
    </div>
  );
}

/** The standard card. */
export function IdentityCheck({ app, lang = 'en', onVerified, compact = false, style }) {
  const t = T[langOf(lang)];
  const { status, loading, error, signedIn, relogin, returned, reload } = useIdentityStatus();
  const [view, setView] = useState('status');     // 'status' | 'choose' | 'form'
  const [expanded, setExpanded] = useState(!compact);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(BLANK);
  const [docImg, setDocImg] = useState(null);
  const [selfieImg, setSelfieImg] = useState(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);            // { kind: 'err' | 'info', text }
  const [askWithdraw, setAskWithdraw] = useState(false);
  const heading = useRef(null);
  const told = useRef('');

  // onVerified fires once per verified check (keyed on verified_at).
  useEffect(() => {
    if (status && status.status === 'verified' && onVerified) {
      const key = String(status.verified_at || 'v');
      if (told.current !== key) { told.current = key; onVerified(status); }
    }
  }, [status, onVerified]);

  // Back from SevisPass: say how it went (the hook already refreshed the status).
  useEffect(() => {
    if (!returned) return;
    setExpanded(true);
    setMsg({ kind: returned === 'verified' ? 'info' : 'err', text: returned === 'verified' ? t.retSevisOk : t.retSevisFail });
  }, [returned]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Move screen-reader focus to the new heading when the step or view changes.
  useEffect(() => { if (heading.current && (view === 'form' || view === 'choose')) heading.current.focus(); }, [view, step]);

  if (!signedIn) return null;

  const providers = (status && status.providers) || {};
  const sevisReady = !!(providers.sevispass && providers.sevispass.ready);
  const docReady = !!(providers.document && providers.document.ready);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const country = form.idType === 'foreign_passport' || form.idType === 'other_photo_id'
    ? (form.country === 'OTHER' ? form.countryOther.trim().toUpperCase() : form.country)
    : 'PG';

  const resetForm = () => { setForm(BLANK); setDocImg(null); setSelfieImg(null); setAgree(false); setStep(1); };
  const startDoc = () => { resetForm(); setMsg(null); setView('form'); };
  const choose = () => {
    setMsg(null); setExpanded(true);
    // Only one way in → go straight there.
    if (sevisReady && docReady) setView('choose');
    else if (docReady) startDoc();
    else setView('choose');
  };
  const goSevis = async () => {
    setBusy(true); setMsg(null);
    try { window.location.assign(await startSevisPass({ returnTo: identityReturnUrl(), app })); }
    catch (e) { setMsg({ kind: 'err', text: errText(t, e) }); setBusy(false); }
  };

  const checkStep1 = () => {
    if (!ID_TYPES.includes(form.idType)) return t.needType;
    if (!/^[A-Z]{2}$/.test(country) || (form.idType === 'foreign_passport' && country === 'PG')) return t.needCountry;
    if (form.fullName.trim().length < 2) return t.needName;
    if (!form.dob) return t.needDob;
    const age = (Date.now() - new Date(form.dob).getTime()) / 31557600000;
    if (!(age > 5 && age < 120)) return t.dobBad;
    if (form.idNumberLast4 && !/^[A-Za-z0-9]{4}$/.test(form.idNumberLast4.trim())) return t.last4Bad;
    if (form.docExpiry && form.docExpiry < today()) return t.docExpired;
    return null;
  };
  const next = () => {
    const bad = step === 1 ? checkStep1() : step === 2 && !docImg ? t.needPhoto : step === 3 && !selfieImg ? t.needPhoto : null;
    if (bad) return setMsg({ kind: 'err', text: bad });
    setMsg(null); setStep(s => s + 1);
  };
  const back = () => { setMsg(null); if (step > 1) setStep(s => s - 1); else setView(sevisReady ? 'choose' : 'status'); };

  const send = async () => {
    if (!agree) return setMsg({ kind: 'err', text: t.needAgree });
    setBusy(true); setMsg(null);
    try {
      await submitIdentityDocument({
        idType: form.idType, country, fullName: form.fullName, dob: form.dob,
        idNumberLast4: form.idNumberLast4.trim().toUpperCase(), docExpiry: form.docExpiry,
        docJpeg: docImg, selfieJpeg: selfieImg, app,
      });
      resetForm(); setView('status'); await reload();
    } catch (e) {
      if (e && (e.code === 'already_pending' || e.code === 'already_verified')) { resetForm(); setView('status'); await reload(); }
      setMsg({ kind: 'err', text: errText(t, e) });
    } finally { setBusy(false); }
  };

  const withdraw = async () => {
    setBusy(true); setMsg(null);
    try { await withdrawIdentity(); setAskWithdraw(false); await reload(); }
    catch (e) { setMsg({ kind: 'err', text: errText(t, e) }); }
    finally { setBusy(false); }
  };

  const Msg = msg ? <p style={msg.kind === 'err' ? S.err : S.info} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p> : null;
  const code = status && status.status;

  // ── Compact: one slim line until the person taps ───────────────────
  if (compact && !expanded && view === 'status') {
    const tone = code === 'verified' ? S.ok : code === 'pending' ? S.warn : code === 'rejected' || code === 'expired' ? S.bad : {};
    const line = loading ? t.loading : code === 'verified' ? '✓ ' + t.verified : code === 'pending' ? '⏳ ' + t.pending
      : code === 'rejected' ? '⚠️ ' + t.rejected : code === 'expired' ? '⚠️ ' + t.expired : '🪪 ' + t.title;
    const action = !loading && code !== 'verified';
    return (
      <div style={{ ...S.card, ...tone, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, ...style }} aria-live="polite">
        <span style={{ fontSize: 14, fontWeight: 700 }}>{line}</span>
        {action && (
          <button type="button" onClick={() => setExpanded(true)} style={{ ...S.secondary, width: 'auto', marginTop: 0, minHeight: 44, padding: '8px 14px' }}>
            {code === 'pending' ? t.view : t.verify}
          </button>
        )}
      </div>
    );
  }

  // ── The flow ────────────────────────────────────────────────────────
  let body;
  if (view === 'choose') {
    body = (
      <>
        <h3 ref={heading} tabIndex={-1} style={S.h}>🪪 {t.title}</h3>
        <p style={S.sub}>{t.noneIntro}</p>
        {Msg}
        {sevisReady && (
          <button type="button" onClick={goSevis} disabled={busy} style={{ ...S.choice, borderColor: '#047857', borderWidth: 2 }}>
            <b style={{ display: 'block', fontSize: 16 }}>⚡ {t.sevis}</b>
            <span style={{ display: 'block', fontSize: 13, color: '#475569', marginTop: 2 }}>{t.sevisSub}</span>
          </button>
        )}
        {docReady && (
          <button type="button" onClick={startDoc} disabled={busy} style={S.choice}>
            <b style={{ display: 'block', fontSize: 16 }}>📷 {t.doc}</b>
            <span style={{ display: 'block', fontSize: 13, color: '#475569', marginTop: 2 }}>{t.docSub}</span>
          </button>
        )}
        {!sevisReady && !docReady && <p style={S.info}>{t.closed}</p>}
        <button type="button" onClick={() => { setMsg(null); setView('status'); if (compact) setExpanded(false); }} style={S.link}>{t.cancel}</button>
      </>
    );
  } else if (view === 'form') {
    const titles = [t.s1, t.s2, t.s3, t.s4];
    body = (
      <>
        <p style={{ ...S.muted, margin: 0 }}>{t.stepOf.replace('{n}', step)}</p>
        <h3 ref={heading} tabIndex={-1} style={{ ...S.h, marginTop: 4 }}>{titles[step - 1]}</h3>
        {step === 1 && (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: '8px 0 0' }}>
              <legend style={{ ...S.label, marginTop: 6 }}>{t.idType}</legend>
              {ID_TYPES.map(k => (
                <label key={k} style={{ ...S.radio, ...(form.idType === k ? { borderColor: '#047857', boxShadow: '0 0 0 2px #04785733' } : {}) }}>
                  <input type="radio" name="bm-id-type" value={k} checked={form.idType === k}
                    onChange={() => setForm(f => ({ ...f, idType: k,
                      // the country list hides PG for a foreign passport, so don't leave PG selected out of sight
                      country: k === 'foreign_passport' && f.country === 'PG' ? 'AU' : f.country }))} style={{ width: 22, height: 22, margin: 0, accentColor: '#047857', flex: 'none' }} />
                  <span>{t['t_' + k]}</span>
                </label>
              ))}
            </fieldset>
            {(form.idType === 'foreign_passport' || form.idType === 'other_photo_id') && (
              <>
                <label style={S.label} htmlFor="bm-id-country">{t.country}</label>
                <select id="bm-id-country" value={form.country} onChange={e => set('country', e.target.value)} style={S.input}>
                  {COUNTRIES.filter(([c]) => form.idType !== 'foreign_passport' || c !== 'PG').map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  <option value="OTHER">{t.countryOther}</option>
                </select>
                {form.country === 'OTHER' && (
                  <>
                    <label style={S.label} htmlFor="bm-id-cc">{t.countryCode}</label>
                    <input id="bm-id-cc" value={form.countryOther} maxLength={2} autoCapitalize="characters" autoComplete="off"
                      onChange={e => set('countryOther', e.target.value.replace(/[^a-z]/gi, ''))} style={S.input} />
                  </>
                )}
              </>
            )}
            <label style={S.label} htmlFor="bm-id-name">{t.name}</label>
            <input id="bm-id-name" value={form.fullName} onChange={e => set('fullName', e.target.value)} autoComplete="name" style={S.input} />
            <label style={S.label} htmlFor="bm-id-dob">{t.dob}</label>
            <input id="bm-id-dob" type="date" value={form.dob} max={today()} onChange={e => set('dob', e.target.value)} autoComplete="bday" style={S.input} />
            <label style={S.label} htmlFor="bm-id-last4">{t.last4}</label>
            <input id="bm-id-last4" value={form.idNumberLast4} maxLength={4} autoComplete="off" autoCapitalize="characters"
              onChange={e => set('idNumberLast4', e.target.value)} style={S.input} />
            <label style={S.label} htmlFor="bm-id-exp">{t.expiry}</label>
            <input id="bm-id-exp" type="date" value={form.docExpiry} min={today()} onChange={e => set('docExpiry', e.target.value)} style={S.input} />
          </>
        )}
        {step === 2 && <Capture t={t} facing="environment" how={t.docHow} takeLabel={t.docTake} previewLabel={t.previewDoc} value={docImg} onChange={v => { setDocImg(v); setMsg(null); }} />}
        {step === 3 && <Capture t={t} facing="user" how={t.selfieHow} takeLabel={t.selfieTake} previewLabel={t.previewSelfie} value={selfieImg} onChange={v => { setSelfieImg(v); setMsg(null); }} />}
        {step === 4 && (
          <>
            <div style={{ ...S.card, background: '#fff', margin: '12px 0 0', padding: 12 }}>
              <div style={S.row}><span style={{ color: '#64748b', flex: 'none' }}>{t.s1}</span><b style={{ textAlign: 'right' }}>{t['t_' + form.idType]}{country !== 'PG' ? ' · ' + country : ''}</b></div>
              <div style={S.row}><span style={{ color: '#64748b', flex: 'none' }}>{t.lName}</span><b style={{ textAlign: 'right', wordBreak: 'break-word' }}>{form.fullName.trim()}</b></div>
              <div style={S.row}><span style={{ color: '#64748b', flex: 'none' }}>{t.lDob}</span><b>{fmtDate(form.dob)}</b></div>
              {form.idNumberLast4 && <div style={S.row}><span style={{ color: '#64748b', flex: 'none' }}>{t.lLast4}</span><b>{form.idNumberLast4.toUpperCase()}</b></div>}
              {form.docExpiry && <div style={S.row}><span style={{ color: '#64748b', flex: 'none' }}>{t.lExpiry}</span><b>{fmtDate(form.docExpiry)}</b></div>}
            </div>
            <div style={S.thumbs}>
              <img src={'data:image/jpeg;base64,' + docImg} alt={t.previewDoc} style={S.thumb} />
              <img src={'data:image/jpeg;base64,' + selfieImg} alt={t.previewSelfie} style={S.thumb} />
            </div>
            <p style={{ ...S.p, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px' }}>🔒 {t.consent}</p>
            <label style={{ ...S.radio, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ width: 22, height: 22, margin: '1px 0 0', accentColor: '#047857', flex: 'none' }} />
              <span>{t.agree}</span>
            </label>
          </>
        )}
        {Msg}
        {step < 4
          // On the photo steps "Next" appears once the photo is taken (one green button at a time).
          ? (step === 1 || (step === 2 && docImg) || (step === 3 && selfieImg)) && <button type="button" onClick={next} style={S.primary} disabled={busy}>{t.next}</button>
          : <button type="button" onClick={send} style={{ ...S.primary, opacity: busy ? 0.7 : 1 }} disabled={busy} aria-busy={busy}>{busy ? t.sending : t.send}</button>}
        <button type="button" onClick={back} style={S.secondary} disabled={busy}>{t.back}</button>
      </>
    );
  } else {
    // status view
    const tone = code === 'verified' ? S.ok : code === 'pending' ? S.warn : code === 'rejected' || code === 'expired' ? S.bad : {};
    body = (
      <div aria-live="polite">
        {loading && !status && <p style={{ ...S.muted, margin: 0 }}>{t.loading}</p>}
        {relogin && <p style={{ ...S.info, marginTop: 0 }}>ℹ️ {t.relogin}</p>}
        {error && !status && (
          <>
            <p style={{ ...S.err, marginTop: 0 }} role="alert">{errText(t, error)}</p>
            <button type="button" onClick={reload} style={S.secondary}>{t.refresh}</button>
          </>
        )}
        {status && (
          <>
            {(code === 'none' || !code) && (
              <>
                <h3 style={S.h}>🪪 {t.title}</h3>
                <p style={S.sub}>{t.noneIntro}</p>
              </>
            )}
            {code === 'verified' && (
              <div style={{ ...S.card, ...tone, margin: 0 }}>
                <h3 style={S.h}>✅ {t.verified}</h3>
                {status.full_name && <p style={{ ...S.p, marginTop: 6, fontWeight: 700 }}>{status.full_name}</p>}
                <p style={S.sub}>{t.verifiedBy.replace('{how}', status.method === 'sevispass' ? t.viaSevis : t.viaDoc)}</p>
                {status.expires_at && <p style={S.sub}>{t.validUntil.replace('{date}', fmtDate(status.expires_at))}</p>}
              </div>
            )}
            {code === 'pending' && (
              <div style={{ ...S.card, ...tone, margin: 0 }}>
                <h3 style={S.h}>⏳ {t.pending}</h3>
                <p style={S.sub}>{t.pendingSub}</p>
                {status.pending_since && <p style={S.muted}>{t.sentOn.replace('{date}', fmtDate(status.pending_since))}</p>}
              </div>
            )}
            {code === 'rejected' && (
              <div style={{ ...S.card, ...tone, margin: 0 }}>
                <h3 style={S.h}>⚠️ {t.rejected}</h3>
                {status.reason && <p style={S.p}><b>{t.reasonLbl}:</b> {status.reason}</p>}
              </div>
            )}
            {code === 'expired' && (
              <div style={{ ...S.card, ...tone, margin: 0 }}>
                <h3 style={S.h}>⌛ {t.expired}</h3>
                {status.expires_at && <p style={S.sub}>{t.expiredSub.replace('{date}', fmtDate(status.expires_at))}</p>}
              </div>
            )}
            {Msg}
            {(code === 'none' || !code || code === 'expired' || code === 'rejected') && (
              (sevisReady || docReady) ? (
                code === 'none' || !code ? (
                  <>
                    {sevisReady && (
                      <button type="button" onClick={goSevis} disabled={busy} style={{ ...S.choice, borderColor: '#047857', borderWidth: 2 }}>
                        <b style={{ display: 'block', fontSize: 16 }}>⚡ {t.sevis}</b>
                        <span style={{ display: 'block', fontSize: 13, color: '#475569', marginTop: 2 }}>{t.sevisSub}</span>
                      </button>
                    )}
                    {docReady && (
                      <button type="button" onClick={startDoc} disabled={busy} style={S.choice}>
                        <b style={{ display: 'block', fontSize: 16 }}>📷 {t.doc}</b>
                        <span style={{ display: 'block', fontSize: 13, color: '#475569', marginTop: 2 }}>{t.docSub}</span>
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={choose} style={S.primary}>{code === 'rejected' ? t.tryAgain : t.checkAgain}</button>
                )
              ) : <p style={S.info}>{t.closed}</p>
            )}
            {code === 'pending' && !askWithdraw && (
              <>
                <button type="button" onClick={reload} disabled={loading} style={S.secondary}>{t.refresh}</button>
                <button type="button" onClick={() => setAskWithdraw(true)} style={S.link}>{t.withdraw}</button>
              </>
            )}
            {code === 'pending' && askWithdraw && (
              <div style={S.info} role="group">
                <p style={{ margin: 0 }}>{t.withdrawAsk}</p>
                <button type="button" onClick={withdraw} disabled={busy} style={S.secondary}>{t.withdrawYes}</button>
                <button type="button" onClick={() => setAskWithdraw(false)} disabled={busy} style={S.secondary}>{t.keep}</button>
              </div>
            )}
            {compact && code !== 'verified' && (
              <button type="button" onClick={() => { setMsg(null); setExpanded(false); }} style={S.link}>{t.cancel}</button>
            )}
          </>
        )}
      </div>
    );
  }

  return <section style={{ ...S.card, ...style }} aria-label={t.title}>{body}</section>;
}
