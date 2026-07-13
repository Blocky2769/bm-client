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
export * from './voucher.js';   // myVouchers, transferVoucher, cashoutVoucher, BUNDLE_LABELS, fmtRemaining, fmtBytes
export * from './wallet.js';    // balance, payeeBalance, pay, redeemVoucher
export * from './sms.js';       // send, sendSms
export { toE164 } from './phone.js';
export { default as PhoneInput, COUNTRIES, splitE164, isValidPhone } from './PhoneInput.jsx';
