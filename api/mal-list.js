// Vercel serverless function: fetches a public MyAnimeList anime OR manga list.
//
// Exists because MAL's API doesn't allow browser requests (no CORS) — the
// app calls /api/mal-list?username=...&list=anime|manga, and this relay adds
// the client id server-side. Requires the MAL_CLIENT_ID environment variable
// in Vercel (free: myanimelist.net/apiconfig → Create ID). Reads public
// lists only; no login, no tokens, nothing stored.

export default async function handler(req, res) {
  const username = req.query.username;
  const list = req.query.list === 'manga' ? 'manga' : 'anime';
  const clientId = process.env.MAL_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({
      error: 'MAL_CLIENT_ID is not configured. Add it in Vercel → Settings → Environment Variables, then redeploy.',
    });
  }
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'username is required' });
  }

  const fields = list === 'manga'
    ? 'list_status,alternative_titles,start_date,main_picture,media_type'
    : 'list_status,alternative_titles,start_season,main_picture,media_type';
  let url = `https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/${list}list?limit=1000&nsfw=true&fields=${fields}`;
  const all = [];

  try {
    let guard = 0;
    while (url && guard < 20) {
      guard++;
      const r = await fetch(url, { headers: { 'X-MAL-CLIENT-ID': clientId } });
      if (r.status === 403 || r.status === 404) {
        return res.status(r.status).json({
          error: `MyAnimeList returned ${r.status} — check the username, and that the ${list} list is set to Public in MAL privacy settings.`,
        });
      }
      if (!r.ok) {
        return res.status(502).json({ error: `MyAnimeList responded with ${r.status}. Try again in a minute.` });
      }
      const json = await r.json();
      all.push(...(json.data || []));
      url = json.paging?.next || null;
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not reach MyAnimeList: ${err.message}` });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ data: all });
}
