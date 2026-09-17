// Vercel serverless relay: fetch a book's cover image URL from its Goodreads
// page metadata, by Goodreads Book Id.
//
// Goodreads has no public API anymore, but every book page publishes its
// cover in an og:image meta tag — the exact cover of the exact edition the
// owner logged, which matters for KU/indie titles no other catalog carries.
// Unofficial by nature: if Goodreads blocks or changes this, the importer
// falls back to Google Books / Open Library on its own. Nothing is stored.

export default async function handler(req, res) {
  const id = parseInt((req.query.id || '').toString(), 10);
  if (!id || id < 1) {
    return res.status(400).json({ error: 'Missing or invalid Goodreads book id.' });
  }

  try {
    const r = await fetch(`https://www.goodreads.com/book/show/${id}`, {
      headers: {
        // Goodreads serves bot-looking requests a challenge page
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!r.ok) {
      return res.status(502).json({ error: `Goodreads responded with ${r.status}.` });
    }
    const html = await r.text();
    const match = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)
      || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
    const coverUrl = match ? match[1] : null;

    // A real book page always carries og:image (a "nophoto" placeholder at
    // worst). A page without one is Goodreads' bot-check interstitial — a
    // rate limit, not a missing cover, so tell the client to retry.
    if (!coverUrl) {
      console.log(`goodreads-cover ${id}: challenged (status ${r.status}, ${html.length} bytes)`);
      return res.status(429).json({ error: 'Goodreads is rate-limiting lookups right now.' });
    }
    if (/nophoto/i.test(coverUrl)) {
      return res.status(404).json({ error: 'No cover on the Goodreads page.' });
    }

    // Covers are immutable enough to cache hard at the edge
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
    return res.status(200).json({ coverUrl });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach Goodreads: ${err.message}` });
  }
}
