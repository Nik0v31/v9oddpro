// /pages/api/standings.js
// Haalt de ranglijst op voor een competitie

export default async function handler(req, res) {
  const { leagueId, season } = req.query;

  if (!leagueId || !season) {
    return res.status(400).json({ error: "leagueId en season zijn verplicht" });
  }

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/standings?league=${leagueId}&season=${season}`,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    if (!response.ok) return res.status(response.status).json({ error: `API fout: ${response.status}` });
    const data = await response.json();
    // Cache 6 uur — ranglijst verandert niet elk uur
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=3600");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
