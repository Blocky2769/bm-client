# Changelog — @bm/client

- **Unreleased** — `wallet.pay(payee, amount, ref, idem?)` now always sends an idempotency key (yours, or a new one) and retries once, with the same key, if the network drops. Needed before BM IdP turns on `BM_WALLET_REQUIRE_IDEM`.
- **v1.18.3** (8 Nov 2026) — docs only, no code change: README section on the `signed_out` answer that sign-in calls can give since v1.18.2, and what apps must do with it.
- **v1.18.2** (8 Nov 2026) — map labels shown as text (cross-site scripting fix); a logout beats a token refresh in flight; a sign-out in one tab signs the others out; "Pay now" top-up link only to https on blockchainmelanesia.com (or `payHosts`). Sign-in calls can now resolve `{ ok: false, error: 'signed_out' }`.
- Earlier versions: see the git tags and commit messages.
