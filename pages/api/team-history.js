// /pages/api/team-history.js
// Haalt de laatste 10 gespeelde wedstrijden op voor een team

export default async function handler(req, res) {
  const { teamId, leagueId, season } = req.query;

  if (!teamId || !leagueId || !season) {
    return res.status(400).json({ error: "teamId, leagueId en season zijn verplicht" });
  }

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?team=${teamId}&league=${leagueId}&season=${season}&last=10&status=FT`,
      {
        headers: {
          "x-apisports-key": process.env.API_FOOTBALL_KEY,
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: `API fout: ${response.status}` });
    }

    const data = await response.json();

    // Cache 1 uur — team-history verandert niet snel
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=300");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
