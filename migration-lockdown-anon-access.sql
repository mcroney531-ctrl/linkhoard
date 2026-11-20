-- Migration: lock links/categories to the server's service role.
--
-- APPLIED 2026-11-20 ~21:40 UTC on the Link Hoarder project via the SQL editor.
-- Kept here as the source of record. Idempotent: safe to re-run, and a no-op
-- against the current production state.
--
-- Why: the "service role full access" policies had no `to` clause, so they
-- applied to role public — anyone with the publishable (anon) key could read
-- and modify every link. anon/authenticated also held full table grants.
-- The server only ever connects with SUPABASE_SERVICE_ROLE_KEY, which bypasses
-- RLS, so it needs neither the policies nor the anon grants.
--
-- Verified after applying: anon and authenticated get 42501 permission denied
-- for select/insert/update/delete on both tables (and truncate on links);
-- service_role reads and writes; app load/save/edit returned 200/201/200.

alter table public.links      enable row level security;
alter table public.categories enable row level security;

drop policy if exists "service role full access"            on public.links;
drop policy if exists "service role full access categories" on public.categories;

revoke all on public.links      from anon, authenticated;
revoke all on public.categories from anon, authenticated;

-- ROLLBACK (restores the previous, vulnerable state — emergency use only):
-- grant delete, insert, references, select, trigger, truncate, update on public.links      to anon, authenticated;
-- grant delete, insert, references, select, trigger, truncate, update on public.categories to anon, authenticated;
-- create policy "service role full access"            on public.links      as permissive for all to public using (true) with check (true);
-- create policy "service role full access categories" on public.categories as permissive for all to public using (true) with check (true);
