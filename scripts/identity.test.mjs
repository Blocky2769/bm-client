// Request shapes + error mapping for src/identity.js (BM ID identity, v1.19.0).
// No dependencies: the two peer deps the module graph pulls in (supabase-js,
// simplewebauthn) are stubbed by a tiny loader hook, and fetch is mocked.
//   node scripts/identity.test.mjs        (or: npm test)
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Loader: stub the peer deps; resolve the package's extensionless imports ──
const hooks = `
const STUB = {
  '@supabase/supabase-js': 'export const createClient = () => null;',
  '@simplewebauthn/browser': 'export const startRegistration = async () => ({}); export const startAuthentication = async () => ({});',
};
export async function resolve(spec, ctx, next) {
  if (STUB[spec]) return { url: 'data:text/javascript,' + encodeURIComponent(STUB[spec]), shortCircuit: true };
  if (spec.startsWith('.') && !/\\.[cm]?jsx?$/.test(spec)) {
    try { return await next(spec + '.js', ctx); } catch { /* fall through */ }
  }
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks), import.meta.url);

// ── A signed-in browser-ish environment ────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u_1', aud: 'testapp', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
store.set('testapp_bm_auth', JSON.stringify({ access: TOKEN, refresh: 'r' }));

const { configureBm } = await import('../src/config.js');
configureBm({ app: 'testapp', idpUrl: 'https://idp.test/', idleTimeoutMs: 0 });
const id = await import('../src/identity.js');

let calls = [];
let reply = () => ({ status: 200, body: {} });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
  const r = reply(url, init);
  if (r instanceof Error) throw r;
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
};
const reset = (fn) => { calls = []; reply = fn; };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const DOC = {
  idType: 'foreign_passport', country: 'au', fullName: '  Mary Kila ', dob: '1990-05-01',
  idNumberLast4: '12AB', docExpiry: '2030-01-01', docJpeg: 'data:image/jpeg;base64,' + JPEG, selfieJpeg: JPEG,
};

test('identityStatus: GET /identity/status with the BM bearer token', async () => {
  const st = { status: 'none', providers: { sevispass: { ready: false }, document: { ready: true } } };
  reset(() => ({ status: 200, body: st }));
  assert.deepEqual(await id.identityStatus(), st);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://idp.test/identity/status');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.authorization, 'Bearer ' + TOKEN);
});

test('submitIdentityDocument: snake_case body, prefix stripped, app from configureBm', async () => {
  reset(() => ({ status: 200, body: { id: 'idc_1', status: 'pending' } }));
  assert.deepEqual(await id.submitIdentityDocument(DOC), { id: 'idc_1', status: 'pending' });
  assert.equal(calls[0].url, 'https://idp.test/identity/document');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, {
    id_type: 'foreign_passport', country: 'AU', full_name: 'Mary Kila', dob: '1990-05-01',
    id_number_last4: '12AB', doc_expiry: '2030-01-01', doc_jpeg: JPEG, selfie_jpeg: JPEG, app: 'testapp',
  });
});

test('submitIdentityDocument: optional fields left out, country defaults to PG, app override', async () => {
  reset(() => ({ status: 200, body: { id: 'idc_2', status: 'pending' } }));
  await id.submitIdentityDocument({ ...DOC, idType: 'png_nid', country: undefined, idNumberLast4: '', docExpiry: '', app: 'academy' });
  const b = calls[0].body;
  assert.equal(b.country, 'PG');
  assert.equal(b.app, 'academy');
  assert.ok(!('id_number_last4' in b));
  assert.ok(!('doc_expiry' in b));
});

test('submitIdentityDocument: refuses bad input before any upload', async () => {
  reset(() => ({ status: 200, body: {} }));
  await assert.rejects(id.submitIdentityDocument({ ...DOC, idType: 'sevispass' }), { name: 'IdentityError', code: 'invalid' });
  await assert.rejects(id.submitIdentityDocument({ ...DOC, selfieJpeg: '' }), { code: 'invalid' });
  const big = Buffer.alloc(id.MAX_IDENTITY_JPEG_BYTES + 1, 0xff).toString('base64');
  await assert.rejects(id.submitIdentityDocument({ ...DOC, docJpeg: big }), { code: 'too_big' });
  assert.equal(calls.length, 0);
});

const cases = [
  [409, 'already pending', 'already_pending'],
  [409, 'already verified', 'already_verified'],
  [413, 'too big', 'too_big'],
  [415, 'not JPEG', 'not_jpeg'],
  [429, 'rate', 'rate_limited'],
  [503, 'document route not ready', 'not_ready'],
  [500, 'boom', 'failed'],
];
for (const [status, error, code] of cases) {
  test(`submitIdentityDocument: ${status} "${error}" → ${code}`, async () => {
    reset(() => ({ status, body: { error } }));
    await assert.rejects(id.submitIdentityDocument(DOC), e => {
      assert.ok(e instanceof id.IdentityError);
      assert.equal(e.code, code); assert.equal(e.status, status); assert.equal(e.message, error);
      return true;
    });
  });
}

test('network failure → offline; no body → status-based message', async () => {
  reset(() => new TypeError('Failed to fetch'));
  await assert.rejects(id.identityStatus(), { code: 'offline' });
  reset(() => ({ status: 429, body: undefined }));
  await assert.rejects(id.identityStatus(), { code: 'rate_limited', message: 'identity 429' });
});

test('startSevisPass: POST return_to + app, resolves the url', async () => {
  reset(() => ({ status: 200, body: { url: 'https://sevispass.example/authorize?x=1' } }));
  const url = await id.startSevisPass({ returnTo: 'https://academy.test/exam?identity=failed&a=1', app: 'academy' });
  assert.equal(url, 'https://sevispass.example/authorize?x=1');
  assert.equal(calls[0].url, 'https://idp.test/identity/sevispass/start');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { return_to: 'https://academy.test/exam?identity=failed&a=1', app: 'academy' });
});

test('startSevisPass: 503 sevispass_not_ready → sevispass_not_ready; missing url → failed', async () => {
  reset(() => ({ status: 503, body: { error: 'sevispass_not_ready' } }));
  await assert.rejects(id.startSevisPass({ returnTo: 'https://a.test/' }), { code: 'sevispass_not_ready', status: 503 });
  reset(() => ({ status: 200, body: {} }));
  await assert.rejects(id.startSevisPass({ returnTo: 'https://a.test/' }), { code: 'failed' });
});

test('withdrawIdentity: POST /identity/withdraw', async () => {
  reset(() => ({ status: 200, body: { ok: true } }));
  await id.withdrawIdentity();
  assert.equal(calls[0].url, 'https://idp.test/identity/withdraw');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, {});
});

test('signed out → signed_out, no request', async () => {
  store.delete('testapp_bm_auth');
  const auth = await import('../src/auth.js');
  auth.dropBmTokens();
  reset(() => ({ status: 200, body: {} }));
  await assert.rejects(id.identityStatus(), { code: 'signed_out' });
  assert.equal(calls.length, 0);
  auth.adoptBmTokens(TOKEN, 'r');   // back in for any later test
});

test('helpers: base64Bytes, identityReturnUrl, takeIdentityReturn', () => {
  assert.equal(id.base64Bytes(Buffer.alloc(10).toString('base64')), 10);
  assert.equal(id.base64Bytes('data:image/jpeg;base64,' + Buffer.alloc(11).toString('base64')), 11);
  assert.equal(id.identityReturnUrl('https://a.test/x?identity=verified&b=2#h'), 'https://a.test/x?b=2#h');

  let replaced = null;
  globalThis.window = {
    location: { href: 'https://a.test/exam?b=2&identity=verified#top' },
    history: { state: null, replaceState: (_s, _t, u) => { replaced = u; } },
  };
  assert.equal(id.takeIdentityReturn(), 'verified');
  assert.equal(replaced, '/exam?b=2#top');
  window.location.href = 'https://a.test/exam?identity=anything';
  assert.equal(id.takeIdentityReturn(), 'failed');
  window.location.href = 'https://a.test/exam';
  assert.equal(id.takeIdentityReturn(), null);
  delete globalThis.window;
});
