// Vercel serverless relay for AniList GraphQL.
//
// The app talks to AniList directly when it can (fast, and rate limits count
// against the user's own IP), but AniList's error responses and occasional
// Cloudflare moods break browser CORS preflights entirely. Server-to-server
// requests have no CORS, so this relay is the fallback path. Forwards the
// GraphQL body verbatim, plus the Authorization header when present (for the
// user's own AniList pushes). Nothing is stored.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

  let upstream;
  try {
    upstream = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body || {}),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach AniList: ${err.message}` });
  }

  const text = await upstream.text();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) res.setHeader('Retry-After', retryAfter);
  return res.status(upstream.status).send(text);
}
