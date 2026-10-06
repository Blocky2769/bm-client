// @bm/client/notices — the shared bell + message list.
//
// Screens stay the app's own; these are the two pieces every app was otherwise
// hand-copying (Dinau Buk, WanBung, Rentim, Bisnis Stoa all grew their own).
// Tailwind classes only, neutral colours — pass className to brand them.
import { useCallback, useEffect, useState } from 'react';
import { listNotices, markNoticesRead, onNotices, noticeText } from './notices.js';

export * from './notices.js';   // one import: `from '@bm/client/notices'`

/** Everything a messages screen needs:
 *    const { notices, unread, loading, reload, markAllRead } = useNotices({ lang })
 *  `live` keeps it up to date while the screen is open. */
export function useNotices({ lang = 'en', limit = 50, live = true } = {}) {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await listNotices({ limit });
    setNotices(rows);
    setLoading(false);
    return rows;
  }, [limit]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const rows = await listNotices({ limit });
      if (!alive) return;                 // screen closed while it was loading
      setNotices(rows);
      setLoading(false);
    };
    run();
    const off = live ? onNotices(run) : () => {};
    return () => { alive = false; off(); };
  }, [limit, live]);

  const markAllRead = useCallback(async () => {
    const unreadIds = notices.filter(n => !n.readAt).map(n => n.id);
    if (!unreadIds.length) return;
    const now = new Date().toISOString();
    setNotices(prev => prev.map(n => (n.readAt ? n : { ...n, readAt: now })));   // instant to the eye
    const ok = await markNoticesRead(unreadIds);
    if (!ok) reload();                                                          // put it back if it failed
  }, [notices, reload]);

  return {
    notices, loading, reload, markAllRead,
    unread: notices.filter(n => !n.readAt).length,
    text: n => noticeText(n, lang),
  };
}

/** Bell with an unread count. */
export function NoticeBell({ count = 0, onClick, label = 'Messages', className = '' }) {
  return (
    <button onClick={onClick} aria-label={count ? `${label} (${count} unread)` : label}
      className={`relative rounded-full p-2 transition-colors hover:bg-black/5 ${className}`}>
      <span aria-hidden="true" className="text-lg">🔔</span>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-black leading-[18px] text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso), mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return d.toLocaleDateString();
};

/** The list itself. `renderIcon(kind)` lets an app put its own emoji per event. */
export function NoticeList({ notices = [], lang = 'en', empty = 'No messages yet.', renderIcon, className = '' }) {
  if (!notices.length) return <p className={`py-8 text-center text-sm text-gray-400 ${className}`}>{empty}</p>;
  return (
    <div className={`space-y-2 ${className}`}>
      {notices.map(n => (
        <div key={n.id}
          className={`rounded-2xl border p-3 ${n.readAt ? 'border-gray-100 bg-white' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-2">
            {renderIcon && <span aria-hidden="true" className="text-base leading-5">{renderIcon(n.kind)}</span>}
            <div className="min-w-0 flex-1">
              <p className={`text-sm leading-snug ${n.readAt ? 'text-gray-700' : 'font-bold text-gray-900'}`}>
                {noticeText(n, lang)}
              </p>
              <p className="mt-1 text-[11px] text-gray-400">{when(n.createdAt)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
