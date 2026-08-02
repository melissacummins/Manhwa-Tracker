// Vercel serverless relay: search MyAnimeList's catalog (anime or manga).
//
// The backup search path for when AniList is unreachable — MAL's API blocks
// browser requests (no CORS), so this relay adds the client id server-side.
// Uses the same MAL_CLIENT_ID env var as the list sync. Nothing is stored.

export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim();
  const list = req.query.list === 'manga' ? 'manga' : 'anime';
  const clientId = process.env.MAL_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({
      error: 'MAL_CLIENT_ID is not configured. Add it in Vercel → Settings → Environment Variables, then redeploy.',
    });
  }
  if (q.length < 3) {
    // MAL's search needs at least 3 characters
    return res.status(200).json({ data: [] });
  }

  const fields = list === 'manga'
    ? 'alternative_titles,main_picture,start_date,media_type,nsfw'
    : 'alternative_titles,main_picture,start_season,media_type,nsfw';
  const url = `https://api.myanimelist.net/v2/${list}?q=${encodeURIComponent(q)}&limit=8&nsfw=true&fields=${fields}`;

  try {
    const r = await fetch(url, { headers: { 'X-MAL-CLIENT-ID': clientId } });
    if (!r.ok) {
      return res.status(502).json({ error: `MyAnimeList responded with ${r.status}. Try again in a minute.` });
    }
    const json = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ data: json.data || [] });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach MyAnimeList: ${err.message}` });
  }
}
