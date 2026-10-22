// @bm/client — shared Blockchain Melanesia client. Configure once per app:
//
//   import { configureBm } from '@bm/client';
//   configureBm({
//     app: 'wanbung',
//     idpUrl:      import.meta.env.VITE_BM_IDP_URL,
//     supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
//     supabaseKey: import.meta.env.VITE_SUPABASE_KEY,   // (or VITE_SUPABASE_ANON_KEY)
//   });
//
// then import { requestOtp, supabase, PhoneInput, … } from '@bm/client'.

export {
  configureBm, bmConfig,
  supabase, isSupabase, isBM, isVoucherEnabled, isWallet, isSms,
  bmSignIn, bmSignOut,
} from './config.js';

export * from './auth.js';      // OTP, email, TOTP, WebAuthn, QR, getToken, onAuthChange, currentClaims, lastKnownClaims, setBmName, decodeJwt, logout
export * from './oidc.js';      // mode:'redirect' — signInWithBM, currentSession, currentBmUid, bmUserFromSession, onSessionChange
export * from './voucher.js';   // myVouchers, transferVoucher, cashoutVoucher, BUNDLE_LABELS, fmtRemaining, fmtBytes
export * from './wallet.js';    // balance, payeeBalance, pay, redeemVoucher, bankTopUp, bankTopUpDeposits
export * from './sms.js';       // send, sendSms
export { toE164 } from './phone.js';
export { default as PhoneInput, COUNTRIES, splitE164, isValidPhone } from './PhoneInput.jsx';
export { VersionTag } from './VersionTag.jsx';
export { BankTopUp, SwiftDetails, useBankTopUp } from './BankTopUp.jsx';   // bank + SWIFT top-up card — every app shows it
export * from './identity.js';  // identityStatus, submitIdentityDocument, startSevisPass, withdrawIdentity, resizeToJpeg, takeIdentityReturn, IdentityError, ID_TYPES
export { IdentityCheck, useIdentityStatus } from './IdentityCheck.jsx';   // BM ID identity check card (SevisPass or photo ID + selfie)
