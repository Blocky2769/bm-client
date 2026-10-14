# @bm/client

Shared Blockchain Melanesia client for all BM apps: BM IdP auth (phone-OTP,
email/password/TOTP, WebAuthn/passkey, QR device-link), the Supabase custom-OIDC
session bridge, the Konekt voucher client, and the E.164 `PhoneInput`.

One codebase serves every app — there is **no hardcoded app id and no
`import.meta.env`** inside the package. Each app configures it once at startup.

## Use it

```js
// main.jsx — before anything renders:
import { configureBm } from '@bm/client';
configureBm({
  app:         'wanbung',                        // → token aud + custom:wanbung provider
  // provider: 'custom:bm',                      // override when apps share one OIDC provider (Konekt, Bisnis, Bihain)
  // mode:     'accessToken',                     // Supabase auth model (see below); default 'bridge'
  // idleTimeoutMs: 3600000,                      // idle→re-login (see below); default 1h, 0 disables
  idpUrl:      import.meta.env.VITE_IDP_URL || import.meta.env.VITE_BM_IDP_URL,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseKey: import.meta.env.VITE_SUPABASE_KEY, // or VITE_SUPABASE_ANON_KEY — the app resolves it
});
```

### Passkeys (v1.11.0)
`webauthnLogin()` now works **without an email** — the browser offers any BM passkey on the device and the passkey says whose account it is
(it sends the IdP's `challenge_id`; older versions needed the email typed). A passkey is bound to `blockchainmelanesia.com`, so it only works on a page at
that domain or a subdomain: show the option only when `passkeysAvailable()` is true. People add a passkey on the IdP's hosted page — link them to
`passkeyAddUrl()` (a fresh phone/email sign-in is needed there).

### Supabase auth `mode`
- **`'bridge'`** (default) — exchanges the BM JWT for a real Supabase session via
  `signInWithIdToken`; RLS reads `user_metadata.phone`. Needs the app's `custom:<app>`
  OIDC provider configured on the Supabase project. Used by WanBung/Rentim/SkulFi/
  Konekt/Bisnis/Bihain. ⚠️ Managed Supabase does not support `signInWithIdToken` for
  custom providers — new integrations should use `'redirect'`.
- **`'accessToken'`** — hands the BM JWT to Supabase as a third-party access token on
  every request (no session); RLS reads `auth.jwt()->>'sub'`. `bmSignIn`/`bmSignOut`
  become no-ops. Used by WanPMV/Niubalus.
- **`'redirect'`** — Supabase's native Custom-OIDC flow: `signInWithBM()` (see `oidc.js`)
  redirects to the BM IdP hosted login page and Supabase mints its own session; RLS reads
  `user_metadata->>'sub'`. Used by Haus Stap.

### Idle-session timeout (`idleTimeoutMs`, default 1 hour)
Phone theft is common in PNG — a BM app left logged in on a stolen handset is an open
door across the ecosystem. After `idleTimeoutMs` with **no user activity** the session is
force logged out (BM token cleared + Supabase signed out) and the app drops to its login
screen. Any interaction resets the clock, so an operator working a full shift is never
interrupted — which matters because each forced re-login costs a Twilio OTP SMS.

Deliberately **idle**, not absolute: a stolen phone is idle by the time a thief opens it.
It works in all three modes, is enforced on cold start (a session that idled out while the
app was closed does not come back), and the activity stamp is shared across tabs via
`localStorage` (`${app}_bm_activity`). No per-app wiring — `configureBm()` starts it.
Pass `idleTimeoutMs: 0` to disable.

```js
// anywhere:
import { requestOtp, verifyOtp, requestOtpSms, getToken, logout, onAuthChange,
         currentClaims, supabase, isBM, PhoneInput, isValidPhone, toE164,
         myVouchers, transferVoucher } from '@bm/client';
```

### Login codes by WhatsApp (v1.9.0)
`requestOtp()` now tells the IdP which app is asking, so the IdP can send the code by
WhatsApp for apps that are switched on (`WHATSAPP_APPS` on the IdP) and record the
delivery per app. Nothing to configure per app — the id comes from `configureBm()`.
The reply carries `channel` (`'whatsapp'` or `'sms'`). When it is `'whatsapp'`, show a
"No WhatsApp? Send it by SMS instead" link that calls `requestOtpSms(phone)`: that
re-sends the SAME code once, after a short wait, so it can never cost more than one
extra message. It resolves `false` when there is nothing to re-send — hide the link.

### Bank + SWIFT top-up card (v1.12.0) — required in every app
Martin, 15 Oct 2026: every app integrated with BM IdP + BM Pay + BM Com shows this, so overseas (diaspora)
customers can always fund their BM Wallet. Put it wherever the app shows the user's wallet/account:

```jsx
import { BankTopUp } from '@bm/client';
<BankTopUp lang={lang} />          // 'en' | 'tpi'; renders nothing when signed out
```

It shows BM's biller code + the user's permanent CRN ("Pay a bill" at any PNG bank), the fee, recent bank top-ups,
and **Paying from overseas? (SWIFT)** — BM's BSP account + BIC with the CRN as the reference. Data comes from
`bankTopUp()` / `bankTopUpDeposits()` → BM IdP `GET /wallet/topup` (1.8.0+), which forwards the user's own token to
BM Pay `/biller/account`. Never call BM Pay `/biller/*` from the browser (BM Pay allows no app origins).
Own UI instead? `useBankTopUp()` + `<SwiftDetails swift crn lang />`. Inline styles, so it works with or without Tailwind.

**Redirect-mode apps (v1.13.0, needs BM IdP 1.9.0+):** apps that sign in through Supabase's custom OIDC (Haus Stap,
Wan PMV, Singsing, Yumitu, Niubalus Academy) now hold a BM token too: the IdP returns a refresh token from
`/oauth/token`, Supabase passes `provider_token` + `provider_refresh_token` to the app once after sign-in, and
`oidc.js` adopts them (`getToken()` then refreshes at the IdP like every other mode). Sessions from before this
change have no BM token: the card says "sign out and sign in again" until the user does.

### In-app messages (v1.10.0) — `@bm/client/notices`

The standard BM inbox. WhatsApp (through the IdP's `/notify`) is how a message
*travels*; this is where it *lives*, because WhatsApp can't always arrive — no
WhatsApp, no data, wrong number, and a Konekt customer whose voucher just ran out
has no internet at all. So the app writes the message to its own table as well.

Each app keeps its own table with the same shape — apply [`sql/bm_notices.sql`](sql/bm_notices.sql)
to the app's Supabase and adapt only the two marked identity lines. Both languages are
stored when the message is written, so wording never drifts and nothing re-renders.
Only a server (service key) writes rows; a person may read their own and set `read_at`.

```jsx
import { useNotices, NoticeBell, NoticeList } from '@bm/client/notices';

const { notices, unread, loading, markAllRead, text } = useNotices({ lang });
<NoticeBell count={unread} onClick={() => navigate('/messages')} />
<NoticeList notices={notices} lang={lang} renderIcon={k => (k === 'voucher_low' ? '📶' : '🔔')} />
```

The same row is also the **outbox**: give it `type` + `values` and a drain (a small edge
function or server tick) sends it through BM Com and stamps `sent_at`/`channel`. The app
writes the message once; the in-app copy exists whether or not WhatsApp could carry it.

`useNotices` updates live while the screen is open. `listNotices`, `unreadNoticeCount`,
`markNoticesRead`, `onNotices` and `noticeText` are there for a custom screen.

`supabase`, `isBM`, `isSupabase`, `isVoucherEnabled` are **live bindings** — read
them after `configureBm()` has run (it runs in `main.jsx` before render, so they're
correct on first use).

## Peer dependencies
The consuming app provides these (all BM apps already have them):
`react`, `@supabase/supabase-js`, `@simplewebauthn/browser`.

## Install (per app)
```jsonc
// package.json — pin an exact tag; bump deliberately per app:
"@bm/client": "github:Blocky2769/bm-client#v1.0.0"
```
Then `npm install`. No npm registry / publish step — npm installs straight from the
GitHub tag, and Netlify's normal `npm install` picks it up.

## Release a change
1. Edit `src/*`, commit.
2. `git tag v1.1.0 && git push --tags` (or GitHub Desktop).
3. In each app you want to update: bump the `#v1.x.x` in package.json → `npm install`
   → commit → redeploy. Apps you don't touch stay on their pinned version.

## Local development against an app (before this repo is on GitHub)
Install as a local file dep — `--install-links` copies it in (so peer deps resolve):
```
npm install "file:../../bm-client" --install-links
```
⚠️ A `file:` dependency will NOT build on Netlify. Switch package.json to the
`github:…#tag` form (above) before deploying.
