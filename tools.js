import { supabase } from './db.js';
import { fetchMeta } from './fetch-meta.js';

const VALID_STATUSES = ['unread', 'skimmed', 'act-on-it', 'archived'];

// Resolve a full UUID or a short id prefix (e.g. first 8 chars from list_links)
// to a full id. `id` is a uuid column, so ilike/prefix matching can't run in the
// query — resolve it client-side, then filter with .eq on the real uuid.
async function resolveId(id) {
  if (id.length === 36) return { id };
  const { data, error } = await supabase.from('links').select('id');
  if (error) return { error: error.message };
  const matches = data.filter(r => r.id.startsWith(id));
  if (matches.length === 0) return { error: `No link found with id "${id}"` };
  if (matches.length > 1) return { error: `id prefix "${id}" is ambiguous (${matches.length} matches); use more characters` };
  return { id: matches[0].id };
}

// ── save_link ──────────────────────────────────────────────────────────────────
export async function saveLink({ url, category = 'other', tags = [], notes = '', status = 'unread' }) {
  if (!url) return err('url is required');
  if (!VALID_STATUSES.includes(status)) {
    return err(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from('links')
    .select('id, title')
    .eq('url', url)
    .maybeSingle();

  if (existing) {
    return ok(`Already saved: "${existing.title || url}" (id: ${existing.id})`);
  }

  const { title, description } = await fetchMeta(url);

  const { data, error } = await supabase
    .from('links')
    .insert({
      url,
      title,
      description,
      category,
      tags: tags.filter(Boolean),
      status,
      notes: notes || null,
      last_touched_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return err(error.message);

  return ok(`Saved: "${data.title || url}"\nID: ${data.id}\nCategory: ${data.category} | Status: ${data.status}${data.tags.length ? '\nTags: ' + data.tags.join(', ') : ''}`);
}

// ── list_links ─────────────────────────────────────────────────────────────────
export async function listLinks({ status, category, tag, limit = 20, offset = 0 }) {
  let q = supabase
    .from('links')
    .select('id, url, title, category, tags, status, notes, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  if (tag) q = q.contains('tags', [tag]);

  const { data, error } = await q;
  if (error) return err(error.message);
  if (!data.length) return ok('No links found matching those filters.');

  const lines = data.map(l =>
    `[${l.id.slice(0, 8)}] ${l.title || l.url}\n  ${l.url}\n  ${l.category} | ${l.status}${l.tags.length ? ' | ' + l.tags.join(', ') : ''}${l.notes ? '\n  Note: ' + l.notes : ''}`
  );

  return ok(`${data.length} link(s):\n\n${lines.join('\n\n')}`);
}

// ── update_link ────────────────────────────────────────────────────────────────
export async function updateLink({ id, status, category, tags, notes }) {
  if (!id) return err('id is required');

  const updates = { last_touched_at: new Date().toISOString() };
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) return err(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    updates.status = status;
  }
  if (category !== undefined) {
    updates.category = category;
  }
  if (tags !== undefined) updates.tags = tags.filter(Boolean);
  if (notes !== undefined) updates.notes = notes || null;

  // Accept short ID prefix (first 8 chars) or full UUID
  const resolved = await resolveId(id);
  if (resolved.error) return err(resolved.error);

  const { data, error } = await supabase.from('links').update(updates).eq('id', resolved.id).select().single();
  if (error) return err(error.message);

  return ok(`Updated: "${data.title || data.url}" → status: ${data.status}`);
}

// ── search_links ───────────────────────────────────────────────────────────────
export async function searchLinks({ query, limit = 20 }) {
  if (!query) return err('query is required');

  const { data, error } = await supabase
    .from('links')
    .select('id, url, title, description, category, tags, status, created_at')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%,url.ilike.%${query}%,notes.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return err(error.message);
  if (!data.length) return ok(`No results for "${query}"`);

  const lines = data.map(l =>
    `[${l.id.slice(0, 8)}] ${l.title || l.url}\n  ${l.url}\n  ${l.category} | ${l.status}${l.tags.length ? ' | ' + l.tags.join(', ') : ''}`
  );

  return ok(`${data.length} result(s) for "${query}":\n\n${lines.join('\n\n')}`);
}

// ── delete_link ────────────────────────────────────────────────────────────────
export async function deleteLink({ id }) {
  if (!id) return err('id is required');

  const resolved = await resolveId(id);
  if (resolved.error) return err(resolved.error);

  const { data, error } = await supabase.from('links').delete().eq('id', resolved.id).select().single();
  if (error) return err(error.message);

  return ok(`Deleted: "${data.title || data.url}"`);
}

// ── helpers ────────────────────────────────────────────────────────────────────
function ok(text) {
  return { content: [{ type: 'text', text }] };
}
function err(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
