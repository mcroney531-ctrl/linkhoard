-- Migration: allow custom (free-text) categories.
-- Run this in the Supabase SQL editor for the Link Hoarder project.

-- Remove the fixed-list CHECK constraint so any category string is accepted.
alter table links drop constraint if exists links_category_check;

-- (Status keeps its CHECK constraint — those stay fixed.)
