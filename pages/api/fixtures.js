export default async function handler(req, res) {
  const { leagueId, season, date, status, fixtureId } = req.query;

  // Lookup by fixture ID (voor detailpagina)
  if (fixtureId) {
    try {
      const response = await fetch(
        `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
        { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
      );
      if (!response.ok) return res.status(response.status).json({ error: `API fout: ${response.status}` });
      const data = await response.json();
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Lookup by league + date (voor vandaag tab)
  const params = new URLSearchParams();
  if (leagueId) params.set("league", leagueId);
  if (season)   params.set("season", season);
  if (date)     params.set("date", date);
  if (status)   params.set("status", status);

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?${params.toString()}`,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    if (!response.ok) return res.status(response.status).json({ error: `API fout: ${response.status}` });
    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
