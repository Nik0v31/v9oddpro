import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

const STATUS_LABELS = {
  "FT":"Eindstand","AET":"Na verlengingen","PEN":"Na penalty's",
  "1H":"1e helft","HT":"Rust","2H":"2e helft","NS":"Nog niet begonnen",
};

// ── API ──────────────────────────────────────────────────────────
async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Fout: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.response;
}

async function loadMatchData(fixtureId) {
  // Haal eerst de fixture op om team IDs en league te weten
  const fixtures = await apiFetch(`/api/fixtures?fixtureId=${fixtureId}`);
  if (!fixtures || fixtures.length === 0) throw new Error("Wedstrijd niet gevonden");
  const fx = fixtures[0];

  const homeId  = fx.teams.home.id;
  const awayId  = fx.teams.away.id;
  const leagueId = fx.league.id;
  const now = new Date();
  const season = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;

  // Alles parallel ophalen
  const [homeLast10, awayLast10, standingsRaw, h2hRaw] = await Promise.all([
    apiFetch(`/api/team-history?teamId=${homeId}&leagueId=${leagueId}&season=${season}`),
    apiFetch(`/api/team-history?teamId=${awayId}&leagueId=${leagueId}&season=${season}`),
    apiFetch(`/api/standings?leagueId=${leagueId}&season=${season}`).catch(() => null),
    apiFetch(`/api/h2h?h2h=${homeId}-${awayId}`).catch(() => []),
  ]);

  // API-Football returns standings nested differently per endpoint
  let standings = [];
  try {
    const raw = standingsRaw?.[0];
    standings = raw?.league?.standings?.[0] || raw?.standings?.[0] || raw?.[0] || [];
    if (!Array.isArray(standings)) standings = [];
  } catch { standings = []; }

  return {
    fixture: fx,
    homeLast10: (homeLast10 || []).slice(0, 10),
    awayLast10: (awayLast10 || []).slice(0, 10),
    standings,
    h2h: (h2hRaw || []).slice(0, 5),
    homeId, awayId, leagueId, season,
  };
}

// ── HELPERS ───────────────────────────────────────────────────────
function resultLabel(match, teamId) {
  if (!match?.teams?.home) return { label: "?", color: "#888", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.1)" };
  const isHome = match.teams.home.id === teamId;
  const winner = match.teams.home.winner;
  if (winner === null) return { label: "G", color: "#ffd60a", bg: "rgba(255,214,10,0.15)", border: "rgba(255,214,10,0.3)" };
  if ((isHome && winner === true) || (!isHome && winner === false))
    return { label: "W", color: "#00ff87", bg: "rgba(0,255,135,0.15)", border: "rgba(0,255,135,0.3)" };
  return { label: "V", color: "#ff4d6d", bg: "rgba(255,77,109,0.15)", border: "rgba(255,77,109,0.3)" };
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function calcFormStats(matches, teamId) {
  if (!matches || matches.length === 0) return null;
  let wins=0, draws=0, losses=0, gf=0, ga=0, over25=0, btts=0;
  matches.forEach(m => {
    const isHome = m.teams.home.id === teamId;
    const scored   = isHome ? m.goals.home  : m.goals.away;
    const conceded = isHome ? m.goals.away  : m.goals.home;
    if (scored == null || conceded == null) return;
    gf += scored; ga += conceded;
    if (scored + conceded > 2.5) over25++;
    if (scored > 0 && conceded > 0) btts++;
    const won = isHome ? m.teams.home.winner : m.teams.away.winner;
    if (won === true) wins++; else if (won === null) draws++; else losses++;
  });
  const n = matches.length || 1;
  return { wins, draws, losses, gf, ga, over25, btts, n,
    winPct: Math.round(wins/n*100), drawPct: Math.round(draws/n*100), lossPct: Math.round(losses/n*100),
    avgGf: (gf/n).toFixed(1), avgGa: (ga/n).toFixed(1),
    over25Pct: Math.round(over25/n*100), bttsPct: Math.round(btts/n*100),
  };
}

// ── COMPONENTS ───────────────────────────────────────────────────
function MatchRow({ match, teamId, teamName }) {
  if (!match?.teams?.home || !match?.teams?.away) return null;
  const isHome = match.teams.home.id === teamId;
  const opponent = isHome ? match.teams.away.name : match.teams.home.name;
  const scored   = isHome ? match.goals.home  : match.goals.away;
  const conceded = isHome ? match.goals.away  : match.goals.home;
  const res = resultLabel(match, teamId);
  const date = formatDate(match.fixture?.date);
  const venue = isHome ? "T" : "U";
  const statusShort = match.fixture?.status?.short;
  const statusLabel = STATUS_LABELS[statusShort] || statusShort;

  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderRadius:8, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", marginBottom:4 }}>
      {/* Resultaat badge */}
      <span style={{ fontSize:10, fontWeight:800, color:res.color, background:res.bg, border:`1px solid ${res.border}`, padding:"2px 7px", borderRadius:99, minWidth:24, textAlign:"center" }}>
        {res.label}
      </span>
      {/* Thuis/Uit */}
      <span style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.3)", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", padding:"1px 5px", borderRadius:4 }}>
        {venue}
      </span>
      {/* Tegenstander */}
      <span style={{ flex:1, fontSize:12, color:"rgba(255,255,255,0.7)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {opponent}
      </span>
      {/* Score */}
      <span style={{ fontSize:13, fontWeight:800, color:"#fff", minWidth:36, textAlign:"center" }}>
        {scored ?? "?"} – {conceded ?? "?"}
      </span>
      {/* Datum */}
      <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", minWidth:40, textAlign:"right" }}>
        {date}
      </span>
    </div>
  );
}

function FormBadges({ matches, teamId }) {
  if (!matches || matches.length === 0) return null;
  return (
    <div style={{ display:"flex", gap:4, marginBottom:10 }}>
      {matches.slice(0,5).map((m, i) => {
        const res = resultLabel(m, teamId);
        return (
          <span key={i} style={{ fontSize:10, fontWeight:800, color:res.color, background:res.bg, border:`1px solid ${res.border}`, width:22, height:22, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {res.label}
          </span>
        );
      })}
      <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", alignSelf:"center", marginLeft:4 }}>laatste 5</span>
    </div>
  );
}

function StatBar({ label, value, max=100, color="#00ff87" }) {
  return (
    <div style={{ marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>{label}</span>
        <span style={{ fontSize:10, fontWeight:700, color }}>
          {typeof value === "number" && max === 100 ? `${value}%` : value}
        </span>
      </div>
      <div style={{ height:4, background:"rgba(255,255,255,0.08)", borderRadius:99, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.min(100,(value/max)*100)}%`, background:color, borderRadius:99, transition:"width 1s ease" }} />
      </div>
    </div>
  );
}

function StandingsTable({ standings, highlightIds }) {
  if (!standings || standings.length === 0) return (
    <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", textAlign:"center", padding:"20px 0" }}>Ranglijst niet beschikbaar</div>
  );
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
        <thead>
          <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
            {["#","Team","Gs","W","G","V","Pts"].map(h => (
              <th key={h} style={{ padding:"6px 6px", textAlign: h==="Team"?"left":"center", color:"rgba(255,255,255,0.35)", fontWeight:600, fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.filter(entry => entry && entry.team).map((entry, i) => {
            const isHighlighted = highlightIds.includes(entry.team?.id);
            return (
              <tr key={entry.team?.id ?? i} style={{ background: isHighlighted ? "rgba(0,255,135,0.07)" : i%2===0 ? "rgba(255,255,255,0.01)" : "transparent", borderLeft: isHighlighted ? "2px solid #00ff87" : "2px solid transparent", transition:"background 0.2s" }}>
                <td style={{ padding:"7px 6px", textAlign:"center", fontWeight: isHighlighted?800:400, color: isHighlighted?"#00ff87":"rgba(255,255,255,0.5)" }}>{entry.rank ?? i+1}</td>
                <td style={{ padding:"7px 6px", fontWeight: isHighlighted?700:400, color: isHighlighted?"#fff":"rgba(255,255,255,0.7)", maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{entry.team?.name ?? "–"}</td>
                <td style={{ padding:"7px 6px", textAlign:"center", color:"rgba(255,255,255,0.5)" }}>{entry.all?.played ?? 0}</td>
                <td style={{ padding:"7px 6px", textAlign:"center", color:"#00ff87" }}>{entry.all?.win ?? 0}</td>
                <td style={{ padding:"7px 6px", textAlign:"center", color:"#ffd60a" }}>{entry.all?.draw ?? 0}</td>
                <td style={{ padding:"7px 6px", textAlign:"center", color:"#ff4d6d" }}>{entry.all?.lose ?? 0}</td>
                <td style={{ padding:"7px 6px", textAlign:"center", fontWeight:800, color:"#fff" }}>{entry.points ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── MAIN PAGE ────────────────────────────────────────────────────
export default function MatchPage() {
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("resultaten");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    loadMatchData(id)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [id]);

  const homeStats = data ? calcFormStats(data.homeLast10, data.homeId) : null;
  const awayStats = data ? calcFormStats(data.awayLast10, data.awayId) : null;
  const fx = data?.fixture;
  const homeName = fx?.teams?.home?.name || "Thuis";
  const awayName = fx?.teams?.away?.name || "Uit";
  const leagueName = fx?.league?.name || "";
  const leagueFlag = fx?.league?.country === "England" ? "🏴󠁧󠁢󠁥󠁮󠁧󠁿" : "🌍";
  const kickoff = fx?.fixture?.date ? new Date(fx.fixture.date).toLocaleString("nl-NL", { weekday:"long", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit" }) : "";

  return (
    <>
      <Head>
        <title>{homeName} vs {awayName} · Odds Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ minHeight:"100vh", background:"#060d18", fontFamily:"'DM Sans','Segoe UI',sans-serif", color:"#fff", padding:"20px 16px" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap');
          *,*::before,*::after{box-sizing:border-box;}
          button{font-family:inherit;}
          ::-webkit-scrollbar{width:4px;}
          ::-webkit-scrollbar-thumb{background:rgba(0,255,135,0.3);border-radius:99px;}
          @keyframes spin{to{transform:rotate(360deg);}}
          table{width:100%;}
        `}</style>

        <div style={{ maxWidth:760, margin:"0 auto" }}>

          {/* Terug knop */}
          <button onClick={() => router.back()} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.6)", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer", marginBottom:20, display:"flex", alignItems:"center", gap:6 }}>
            ← Terug
          </button>

          {loading && (
            <div style={{ textAlign:"center", padding:"80px 0", color:"rgba(255,255,255,0.3)" }}>
              <div style={{ fontSize:36, display:"inline-block", animation:"spin 1s linear infinite", marginBottom:16 }}>⚽</div>
              <div style={{ fontSize:14 }}>Wedstrijddata laden...</div>
            </div>
          )}

          {error && (
            <div style={{ background:"rgba(255,77,109,0.08)", border:"1px solid rgba(255,77,109,0.25)", borderRadius:12, padding:"16px", color:"rgba(255,255,255,0.6)", fontSize:13 }}>
              ⚠️ {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Match header */}
              <div style={{ background:"linear-gradient(135deg,rgba(0,255,135,0.06) 0%,rgba(0,10,30,0.98) 70%)", border:"1px solid rgba(0,255,135,0.15)", borderRadius:16, padding:"24px 20px", marginBottom:20 }}>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginBottom:12, display:"flex", alignItems:"center", gap:6 }}>
                  <span>🏆</span> {leagueName} · <span style={{ color:"rgba(255,255,255,0.3)" }}>{kickoff}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                  <div style={{ flex:1, textAlign:"right" }}>
                    <div style={{ fontSize:20, fontWeight:800, color:"#fff", lineHeight:1.2 }}>{homeName}</div>
                    {homeStats && Array.isArray(data.standings) && <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:4 }}>#{data.standings?.find(s=>s.team?.id===data.homeId)?.rank || "–"} in competitie</div>}
                  </div>
                  <div style={{ textAlign:"center", padding:"10px 20px", background:"rgba(255,255,255,0.06)", borderRadius:12 }}>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>vs</div>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:20, fontWeight:800, color:"#fff", lineHeight:1.2 }}>{awayName}</div>
                    {awayStats && Array.isArray(data.standings) && <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:4 }}>#{data.standings?.find(s=>s.team?.id===data.awayId)?.rank || "–"} in competitie</div>}
                  </div>
                </div>

                {/* Snelle stats vergelijking */}
                {homeStats && awayStats && (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:8, marginTop:20, alignItems:"center" }}>
                    {[
                      { label:"Over 2.5", homeVal:homeStats.over25Pct, awayVal:awayStats.over25Pct, color:"#00ff87" },
                      { label:"BTTS",     homeVal:homeStats.bttsPct,   awayVal:awayStats.bttsPct,   color:"#7c83fd" },
                      { label:"Gem. goals", homeVal:homeStats.avgGf, awayVal:awayStats.avgGf, color:"#ffd60a", max:4 },
                    ].map(stat => (
                      <>
                        <div key={stat.label+"h"} style={{ textAlign:"right" }}>
                          <span style={{ fontSize:16, fontWeight:800, color: parseFloat(stat.homeVal) >= parseFloat(stat.awayVal) ? stat.color : "#fff" }}>
                            {stat.homeVal}{stat.max ? "" : "%"}
                          </span>
                        </div>
                        <div key={stat.label} style={{ textAlign:"center", fontSize:10, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                          {stat.label}
                        </div>
                        <div key={stat.label+"a"} style={{ textAlign:"left" }}>
                          <span style={{ fontSize:16, fontWeight:800, color: parseFloat(stat.awayVal) > parseFloat(stat.homeVal) ? stat.color : "#fff" }}>
                            {stat.awayVal}{stat.max ? "" : "%"}
                          </span>
                        </div>
                      </>
                    ))}
                  </div>
                )}
              </div>

              {/* Tab navigatie */}
              <div style={{ display:"flex", gap:6, marginBottom:16, borderBottom:"1px solid rgba(255,255,255,0.07)", paddingBottom:0 }}>
                {[
                  { key:"resultaten", label:"📋 Laatste 10" },
                  { key:"ranglijst",  label:"🏆 Ranglijst" },
                  { key:"h2h",        label:"⚔️ Onderling" },
                ].map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ fontSize:12, fontWeight:700, cursor:"pointer", padding:"8px 16px", borderRadius:"8px 8px 0 0", background:activeTab===t.key?"rgba(255,255,255,0.07)":"transparent", border:`1px solid ${activeTab===t.key?"rgba(255,255,255,0.12)":"transparent"}`, borderBottom:activeTab===t.key?"1px solid #060d18":"1px solid transparent", color:activeTab===t.key?"#fff":"rgba(255,255,255,0.4)", transition:"all 0.15s", marginBottom:-1 }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab: Laatste 10 resultaten */}
              {activeTab === "resultaten" && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                  {/* Thuis team */}
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:"#fff", marginBottom:6 }}>{homeName}</div>
                    <FormBadges matches={data.homeLast10} teamId={data.homeId} />
                    {homeStats && (
                      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
                        <StatBar label="Winst" value={homeStats.winPct} color="#00ff87" />
                        <StatBar label="Gelijk" value={homeStats.drawPct} color="#ffd60a" />
                        <StatBar label="Over 2.5" value={homeStats.over25Pct} color="#7c83fd" />
                        <StatBar label="BTTS" value={homeStats.bttsPct} color="#ff9f43" />
                        <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.06)", fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                          <span>⚽ {homeStats.avgGf} gem.</span>
                          <span>{homeStats.wins}W {homeStats.draws}G {homeStats.losses}V</span>
                          <span>🥅 {homeStats.avgGa} gem.</span>
                        </div>
                      </div>
                    )}
                    {data.homeLast10.map((m, i) => (
                      <MatchRow key={i} match={m} teamId={data.homeId} teamName={homeName} />
                    ))}
                  </div>

                  {/* Uit team */}
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:"#fff", marginBottom:6 }}>{awayName}</div>
                    <FormBadges matches={data.awayLast10} teamId={data.awayId} />
                    {awayStats && (
                      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
                        <StatBar label="Winst" value={awayStats.winPct} color="#00ff87" />
                        <StatBar label="Gelijk" value={awayStats.drawPct} color="#ffd60a" />
                        <StatBar label="Over 2.5" value={awayStats.over25Pct} color="#7c83fd" />
                        <StatBar label="BTTS" value={awayStats.bttsPct} color="#ff9f43" />
                        <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.06)", fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                          <span>⚽ {awayStats.avgGf} gem.</span>
                          <span>{awayStats.wins}W {awayStats.draws}G {awayStats.losses}V</span>
                          <span>🥅 {awayStats.avgGa} gem.</span>
                        </div>
                      </div>
                    )}
                    {data.awayLast10.map((m, i) => (
                      <MatchRow key={i} match={m} teamId={data.awayId} teamName={awayName} />
                    ))}
                  </div>
                </div>
              )}

              {/* Tab: Ranglijst */}
              {activeTab === "ranglijst" && (
                <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"14px" }}>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:12, display:"flex", gap:12 }}>
                    <span style={{ color:"#00ff87" }}>■</span> {homeName} &amp; {awayName} gemarkeerd
                  </div>
                  <StandingsTable standings={data.standings} highlightIds={[data.homeId, data.awayId]} />
                </div>
              )}

              {/* Tab: Onderlinge resultaten */}
              {activeTab === "h2h" && (
                <div>
                  {data.h2h.length === 0 ? (
                    <div style={{ textAlign:"center", padding:"40px 0", color:"rgba(255,255,255,0.3)", fontSize:13 }}>
                      Geen onderlinge resultaten beschikbaar
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:12 }}>
                        Laatste {data.h2h.length} onderlinge wedstrijden
                      </div>
                      {data.h2h.map((m, i) => {
                        const hg = m.goals.home ?? 0, ag = m.goals.away ?? 0;
                        const date = formatDate(m.fixture?.date);
                        const winner = m.teams.home.winner === true ? m.teams.home.name : m.teams.home.winner === null ? "Gelijk" : m.teams.away.name;
                        const winnerColor = m.teams.home.winner === null ? "#ffd60a" : "#00ff87";
                        return (
                          <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:10, marginBottom:6 }}>
                            <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", minWidth:50 }}>{date}</span>
                            <span style={{ flex:1, fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.7)", textAlign:"right" }}>{m.teams.home.name}</span>
                            <span style={{ fontSize:15, fontWeight:900, color:"#fff", minWidth:48, textAlign:"center", background:"rgba(255,255,255,0.07)", borderRadius:8, padding:"3px 10px" }}>{hg} – {ag}</span>
                            <span style={{ flex:1, fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.7)" }}>{m.teams.away.name}</span>
                            <span style={{ fontSize:10, fontWeight:700, color:winnerColor, minWidth:50, textAlign:"right" }}>{winner === "Gelijk" ? "G" : winner === m.teams.home.name ? "⬅" : "➡"}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
