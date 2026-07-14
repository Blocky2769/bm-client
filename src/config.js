import { createClient } from '@supabase/supabase-js';

// ── Central config ────────────────────────────────────────────────
// Set ONCE at app startup via configureBm(). Everything else in the package
// reads from here, so one codebase serves every BM app — no hardcoded app id,
// no `import.meta.env`, and no per-app env-var-name differences (Konekt uses
// VITE_SUPABASE_ANON_KEY, others VITE_SUPABASE_KEY — the app resolves that and
// hands us the value).
let cfg = { app: '', provider: '', mode: 'bridge', version: '', idpUrl: '', supabaseUrl: '', supabaseKey: '' };

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
    // Supabase custom-OIDC provider name. Most apps use `custom:<app>`, but some
    // (Konekt, Bisnis Stoa) share one `custom:bm` provider — pass `provider` to
    // override. Client ID on that provider must still equal the token `aud` (=app).
    provider:    c.provider || 'custom:' + (c.app || cfg.app || ''),
    // Supabase auth model. 'bridge' (default): exchange the BM JWT for a real
    // Supabase session via signInWithIdToken (RLS on user_metadata.phone) — the
    // WanBung/Rentim/SkulFi/Konekt/Bisnis/Bihain pattern. 'accessToken': pass the
    // BM JWT straight to Supabase as a third-party token (RLS on auth.jwt()->>'sub')
    // with no session — the WanPMV/Niubalus pattern. bmSignIn/Out are no-ops then.
    // 'redirect': Supabase's NATIVE Custom-OIDC flow — signInWithBM() (oidc.js)
    // redirects to the BM IdP's hosted login page; Supabase completes the code
    // exchange and mints its own session (BM claims land in user_metadata; RLS
    // on user_metadata->>'sub'). The Haus Stap pattern — proven live 14 Jul 2026.
    // NOTE: managed Supabase does NOT support signInWithIdToken for custom
    // providers, so 'bridge' only works where a session already exists — new
    // integrations should use 'redirect'.
    mode:        c.mode || cfg.mode || 'bridge',
    version:     c.version || cfg.version || '',   // build version for the footer tag
    idpUrl:      norm(c.idpUrl),
    supabaseUrl: String(c.supabaseUrl || '').trim(),
    supabaseKey: String(c.supabaseKey || '').trim(),
  };
  isBM = !!cfg.idpUrl;
  isVoucherEnabled = !!cfg.idpUrl;           // vouchers ride the IdP proxy
  isWallet = !!cfg.idpUrl;                   // Konekt Wallet rides the IdP
  isSms = !!cfg.idpUrl;                       // shared /sms/send rides the IdP
  supabase = makeSupabaseClient(cfg.supabaseUrl, cfg.supabaseKey, cfg.mode);
  isSupabase = !!supabase;
  return cfg;
}

// Build the client defensively — an unset OR malformed URL degrades to "no
// Supabase" (mock/offline) instead of white-screening the SPA, since
// createClient() throws synchronously on a bad URL. (Ported from Rentim.)
function makeSupabaseClient(url, key, mode) {
  if (!url || !key || url.includes('your-project')) return null;
  let validHttp = false;
  try { const u = new URL(url); validHttp = u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { validHttp = false; }
  if (!validHttp) {
    console.error(`[bm/client] VITE_SUPABASE_URL is not a valid http(s) URL — running without Supabase. Got: ${JSON.stringify(url)}`);
    return null;
  }
  try {
    if (mode === 'accessToken') {
      // No Supabase session — the BM JWT is handed to every request as a
      // third-party access token. getToken() is pulled lazily (dynamic import)
      // so config.js doesn't take a top-level dependency on auth.js (which
      // imports config.js). The import is cached after first use.
      return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        accessToken: async () => {
          const m = await import('./auth.js');
          return (await m.getToken()) || null;
        },
      });
    }
    if (mode === 'redirect') {
      // Native Custom-OIDC redirect flow: Supabase must detect the returning
      // ?code= in the URL and finish the PKCE exchange itself.
      return createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      });
    }
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
  if (cfg.mode === 'accessToken') return { error: null };  // no session bridge in accessToken mode
  if (cfg.mode === 'redirect') return { error: null };     // login IS the redirect — see oidc.js signInWithBM()
  if (!supabase || !bmToken) return { error: null };
  const { error } = await supabase.auth.signInWithIdToken({ provider: cfg.provider, token: bmToken });
  if (error) console.error('[bm/client] signInWithIdToken failed:', error.message);
  return { error };
}
export async function bmSignOut() {
  if (cfg.mode === 'accessToken') return;  // no Supabase session to end in accessToken mode
  if (!supabase) return;
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
}
