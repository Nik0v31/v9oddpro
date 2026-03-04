// /pages/api/odds.js
// Haalt bookmaker-odds op voor een specifieke wedstrijd

export default async function handler(req, res) {
  const { fixtureId } = req.query;

  if (!fixtureId) {
    return res.status(400).json({ error: "fixtureId is verplicht" });
  }

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/odds?fixture=${fixtureId}`,
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

    // Cache 15 minuten — odds veranderen niet elke seconde
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=120");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
