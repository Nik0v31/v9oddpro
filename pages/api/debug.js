// /pages/api/debug.js
// Tijdelijke debug route — verwijder dit na het oplossen van het probleem

export default async function handler(req, res) {
  const results = {};

  // Test 1: API status + plan info
  try {
    const statusRes = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY },
    });
    results.status = await statusRes.json();
  } catch (e) {
    results.status = { error: e.message };
  }

  // Test 2: Live fixtures
  try {
    const liveRes = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
      headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY },
    });
    const liveData = await liveRes.json();
    results.live = {
      errors: liveData.errors,
      results: liveData.results,
      count: liveData.response?.length ?? 0,
      first3: liveData.response?.slice(0, 3).map(f => ({
        id: f.fixture?.id,
        league: f.league?.name,
        home: f.teams?.home?.name,
        away: f.teams?.away?.name,
        status: f.fixture?.status?.short,
        minute: f.fixture?.status?.elapsed,
        score: `${f.goals?.home ?? 0} - ${f.goals?.away ?? 0}`,
      })) ?? [],
    };
  } catch (e) {
    results.live = { error: e.message };
  }

  // Test 3: Vandaag fixtures (seizoen 2025)
  try {
    const today = new Date().toISOString().split("T")[0];
    const fixRes = await fetch(
      `https://v3.football.api-sports.io/fixtures?league=39&season=2025&date=${today}`,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    const fixData = await fixRes.json();
    results.todayPremierLeague = {
      errors: fixData.errors,
      results: fixData.results,
      date: today,
      fixtures: fixData.response?.map(f => ({
        home: f.teams?.home?.name,
        away: f.teams?.away?.name,
        status: f.fixture?.status?.short,
        time: f.fixture?.date,
      })) ?? [],
    };
  } catch (e) {
    results.todayPremierLeague = { error: e.message };
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(results);
}
