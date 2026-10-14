// <BankTopUp> — the standard "Top up from your bank" card every BM app shows
// (Martin, 15 Oct 2026: bank + SWIFT overseas top-up is always an option in every
// app). Biller code + the customer's permanent CRN for "Pay a bill" at any PNG
// bank, and — when BM Pay has the account set — the SWIFT details for paying in
// from overseas. Money lands in the BM Wallet shared by every BM app.
//
//   import { BankTopUp } from '@bm/client';
//   <BankTopUp lang={lang} />            // lang: 'en' | 'tpi' (or 'tp')
//
// Inline styles only, so it looks right in Tailwind and plain-CSS apps alike.
// Renders nothing when signed out. `demo` shows sample data for previews.
import { useEffect, useState } from 'react';
import { bankTopUp, bankTopUpDeposits } from './wallet.js';
import { getToken } from './auth.js';
import { bmConfig } from './config.js';
import { syncBmFromSession } from './oidc.js';

const T = {
  en: {
    title: 'Top up from your bank', sub: 'Any PNG bank app, or from overseas',
    intro: 'Add Blockchain Melanesia as a biller once in your bank’s app, then top up any time. It lands in your BM Wallet — spendable in every BM app.',
    biller: 'Biller code', crn: 'Your reference (CRN)', copy: 'tap to copy', copied: 'copied ✓',
    how1: 'In your bank app choose “Pay a bill” / “Biller”.',
    how2: 'Enter the biller code and your reference (CRN) exactly as shown.',
    how3: 'Enter the amount and confirm. Your wallet is credited once the bank settles it (same or next business day).',
    fee: 'A {pct}% fee is taken from each top-up.', nofee: 'No fee on top-ups.', tip: 'Tip: save it as a payee so next time takes seconds.',
    swift: 'Paying from overseas? (SWIFT bank transfer)',
    swiftHow: 'From your overseas bank, send an international (SWIFT) transfer to the account below. Put {crn} as the payment reference so it reaches your wallet.',
    sBank: 'Bank', sName: 'Account name', sAcct: 'Account number', sBranch: 'Branch', sAddr: 'Bank address', sRef: 'Payment reference',
    swiftLands: 'It arrives in Kina in your BM Wallet, usually in 2–5 business days. Your bank sets the exchange rate, and the banks may deduct transfer fees.',
    recent: 'Recent bank top-ups', credited: 'credited', pending: 'processing', loading: 'Loading…',
    relogin: 'Sign out and sign in again to see your bank top-up details.',
    introTr: 'Send money from any PNG bank app to Blockchain Melanesia’s account below, with your own reference (CRN). It lands in your BM Wallet — spendable in every BM app.',
    trTitle: 'Pay by bank transfer', trRef: 'Reference — your CRN',
    tr1: 'In your bank app choose “Transfer” / “Pay someone” to a BSP account.',
    tr2: 'Enter the account name and number above, then your CRN as the reference — exactly as shown. Without it we can’t tell the money is yours.',
    tr3: 'Enter the amount and confirm. Your wallet is credited once BM matches it from the bank statement (from other banks this can take a business day or two).',
    billerSoon: 'Soon you can also use “Pay a bill” with BM’s biller code — BSP is registering Blockchain Melanesia as a biller.',
    noRoute: 'Bank top-ups open soon. Your reference (CRN) is ready below.',
  },
  tpi: {
    title: 'Putim mani long benk bilong yu', sub: 'Wanem PNG benk app, o long narapela kantri',
    intro: 'Putim Blockchain Melanesia olsem bila wanpela taim long benk app bilong yu, na putim mani wanem taim. Em i go long BM Walet bilong yu — yu inap usim long olgeta BM app.',
    biller: 'Bila kod', crn: 'Refens bilong yu (CRN)', copy: 'tapim long kopi', copied: 'kopi pinis ✓',
    how1: 'Long benk app bilong yu makim “Pay a bill” / “Biller”.',
    how2: 'Putim bila kod na refens (CRN) bilong yu stret olsem i stap.',
    how3: 'Putim hamas mani na konfem. Walet bilong yu i kisim mani taim benk i setolim (wankain de o neks bisnis de).',
    fee: 'Fi bilong {pct}% i kam aut long wanwan top-ap.', nofee: 'Nogat fi long top-ap.', tip: 'Tip: seivim olsem payee bai neks taim i kwik tru.',
    swift: 'Yu stap long narapela kantri? (SWIFT bank transfer)',
    swiftHow: 'Long bank bilong yu long narapela kantri, salim international (SWIFT) transfer i go long akaun hia. Raitim {crn} olsem payment reference, olsem em i kamap long wallet bilong yu.',
    sBank: 'Bank', sName: 'Nem bilong akaun', sAcct: 'Namba bilong akaun', sBranch: 'Branch', sAddr: 'Adres bilong bank', sRef: 'Payment reference',
    swiftLands: 'Em bai kamap olsem Kina long BM Wallet bilong yu, planti taim insait long 2–5 de wok. Bank bilong yu i makim exchange rate, na ol bank i ken kisim fee.',
    recent: 'Ol nupela benk top-ap', credited: 'i go pinis', pending: 'i wok yet', loading: 'Wetim…',
    relogin: 'Sain aut na sain in gen bilong lukim ol detail bilong putim mani long benk.',
    introTr: 'Salim mani long wanem PNG benk app i go long akaun bilong Blockchain Melanesia hia, wantaim refens bilong yu (CRN). Em i go long BM Walet bilong yu — yu inap usim long olgeta BM app.',
    trTitle: 'Peim long benk transfa', trRef: 'Refens — CRN bilong yu',
    tr1: 'Long benk app bilong yu makim “Transfer” / “Pay someone” i go long BSP akaun.',
    tr2: 'Putim nem na namba bilong akaun antap, na CRN bilong yu olsem refens — stret olsem i stap. Sapos nogat, mipela i no inap save olsem mani em bilong yu.',
    tr3: 'Putim hamas mani na konfem. Walet bilong yu i kisim mani taim BM i painim long benk stetmen (long ol narapela benk em i ken kisim wanpela o tupela de wok).',
    billerSoon: 'I no longtaim yu inap usim “Pay a bill” wantaim bila kod bilong BM — BSP i wok long rejistaim Blockchain Melanesia olsem bila.',
    noRoute: 'Benk top-ap i op klostu. Refens bilong yu (CRN) i redi hia.',
  },
};
const langOf = l => (l === 'tpi' || l === 'tp' || l === 'tok') ? 'tpi' : 'en';

const DEMO = {
  crn: '000000000', billerCode: null, biller_registered: false, fee_pct: 0.025,
  swift: { bank: 'Bank South Pacific (BSP)', account_name: 'Blockchain Melanesia (demo)', account_no: '0000000000', swift_bic: 'BOSPPGPM', reference: '000000000', currency_lands: 'PGK' },
};

/** Data for a custom top-up screen: { acct, deposits, error, loading }. */
export function useBankTopUp({ demo = false, deposits: withDeposits = true } = {}) {
  const [st, setSt] = useState({ acct: null, deposits: [], error: '', loading: true, signedIn: true, relogin: false });
  useEffect(() => {
    let alive = true;
    (async () => {
      // demo: true → sample data; an object overrides fields (e.g. { billerCode: '1234' }) for previews.
      if (demo) return setSt({ acct: demo === true ? DEMO : { ...DEMO, ...demo }, deposits: [], error: '', loading: false, signedIn: true, relogin: false });
      // Redirect mode (Supabase custom OIDC): pick up the BM tokens Supabase carried in at sign-in first.
      const session = bmConfig().mode === 'redirect' ? await syncBmFromSession() : null;
      if (!(await getToken().catch(() => null))) {
        // Signed in to the app but no BM token: a session from before IdP 1.9.0 — one fresh sign-in fixes it.
        return alive && setSt(s => ({ ...s, loading: false, signedIn: !!session, relogin: !!session }));
      }
      try {
        const [acct, deps] = await Promise.all([bankTopUp(), withDeposits ? bankTopUpDeposits().catch(() => []) : []]);
        if (alive) setSt({ acct, deposits: deps, error: '', loading: false, signedIn: true });
      } catch (e) { if (alive) setSt(s => ({ ...s, error: e.message || 'BM Pay unreachable', loading: false })); }
    })();
    return () => { alive = false; };
  }, [JSON.stringify(demo), withDeposits]);
  return st;
}

const S = {
  card: { background: '#ecfdf5', border: '1px solid #d1fae5', borderRadius: 16, padding: 16, margin: '0 0 16px', fontFamily: 'inherit', color: '#064e3b', textAlign: 'left' },
  head: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' },
  label: { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', margin: '12px 0 4px' },
  code: { width: '100%', background: '#fff', border: '1px solid #d1fae5', borderRadius: 12, padding: '10px 12px', fontSize: 22, fontWeight: 900, letterSpacing: '.06em', color: '#111827', cursor: 'pointer', textAlign: 'center', font: 'inherit' },
  small: { fontSize: 12, lineHeight: 1.5 },
  muted: { fontSize: 11, color: '#6b7280', lineHeight: 1.5 },
  box: { background: '#fff', border: '1px solid #d1fae5', borderRadius: 12, padding: '10px 12px', marginTop: 12, fontSize: 12, color: '#374151' },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' },
};

function Copy({ value, t }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch { /* old browsers: the value is still selectable */ }
    setDone(true); setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" onClick={copy} style={S.code} aria-label={`${value} — ${t.copy}`}>
      <span style={{ userSelect: 'all' }}>{value}</span>
      <span style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: 0, color: '#059669', marginTop: 2 }}>{done ? t.copied : t.copy}</span>
    </button>
  );
}

/** SWIFT (overseas) details alone — for apps that build their own top-up screen. */
export function SwiftDetails({ swift, crn, lang = 'en', style }) {
  if (!swift) return null;
  const t = T[langOf(lang)];
  const ref = swift.reference || crn;
  const rows = [[t.sBank, swift.bank], [t.sName, swift.account_name], [t.sAcct, swift.account_no], ['SWIFT / BIC', swift.swift_bic],
    [t.sBranch, swift.branch], [t.sAddr, swift.bank_address], [t.sRef, ref]].filter(r => r[1]);
  return (
    <details style={{ ...S.box, ...style }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#064e3b' }}>🌏 {t.swift}</summary>
      <p style={{ ...S.small, margin: '8px 0' }}>{t.swiftHow.replace('{crn}', ref)}</p>
      {rows.map(([k, v]) => (
        <div key={k} style={S.row}><span style={{ color: '#9ca3af' }}>{k}</span><b style={{ textAlign: 'right', userSelect: 'all', wordBreak: 'break-word' }}>{v}</b></div>
      ))}
      <p style={{ ...S.muted, margin: '8px 0 0' }}>{t.swiftLands}</p>
    </details>
  );
}

const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('en-PG', { day: 'numeric', month: 'short' }) : '');

/** The standard card. Collapsed by default (defaultOpen to start open). */
export function BankTopUp({ lang = 'en', defaultOpen = false, showDeposits = true, demo = false, style }) {
  const t = T[langOf(lang)];
  const [open, setOpen] = useState(defaultOpen);
  const { acct, deposits, error, loading, signedIn, relogin } = useBankTopUp({ demo, deposits: showDeposits });
  if (!signedIn) return null;
  const pct = acct ? Math.round((acct.fee_pct || 0) * 10000) / 100 : 0;
  return (
    <div style={{ ...S.card, ...style }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={S.head} aria-expanded={open}>
        <span>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>🏦 {t.title}</span>
          <span style={{ display: 'block', fontSize: 12, color: '#047857', marginTop: 2 }}>{t.sub}</span>
        </span>
        <span style={{ fontSize: 20, color: '#047857' }} aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {(!acct || acct.billerCode) && <p style={{ ...S.small, margin: '0 0 4px' }}>{t.intro}</p>}
          {loading && <p style={S.muted}>{t.loading}</p>}
          {relogin && <p style={{ ...S.small, color: '#92400e' }}>ℹ️ {t.relogin}</p>}
          {error && <p style={{ ...S.small, color: '#b91c1c' }}>⚠️ {error}</p>}
          {acct && (
            <>
              {acct.billerCode ? (
                <>
                  <div style={S.label}>{t.biller}</div>
                  <Copy value={acct.billerCode} t={t} />
                  <div style={S.label}>{t.crn}</div>
                  <Copy value={acct.crn} t={t} />
                  <ol style={{ ...S.small, paddingLeft: 20, margin: '12px 0 0' }}>
                    <li>{t.how1}</li><li>{t.how2}</li><li>{t.how3}</li>
                  </ol>
                  <p style={{ ...S.muted, margin: '8px 0 0' }}>{pct ? t.fee.replace('{pct}', pct) : t.nofee} · {t.tip}</p>
                </>
              ) : acct.swift ? (
                // No biller code yet (BSP still registering BM): an ordinary transfer from any PNG bank into
                // the same BSP account, with the CRN as the reference, is matched off the statement exactly
                // like "Pay a bill" (BM Pay finds the CRN anywhere on the line). Switches by itself once BM
                // Pay has BSP_BILLER_CODE.
                <>
                  <p style={{ ...S.small, margin: '8px 0 0' }}>{t.introTr}</p>
                  <div style={S.label}>{t.trTitle}</div>
                  <div style={{ ...S.box, marginTop: 0 }}>
                    {[[t.sBank, acct.swift.bank], [t.sName, acct.swift.account_name], [t.sBranch, acct.swift.branch]].filter(r => r[1]).map(([k, v]) => (
                      <div key={k} style={S.row}><span style={{ color: '#9ca3af' }}>{k}</span><b style={{ textAlign: 'right', userSelect: 'all', wordBreak: 'break-word' }}>{v}</b></div>
                    ))}
                  </div>
                  <div style={S.label}>{t.sAcct}</div>
                  <Copy value={acct.swift.account_no} t={t} />
                  <div style={S.label}>{t.trRef}</div>
                  <Copy value={acct.crn} t={t} />
                  <ol style={{ ...S.small, paddingLeft: 20, margin: '12px 0 0' }}>
                    <li>{t.tr1}</li><li>{t.tr2}</li><li>{t.tr3}</li>
                  </ol>
                  <p style={{ ...S.muted, margin: '8px 0 0' }}>{pct ? t.fee.replace('{pct}', pct) : t.nofee} · {t.tip}</p>
                  <p style={{ ...S.muted, margin: '6px 0 0' }}>{t.billerSoon}</p>
                </>
              ) : (
                <>
                  <div style={{ ...S.box, borderStyle: 'dashed', textAlign: 'center', color: '#6b7280' }}>{t.noRoute}</div>
                  <div style={S.label}>{t.crn}</div>
                  <Copy value={acct.crn} t={t} />
                </>
              )}
              <SwiftDetails swift={acct.swift} crn={acct.crn} lang={lang} />
              {showDeposits && deposits.length > 0 && (
                <>
                  <div style={S.label}>{t.recent}</div>
                  {deposits.slice(0, 5).map(d => (
                    <div key={d.id} style={{ ...S.box, ...S.row, marginTop: 4, padding: '6px 12px' }}>
                      <span style={{ color: '#6b7280' }}>{d.value_date || fmtDate(d.created_at)} · {d.credited ? t.credited : t.pending}</span>
                      <b style={{ color: '#047857' }}>+K{(Number(d.amount_toea) / 100).toFixed(2)}</b>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
