// ── Idle-session timeout ──────────────────────────────────────────
// Phone theft is common in PNG, and a BM app left logged in on a stolen handset
// is an open door across the whole ecosystem (wallet, book-up, school fees, ride
// history). After `idleTimeoutMs` with NO user activity the session is force
// logged out; any interaction resets the clock.
//
// Deliberately an IDLE timer, not an absolute one: a stolen phone is idle by the
// time a thief opens it, while an operator working a full shift is never
// interrupted — which matters because every forced re-login costs a Twilio OTP
// SMS (expensive in PNG).
//
// The activity stamp lives in localStorage so it survives reloads AND is shared
// across tabs (activity in one tab keeps the others alive). Expiry calls
// auth.logout(), which clears the BM token and signs Supabase out — so this
// covers all three modes (bridge / accessToken / redirect).
import { bmConfig } from './config';

const CHECK_MS = 30_000;   // how often we test for expiry
const STAMP_MS = 30_000;   // throttle: at most one localStorage write per 30s

let installed = false;
let lastStamp = 0;

const key = () => `${bmConfig().app}_bm_activity`;

export function markActivity() {
  const now = Date.now();
  if (now - lastStamp < STAMP_MS) return;   // throttled — don't thrash localStorage
  lastStamp = now;
  try { localStorage.setItem(key(), String(now)); } catch { /* ignore */ }
}

export function clearActivity() {
  lastStamp = 0;
  try { localStorage.removeItem(key()); } catch { /* ignore */ }
}

function lastActivity() {
  try { const v = Number(localStorage.getItem(key())); return Number.isFinite(v) && v > 0 ? v : 0; }
  catch { return 0; }
}

// True ONLY when a stamp exists and is older than the window. No stamp means
// there's no session to expire (e.g. sitting on the login screen), so this stays
// false and the watcher never fires pointlessly.
export function idleExpired() {
  const ms = bmConfig().idleTimeoutMs;
  if (!ms) return false;                    // 0 disables the feature
  const last = lastActivity();
  return !!last && Date.now() - last > ms;
}

async function enforce() {
  if (!idleExpired()) return;
  clearActivity();                          // clear first so this fires once, not every tick
  try {
    const m = await import('./auth.js');    // dynamic: auth.js statically imports this module
    m.logout();                             // clears the BM token + signs Supabase out + notifies
  } catch { /* non-fatal */ }
}

// Started automatically by configureBm() — no per-app wiring.
export function startIdleWatch() {
  if (installed || typeof window === 'undefined') return;
  if (!bmConfig().idleTimeoutMs) return;
  installed = true;

  const bump = () => markActivity();
  // capture:true so activity counts even if a handler stops propagation.
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(e =>
    window.addEventListener(e, bump, { passive: true, capture: true }));
  // Coming BACK to a backgrounded tab counts as activity; leaving does not.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bump(); });

  setInterval(enforce, CHECK_MS);

  // Cold start: a session that idled out while the app was closed must not come
  // back. Otherwise, adopt the existing clock — or start one for a session that
  // predates this feature (no stamp yet).
  if (idleExpired()) enforce();
  else if (!lastActivity()) markActivity();
}
