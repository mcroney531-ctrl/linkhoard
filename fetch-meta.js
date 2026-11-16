import fetch from 'node-fetch';

// Extracts title + description from a URL via basic HTML parsing (no headless browser).
// Returns { title, description } — both may be null if the page doesn't cooperate.
//
// Pinterest special case: share links (pin.it/…) redirect to a personalised
// "a pin was sent to you" page (/pin/<id>/sent/?invite_code=…&sender=…) whose
// og:title is generic ("Check out this Pin from <name>", "Take a look! 📌").
// When we land on a pin page that isn't the bare /pin/<id>/ URL, we fetch the bare
// URL for metadata, falling back to the first page's values. Only metadata is
// affected — the caller stores the URL exactly as shared.
export async function fetchMeta(url, { fetchImpl = fetch } = {}) {
  const first = await fetchPage(url, fetchImpl);
  if (!first) return { title: null, description: null };

  const canonical = pinterestCanonicalUrl(first.finalUrl);
  if (canonical && canonical !== first.finalUrl) {
    const pin = await fetchPage(canonical, fetchImpl);
    if (pin && (pin.meta.title || pin.meta.description)) {
      return {
        title: pin.meta.title || first.meta.title,
        description: pin.meta.description || first.meta.description,
      };
    }
  }
  return first.meta;
}

// https://www.pinterest.com/pin/<id>/ for any Pinterest pin URL, else null.
export function pinterestCanonicalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/pin\/(\d+)/);
  return m ? `https://www.pinterest.com/pin/${m[1]}/` : null;
}

async function fetchPage(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkHoarder/1.0)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
      timeout: 8000,
    });
    if (!res.ok) return null;
    const html = await res.text();
    return { finalUrl: res.url || url, meta: parseMeta(html) };
  } catch {
    return null;
  }
}

export function parseMeta(html) {
  const title = extractTag(html, 'og:title') ||
                extractTag(html, 'twitter:title') ||
                extractTagRaw(html, '<title>', '</title>') ||
                null;

  const description = extractTag(html, 'og:description') ||
                      extractTag(html, 'twitter:description') ||
                      extractMeta(html, 'description') ||
                      null;

  return {
    title: title ? cleanText(title) : null,
    description: description ? cleanText(description) : null,
  };
}

function extractTag(html, property) {
  const match = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')
  ) || html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i')
  );
  return match ? match[1] : null;
}

function extractMeta(html, name) {
  const match = html.match(
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')
  ) || html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i')
  );
  return match ? match[1] : null;
}

function extractTagRaw(html, open, close) {
  const start = html.indexOf(open);
  if (start === -1) return null;
  const end = html.indexOf(close, start + open.length);
  if (end === -1) return null;
  return html.slice(start + open.length, end);
}

function cleanText(str) {
  return str.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
