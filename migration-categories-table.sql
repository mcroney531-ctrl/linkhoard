-- Migration: persist a category taxonomy so empty category "bins" can exist
-- independently of whether any link uses them yet.
-- Run this in the Supabase SQL editor for the Link Hoarder project.

create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table categories enable row level security;

create policy "service role full access categories"
  on categories for all
  using (true)
  with check (true);
