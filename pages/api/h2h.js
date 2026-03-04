// /pages/api/h2h.js
// Haalt onderlinge resultaten (head-to-head) op tussen twee teams

export default async function handler(req, res) {
  const { h2h } = req.query; // formaat: "teamId1-teamId2"

  if (!h2h) {
    return res.status(400).json({ error: "h2h parameter verplicht (bijv. 33-40)" });
  }

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures/headtohead?h2h=${h2h}&last=10`,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    if (!response.ok) return res.status(response.status).json({ error: `API fout: ${response.status}` });
    const data = await response.json();
    // Cache 6 uur — H2H verandert zelden
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=3600");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
