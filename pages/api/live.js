// /pages/api/live.js
// Haalt alle live wedstrijden op — geen cache want dit moet altijd vers zijn

export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://v3.football.api-sports.io/fixtures?live=all",
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

    // Geen cache voor live data
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
