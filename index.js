// Railway entry point — SSE/HTTP transport + REST API for PWA
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import http from 'http';
import { createServer } from './server.js';
import { supabase } from './db.js';
import { fetchMeta } from './fetch-meta.js';

const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;

const VALID_STATUSES   = ['unread','skimmed','act-on-it','archived'];

function authOk(req) {
  if (!API_TOKEN) return true; // no token configured = open (dev only)
  const h = req.headers['authorization'] || '';
  return h === `Bearer ${API_TOKEN}`;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  // ── Health ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // ── MCP SSE ───────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/sse') {
    const mcpServer = createServer();
    const transport = new SSEServerTransport('/message', res);
    await mcpServer.connect(transport);
    return;
  }

  // ── Meta fetch ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/meta') {
    if (!authOk(req)) return json(res, 401, { error: 'Unauthorized' });
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) return json(res, 400, { error: 'url param required' });
    const meta = await fetchMeta(targetUrl);
    return json(res, 200, meta);
  }

  // ── REST API ──────────────────────────────────────────────────────────────
  if (path.startsWith('/api/')) {
    if (!authOk(req)) return json(res, 401, { error: 'Unauthorized' });

    // GET /api/categories — defaults + stored taxonomy + categories already in use (for dropdowns)
    if (req.method === 'GET' && path === '/api/categories') {
      const [linksRes, catsRes] = await Promise.all([
        supabase.from('links').select('category'),
        supabase.from('categories').select('name'),
      ]);
      if (linksRes.error) return json(res, 500, { error: linksRes.error.message });
      const defaults = ['article','tool','reference','video','shopping','resource','thread','other'];
      const used = (linksRes.data || []).map(r => r.category).filter(Boolean);
      const stored = (catsRes.data || []).map(r => r.name); // empty if table not migrated yet
      const all = [...new Set([...defaults, ...stored, ...used])].sort();
      return json(res, 200, all);
    }

    // GET /api/categories/stored — only the persisted taxonomy (drives Home's empty bins)
    if (req.method === 'GET' && path === '/api/categories/stored') {
      const { data, error } = await supabase.from('categories').select('name').order('name');
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, (data || []).map(r => r.name));
    }

    // POST /api/categories — create a category (idempotent)
    if (req.method === 'POST' && path === '/api/categories') {
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      const name = (body.name || '').trim().toLowerCase();
      if (!name) return json(res, 400, { error: 'name is required' });
      if (name === 'other') return json(res, 400, { error: '"other" is the Unassigned bin and cannot be created' });
      const { data, error } = await supabase.from('categories')
        .upsert({ name }, { onConflict: 'name' }).select().single();
      if (error) return json(res, 500, { error: error.message });
      return json(res, 201, data);
    }

    // DELETE /api/categories/:name — remove a category from the taxonomy
    const catDel = path.match(/^\/api\/categories\/(.+)$/);
    if (req.method === 'DELETE' && catDel) {
      const name = decodeURIComponent(catDel[1]);
      const { error } = await supabase.from('categories').delete().eq('name', name);
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, { ok: true });
    }

    // GET /api/links?status=&category=&tag=&limit=&offset=&q=
    if (req.method === 'GET' && path === '/api/links') {
      const q = url.searchParams.get('q');
      if (q) {
        const { data, error } = await supabase
          .from('links')
          .select('*')
          .or(`title.ilike.%${q}%,description.ilike.%${q}%,url.ilike.%${q}%,notes.ilike.%${q}%`)
          .order('created_at', { ascending: false })
          .limit(Number(url.searchParams.get('limit') || 50));
        if (error) return json(res, 500, { error: error.message });
        return json(res, 200, data);
      }

      let query = supabase.from('links').select('*').order('created_at', { ascending: false });
      if (url.searchParams.get('status'))   query = query.eq('status', url.searchParams.get('status'));
      if (url.searchParams.get('category')) query = query.eq('category', url.searchParams.get('category'));
      if (url.searchParams.get('tag'))      query = query.contains('tags', [url.searchParams.get('tag')]);
      query = query.range(
        Number(url.searchParams.get('offset') || 0),
        Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 50) - 1
      );
      const { data, error } = await query;
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, data);
    }

    // POST /api/links
    if (req.method === 'POST' && path === '/api/links') {
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      const { url: linkUrl, category = 'other', tags = [], status = 'unread', notes = '', title: manualTitle } = body;
      if (!linkUrl) return json(res, 400, { error: 'url is required' });

      const { data: existing } = await supabase.from('links').select('id').eq('url', linkUrl).maybeSingle();
      if (existing) return json(res, 409, { error: 'Already saved', id: existing.id });

      const { title: fetchedTitle, description } = await fetchMeta(linkUrl);
      const title = manualTitle || fetchedTitle;
      const { data, error } = await supabase.from('links')
        .insert({ url: linkUrl, title, description, category, tags, status, notes: notes || null, last_touched_at: new Date().toISOString() })
        .select().single();
      if (error) return json(res, 500, { error: error.message });
      return json(res, 201, data);
    }

    // PATCH /api/links/:id
    const patchMatch = path.match(/^\/api\/links\/([^/]+)$/);
    if (req.method === 'PATCH' && patchMatch) {
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      const id = patchMatch[1];
      const updates = { last_touched_at: new Date().toISOString() };
      if (body.title !== undefined)    updates.title = body.title || null;
      if (body.status !== undefined)   updates.status = body.status;
      if (body.category !== undefined) updates.category = body.category;
      if (body.tags !== undefined)     updates.tags = body.tags;
      if (body.notes !== undefined)    updates.notes = body.notes || null;
      const { data, error } = await supabase.from('links').update(updates).eq('id', id).select().single();
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, data);
    }

    // DELETE /api/links/:id
    const deleteMatch = path.match(/^\/api\/links\/([^/]+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      const id = deleteMatch[1];
      const { error } = await supabase.from('links').delete().eq('id', id);
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not found' });
  }

  res.writeHead(404);
  res.end('Not found');
});

httpServer.listen(PORT, () => {
  process.stderr.write(`Link Hoarder MCP server listening on port ${PORT}\n`);
});
