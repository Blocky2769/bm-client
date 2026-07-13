import { createClient } from '@supabase/supabase-js';

// ── Central config ────────────────────────────────────────────────
// Set ONCE at app startup via configureBm(). Everything else in the package
// reads from here, so one codebase serves every BM app — no hardcoded app id,
// no `import.meta.env`, and no per-app env-var-name differences (Konekt uses
// VITE_SUPABASE_ANON_KEY, others VITE_SUPABASE_KEY — the app resolves that and
// hands us the value).
let cfg = { app: '', idpUrl: '', supabaseUrl: '', supabaseKey: '' };

// Live bindings — consumers `import { supabase, isBM, … }` and see these update
// after configureBm() runs (ESM live bindings). configureBm() is called in the
// app entry (main.jsx) before anything renders, so they're correct on first read.
export let supabase = null;
export let isSupabase = false;
export let isBM = false;
export let isVoucherEnabled = false;
export let isWallet = false;
export let isSms = false;

const norm = u => { const s = String(u || '').trim(); return s.startsWith('<') ? '' : s.replace(/\/$/, ''); };

export function configureBm(c = {}) {
  cfg = {
    app:         c.app || cfg.app,
    idpUrl:      norm(c.idpUrl),
    supabaseUrl: String(c.supabaseUrl || '').trim(),
    supabaseKey: String(c.supabaseKey || '').trim(),
  };
  isBM = !!cfg.idpUrl;
  isVoucherEnabled = !!cfg.idpUrl;           // vouchers ride the IdP proxy
  isWallet = !!cfg.idpUrl;                   // Konekt Wallet rides the IdP
  isSms = !!cfg.idpUrl;                       // shared /sms/send rides the IdP
  supabase = makeSupabaseClient(cfg.supabaseUrl, cfg.supabaseKey);
  isSupabase = !!supabase;
  return cfg;
}

// Build the client defensively — an unset OR malformed URL degrades to "no
// Supabase" (mock/offline) instead of white-screening the SPA, since
// createClient() throws synchronously on a bad URL. (Ported from Rentim.)
function makeSupabaseClient(url, key) {
  if (!url || !key || url.includes('your-project')) return null;
  let validHttp = false;
  try { const u = new URL(url); validHttp = u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { validHttp = false; }
  if (!validHttp) {
    console.error(`[bm/client] VITE_SUPABASE_URL is not a valid http(s) URL — running without Supabase. Got: ${JSON.stringify(url)}`);
    return null;
  }
  try {
    return createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  } catch (e) {
    console.error('[bm/client] Supabase client init failed — running without Supabase:', e.message);
    return null;
  }
}

export function bmConfig() { return cfg; }

// ── Supabase session bridge ───────────────────────────────────────
// Exchange a BM JWT for a Supabase session via the app's custom OIDC provider
// (custom:<app>). The app's Supabase project must have that provider configured
// (issuer = the BM IdP). No-op if Supabase isn't configured.
export async function bmSignIn(bmToken) {
  if (!supabase || !bmToken) return { error: null };
  const { error } = await supabase.auth.signInWithIdToken({ provider: `custom:${cfg.app}`, token: bmToken });
  if (error) console.error('[bm/client] signInWithIdToken failed:', error.message);
  return { error };
}
export async function bmSignOut() {
  if (!supabase) return;
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
}
