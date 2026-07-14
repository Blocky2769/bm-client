// Native Custom-OIDC login (mode: 'redirect') — the Haus Stap pattern, proven
// live 14 Jul 2026. signInWithBM() redirects to the BM IdP's hosted login page
// (phone / email+TOTP / passkey, bilingual EN/Tok Pisin); Supabase completes the
// authorization-code exchange and mints its OWN session. The BM claims land in
// session.user.user_metadata (sub = the BM user_id `usr_…`; the top-level id is
// a Supabase UUID), so RLS keys on auth.jwt()->'user_metadata'->>'sub'.
//
// Requires: configureBm({ mode: 'redirect', provider: 'custom:bm', … }) and the
// Supabase project to have the matching Custom OIDC provider configured
// (Issuer = the BM IdP, Client ID = the app, secret matching BM_OAUTH_*_SECRET).
import { supabase, bmConfig } from './config.js';

// Session cache so data layers can read the BM uid synchronously.
let _session = null;
let _wired = false;
const subs = new Set();
function wire() {
  if (_wired || !supabase) return;
  _wired = true;
  supabase.auth.getSession().then(({ data }) => { _session = data.session; subs.forEach(f => { try { f(_session); } catch { /* ignore */ } }); });
  supabase.auth.onAuthStateChange((_e, s) => { _session = s; subs.forEach(f => { try { f(s); } catch { /* ignore */ } }); });
}

// Redirect to the BM hosted login. Returns supabase-js's { data, error }.
export async function signInWithBM(opts = {}) {
  wire();
  if (!supabase) return { error: new Error('Supabase not configured') };
  return supabase.auth.signInWithOAuth({
    provider: bmConfig().provider,
    options: {
      redirectTo: opts.redirectTo || (typeof window !== 'undefined' ? window.location.origin : undefined),
      ...opts.options,
    },
  });
}

export function currentSession() { wire(); return _session; }

// The BM user_id RLS keys on — read from wherever Supabase placed the OIDC
// claims (custom-OIDC puts them under user_metadata; the top-level id is the
// last resort).
export function currentBmUid() {
  wire();
  const u = _session?.user;
  if (!u) return null;
  const m = u.user_metadata || {};
  return m.sub || m.provider_id || u.id || null;
}

// Identity-agnostic display mapping of the session user (phone OR email login).
export function bmUserFromSession(session = _session) {
  const u = session?.user;
  if (!u) return null;
  const m = u.user_metadata || {};
  return {
    user_id: m.sub || m.provider_id || u.id,
    phone: m.phone || null,
    email: u.email || m.email || null,
    name: m.name || m.full_name || u.email || m.phone || 'Guest',
  };
}

// Subscribe to session changes; returns an unsubscribe fn.
export function onSessionChange(cb) { wire(); subs.add(cb); return () => subs.delete(cb); }
