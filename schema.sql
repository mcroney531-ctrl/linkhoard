-- Link Hoarder — Supabase schema
-- Run this in the Supabase SQL editor for your new Link Hoarder project.

create extension if not exists "pgcrypto";

create table if not exists links (
  id              uuid primary key default gen_random_uuid(),
  url             text not null,
  title           text,
  description     text,
  category        text not null default 'other'
                    check (category in ('article','tool','reference','video','shopping','resource','thread','other')),
  tags            text[] not null default '{}',
  status          text not null default 'unread'
                    check (status in ('unread','skimmed','act-on-it','archived')),
  notes           text,
  created_at      timestamptz not null default now(),
  last_touched_at timestamptz not null default now()
);

-- Unique URL — no accidental duplicates
alter table links add constraint links_url_unique unique (url);

-- Indexes for common filter/sort patterns
create index if not exists links_status_idx      on links (status);
create index if not exists links_category_idx    on links (category);
create index if not exists links_created_at_idx  on links (created_at desc);
create index if not exists links_tags_gin_idx    on links using gin (tags);

-- Full-text search index across title + description + notes
create index if not exists links_fts_idx on links using gin (
  to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(notes, '')
  )
);

-- Enable Row Level Security (disable for service-role-key server access — keep for future user auth)
alter table links enable row level security;

-- Allow unrestricted access via service role (MCP server uses service role key)
create policy "service role full access"
  on links for all
  using (true)
  with check (true);
