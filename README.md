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
  idpUrl:      import.meta.env.VITE_IDP_URL || import.meta.env.VITE_BM_IDP_URL,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseKey: import.meta.env.VITE_SUPABASE_KEY, // or VITE_SUPABASE_ANON_KEY — the app resolves it
});
```

```js
// anywhere:
import { requestOtp, verifyOtp, getToken, logout, onAuthChange, currentClaims,
         supabase, isBM, PhoneInput, isValidPhone, toE164,
         myVouchers, transferVoucher } from '@bm/client';
```

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
