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
import { adoptBmTokens, dropBmTokens, decodeJwt, currentClaims } from './auth.js';

// Session cache so data layers can read the BM uid synchronously.
let _session = null;
let _wired = false;
const subs = new Set();
function wire() {
  if (_wired || !supabase) return;
  _wired = true;
  // Subscribers run on the NEXT tick, never inside supabase-js's callback: onAuthStateChange fires while the
  // auth lock is held (e.g. during the ?code= exchange on the return from the hosted login), and a subscriber
  // that awaits any Supabase call there deadlocks — the app hangs on its first sign-in until it is restarted
  // (Niubalus Academy, 13 Oct 2026). Deferring is what supabase-js documents for this.
  const notify = s => setTimeout(() => subs.forEach(f => { try { f(s); } catch { /* ignore */ } }), 0);
  supabase.auth.getSession().then(({ data }) => { _session = data.session; syncBmTokens(null, _session); notify(_session); });
  supabase.auth.onAuthStateChange((e, s) => { _session = s; syncBmTokens(e, s); notify(s); });
}

// Keep @bm/client's BM token (getToken()) in step with the Supabase session. Right after sign-in Supabase
// carries the IdP's own tokens (provider_token / provider_refresh_token, IdP 1.9.0+): adopt them. They are
// only there once (a Supabase token refresh drops them) — from then on auth.js refreshes at the IdP itself.
// Signed out, or a stored BM token for a different person than this session → drop it.
function syncBmTokens(event, s) {
  if (event === 'SIGNED_OUT' || !s) { if (event === 'SIGNED_OUT') dropBmTokens(); return; }
  const uid = (s.user?.user_metadata || {}).sub || null;
  const pc = s.provider_token ? decodeJwt(s.provider_token) : null;
  const held = currentClaims();
  if (pc && typeof pc.sub === 'string' && pc.sub.startsWith('usr_') && (!uid || pc.sub === uid)) {
    // Supabase keeps the ORIGINAL provider tokens in its stored session. Once auth.js has refreshed (the
    // refresh token rotates), re-adopting them would swap a live pair for a spent one — so adopt only a
    // provider token newer than the one held for this person (a fresh sign-in).
    if (!held || held.sub !== pc.sub || (pc.iat || 0) > (held.iat || 0)) adoptBmTokens(s.provider_token, s.provider_refresh_token);
    return;
  }
  if (held && uid && held.sub !== uid) dropBmTokens();
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

// Read the Supabase session now and adopt its BM tokens (if it carries them) before a BM API call —
// for callers that may run before anything else has wired the session listener. Returns the session.
export async function syncBmFromSession() {
  wire();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession().catch(() => ({ data: {} }));
  _session = data?.session || null;
  syncBmTokens(null, _session);
  return _session;
}

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
