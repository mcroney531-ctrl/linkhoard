import fetch from 'node-fetch';

// Extracts title + description from a URL via basic HTML parsing (no headless browser).
// Returns { title, description } — both may be null if the page doesn't cooperate.
export async function fetchMeta(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkHoarder/1.0)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
      timeout: 8000,
    });

    if (!res.ok) return { title: null, description: null };

    const html = await res.text();

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
  } catch {
    return { title: null, description: null };
  }
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
