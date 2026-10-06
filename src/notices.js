// @bm/client — in-app messages ("toksave"), the standard BM inbox.
//
// Every BM app tells people things: your Wi-Fi is nearly finished, your
// repayment is due, your fundraiser reached its goal. Those messages go out on
// WhatsApp through the BM IdP's /notify, but WhatsApp only reaches someone who
// has it, has data and has their number on it — at a Konekt kiosk a customer
// whose voucher just ran out has no internet at all. So the message is ALWAYS
// written to the app's own messages table too, and this module reads it back.
//
// Each app keeps its own table (its own Supabase), all with the same shape —
// see sql/bm_notices.sql. Who may read which row is the app's RLS, exactly as
// it is for every other table; this module never filters by person itself.
//
//   import { useNotices, NoticeBell } from '@bm/client/notices'
//
// Both languages are stored when the message is WRITTEN (message_en +
// message_tp), the way Dinau Buk does it, so a message never changes wording
// later and nothing has to be re-rendered from a code and a blob of values.
import { bmConfig, supabase } from './config.js';

const table = () => bmConfig().noticesTable || 'bm_notices';

export function rowToNotice(r) {
  return {
    id: r.id,
    kind: r.kind,                                   // app's own event name, e.g. 'voucher_low'
    messageEn: r.message_en || '',
    messageTp: r.message_tp || '',
    data: r.data || null,                           // anything the screen wants (code, amounts…)
    readAt: r.read_at || null,
    createdAt: r.created_at || null,
  };
}

/** The message in the reader's language, falling back to English. */
export const noticeText = (n, lang) => (lang === 'tpi' && n?.messageTp) || n?.messageEn || '';

/** Newest first. Returns [] when Supabase isn't configured — never throws. */
export async function listNotices({ limit = 50 } = {}) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from(table())
      .select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) return [];
    return (data || []).map(rowToNotice);
  } catch { return []; }
}

/** How many the person hasn't read — for the bell. */
export async function unreadNoticeCount() {
  if (!supabase) return 0;
  try {
    const { count, error } = await supabase.from(table())
      .select('id', { count: 'exact', head: true }).is('read_at', null);
    return error ? 0 : (count || 0);
  } catch { return 0; }
}

/** Mark some (or, with no ids, all unread) as read. The app's RLS must allow
 *  the reader to set read_at on their own rows and nothing else. */
export async function markNoticesRead(ids) {
  if (!supabase) return false;
  try {
    let q = supabase.from(table()).update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (Array.isArray(ids) && ids.length) q = q.in('id', ids);
    const { error } = await q;
    return !error;
  } catch { return false; }
}

/** Live updates while the screen is open; returns an unsubscribe function. */
export function onNotices(cb) {
  if (!supabase || typeof cb !== 'function') return () => {};
  try {
    const ch = supabase.channel('bm-notices-' + (bmConfig().app || 'app'))
      .on('postgres_changes', { event: '*', schema: 'public', table: table() }, () => cb())
      .subscribe();
    return () => { try { ch.unsubscribe(); } catch { /* already gone */ } };
  } catch { return () => {}; }
}
