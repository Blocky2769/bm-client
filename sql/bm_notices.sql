-- ============================================================================
-- BM standard in-app messages table ("toksave") - @bm/client/notices
-- Copy into an app's own Supabase and adapt ONLY the marked identity lines.
-- Pure ASCII (the Supabase SQL editor mangles anything else). Safe to re-run.
-- ----------------------------------------------------------------------------
-- WHY. Every BM app tells people things, and WhatsApp (via the IdP's /notify)
-- cannot always reach them: no WhatsApp, no data, wrong number - and a Konekt
-- customer whose voucher just ran out has no internet at all. So the app writes
-- the message here as well, and @bm/client/notices reads it back in the app.
--
-- RULES OF THE SHAPE
--  * BOTH languages are written when the message is created (message_en +
--    message_tp). A message never re-renders later, so wording can't drift.
--  * `dedupe` makes a message idempotent: a sweep that runs every minute writes
--    'voucher_low:<code>' and the unique index keeps exactly one.
--  * Only a SERVER (service key / security-definer function) writes rows. The
--    person may read their own and set read_at on their own - nothing else.
-- ============================================================================

create table if not exists bm_notices (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                       -- the app's own event name
  -- WHO IT IS FOR. Keep both: some people are known by BM id, some only by the
  -- phone the voucher/loan was bought under.
  bm_sub       text,                                -- BM identity (usr_...)
  phone        text,                                -- E.164, digits as stored by the app
  message_en   text not null,
  message_tp   text not null,
  data         jsonb,                               -- codes, amounts, ids for the screen
  dedupe       text unique,                         -- optional; one row per key
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists bm_notices_phone_idx  on bm_notices (phone, created_at desc);
create index if not exists bm_notices_bm_sub_idx on bm_notices (bm_sub, created_at desc);
create index if not exists bm_notices_unread_idx on bm_notices (read_at) where read_at is null;

alter table bm_notices enable row level security;

-- ── Identity: ADAPT THESE TWO POLICIES TO THE APP ───────────────────────────
-- The predicate below must name the app's own identity helper:
--   Konekt / Bisnis Stoa : right(phone, 8) = right(bm_phone(), 8)
--   WanBung / SkulFi     : bm_sub = (auth.jwt() ->> 'sub')  or an auth.uid() map
--   Haus Stap / Wan PMV  : bm_sub = (auth.jwt() ->> 'sub')
-- Never trust user_metadata for this (see the BM identity-spoof fixes, 16 Jul).
drop policy if exists bm_notices_read_own on bm_notices;
create policy bm_notices_read_own on bm_notices for select to authenticated
  using (bm_sub = (auth.jwt() ->> 'sub'));          -- <= ADAPT

-- Reading a message is the only thing a person may change about it.
drop policy if exists bm_notices_mark_read on bm_notices;
create policy bm_notices_mark_read on bm_notices for update to authenticated
  using (bm_sub = (auth.jwt() ->> 'sub'))           -- <= ADAPT (same predicate)
  with check (bm_sub = (auth.jwt() ->> 'sub'));     -- <= ADAPT (same predicate)

-- Nobody writes or deletes from an app: servers use the service key.
revoke insert, delete on bm_notices from anon, authenticated;
revoke update on bm_notices from anon, authenticated;
grant update (read_at) on bm_notices to authenticated;

-- Live updates while a screen is open (@bm/client onNotices).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and tablename = 'bm_notices')
  then execute 'alter publication supabase_realtime add table bm_notices'; end if;
end $$;

-- VERIFY (every row should read true) -----------------------------------------
select 'messages table present' as label,
       to_regclass('public.bm_notices') is not null as ok
union all
select 'row level security on',
       (select relrowsecurity from pg_class where oid = 'public.bm_notices'::regclass)
union all
select 'the app can only set read_at',
       not has_table_privilege('authenticated', 'public.bm_notices', 'insert')
       and not has_table_privilege('authenticated', 'public.bm_notices', 'delete')
       and has_column_privilege('authenticated', 'public.bm_notices', 'read_at', 'update')
       and not has_column_privilege('authenticated', 'public.bm_notices', 'message_en', 'update');
