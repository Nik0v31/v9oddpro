import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

const USE_LIVE = process.env.NEXT_PUBLIC_USE_LIVE === "true";
const LIVE_REFRESH = 60000;

const LEAGUES = [
  { id: 39,  name: "Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: 140, name: "La Liga",         flag: "🇪🇸" },
  { id: 78,  name: "Bundesliga",      flag: "🇩🇪" },
  { id: 135, name: "Serie A",         flag: "🇮🇹" },
  { id: 61,  name: "Ligue 1",         flag: "🇫🇷" },
  { id: 88,  name: "Eredivisie",      flag: "🇳🇱" },
];

const BOOKMAKER_IDS = { bet365: 8, unibet: 6, pinnacle: 4 };
const BOOKMAKERS = [
  { key: "bet365",   label: "Bet365",   color: "#00c851", logo: "B365" },
  { key: "unibet",   label: "Unibet",   color: "#1a9e5c", logo: "UNI"  },
  { key: "pinnacle", label: "Pinnacle", color: "#f5c518", logo: "PIN"  },
  { key: "toto",     label: "Toto*",    color: "#e84040", logo: "TOT", note: true },
];
const MARKET_TABS = [
  { key: "over25", label: "Over 2.5", outcomes: [{ key: "yes", label: "Over" }, { key: "no",   label: "Under" }] },
  { key: "btts",   label: "BTTS",     outcomes: [{ key: "yes", label: "Ja"   }, { key: "no",   label: "Nee"   }] },
  { key: "result", label: "1X2",      outcomes: [{ key: "home",label: "1"    }, { key: "draw", label: "X"     }, { key: "away", label: "2" }] },
];
const STATUS_LABELS = {
  "1H":"1e helft","HT":"Rust","2H":"2e helft","ET":"Verlengingen",
  "BT":"Pauze VL","P":"Penalty's","SUSP":"Onderbroken","INT":"Onderbroken",
  "LIVE":"Live","FT":"Afgelopen","NS":"Nog niet begonnen",
};

// ── API ──────────────────────────────────────────────────────────
async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Fout: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.response;
}
async function fetchTodayFixtures(leagueId, season) {
  const today = new Date().toISOString().split("T")[0];
  return apiFetch(`/api/fixtures?leagueId=${leagueId}&season=${season}&date=${today}&status=NS`);
}
async function fetchTeamHistory(teamId, leagueId, season) {
  return apiFetch(`/api/team-history?teamId=${teamId}&leagueId=${leagueId}&season=${season}`);
}
async function fetchOddsForFixture(fixtureId) {
  try { return await apiFetch(`/api/odds?fixtureId=${fixtureId}`); } catch { return null; }
}
async function fetchH2H(homeId, awayId) {
  try { return await apiFetch(`/api/h2h?h2h=${homeId}-${awayId}`); } catch { return []; }
}
async function fetchStandings(leagueId, season) {
  try { return await apiFetch(`/api/standings?leagueId=${leagueId}&season=${season}`); } catch { return null; }
}
async function fetchLive() {
  try {
    const data = await apiFetch("/api/live");
    return (data || []).filter(fx => LEAGUES.some(l => l.id === fx.league.id));
  } catch { return []; }
}

// ── STAT BEREKENING ──────────────────────────────────────────────
function calcStats(matches, teamId) {
  if (!matches || matches.length === 0) return null;
  let over25=0, btts=0, wins=0, draws=0, losses=0, gf=0, ga=0;
  matches.forEach(m => {
    const isHome = m.teams.home.id === teamId;
    const scored = isHome ? m.goals.home : m.goals.away;
    const conceded = isHome ? m.goals.away : m.goals.home;
    if (scored === null || conceded === null) return;
    if (scored + conceded > 2.5) over25++;
    if (scored > 0 && conceded > 0) btts++;
    gf += scored; ga += conceded;
    const won = isHome ? m.teams.home.winner : m.teams.away.winner;
    if (won === true) wins++; else if (won === null) draws++; else losses++;
  });
  const n = matches.length || 1;
  return {
    over25Pct: Math.round((over25/n)*100), bttsPct: Math.round((btts/n)*100),
    winPct: Math.round((wins/n)*100), drawPct: Math.round((draws/n)*100),
    lossPct: Math.round((losses/n)*100),
    avgGoalsFor: (gf/n).toFixed(1), avgGoalsAgainst: (ga/n).toFixed(1),
    wins, draws, losses, n,
  };
}

// ── WINSTKANS CALCULATOR ─────────────────────────────────────────
// Combineert 4 factoren met gewichten tot een kanspercentage per uitkomst
function calcWinProb(homeStats, awayStats, h2hMatches, homeRank, awayRank, totalTeams) {
  if (!homeStats || !awayStats) return null;

  // Factor 1: Laatste 10 W/G/V (gewicht 35%)
  const f1Home = homeStats.winPct / 100;
  const f1Draw = homeStats.drawPct / 100;
  const f1Away = awayStats.winPct / 100;

  // Factor 2: Goals voor/tegen balans (gewicht 25%)
  const homeGoalBalance = parseFloat(homeStats.avgGoalsFor) - parseFloat(homeStats.avgGoalsAgainst);
  const awayGoalBalance = parseFloat(awayStats.avgGoalsFor) - parseFloat(awayStats.avgGoalsAgainst);
  const totalBalance = Math.abs(homeGoalBalance) + Math.abs(awayGoalBalance) + 0.01;
  const f2Home = Math.max(0.1, 0.4 + (homeGoalBalance - awayGoalBalance) / (totalBalance * 4));
  const f2Away = Math.max(0.1, 0.4 - (homeGoalBalance - awayGoalBalance) / (totalBalance * 4));
  const f2Draw = Math.max(0.05, 1 - f2Home - f2Away);

  // Factor 3: Ranglijst positie + thuisvoordeel (gewicht 25%)
  let f3Home = 0.45, f3Draw = 0.27, f3Away = 0.28; // standaard thuisvoordeel
  if (homeRank && awayRank && totalTeams) {
    const homeStrength = 1 - (homeRank - 1) / totalTeams;
    const awayStrength = 1 - (awayRank - 1) / totalTeams;
    const diff = homeStrength - awayStrength;
    f3Home = Math.max(0.1, Math.min(0.85, 0.45 + diff * 0.4));
    f3Away = Math.max(0.1, Math.min(0.75, 0.28 - diff * 0.3));
    f3Draw = Math.max(0.05, 1 - f3Home - f3Away);
  }

  // Factor 4: Head-to-head onderlinge resultaten (gewicht 15%)
  let f4Home = 0.4, f4Draw = 0.3, f4Away = 0.3;
  if (h2hMatches && h2hMatches.length > 0) {
    let h2hW=0, h2hD=0, h2hL=0;
    h2hMatches.forEach(m => {
      if (m.teams.home.winner === true) h2hW++;
      else if (m.teams.home.winner === null) h2hD++;
      else h2hL++;
    });
    const hn = h2hMatches.length;
    f4Home = h2hW / hn; f4Draw = h2hD / hn; f4Away = h2hL / hn;
  }

  // Gewogen gemiddelde van alle 4 factoren
  const w = [0.35, 0.25, 0.25, 0.15];
  let home = w[0]*f1Home + w[1]*f2Home + w[2]*f3Home + w[3]*f4Home;
  let draw  = w[0]*f1Draw + w[1]*f2Draw + w[2]*f3Draw + w[3]*f4Draw;
  let away  = w[0]*f1Away + w[1]*f2Away + w[2]*f3Away + w[3]*f4Away;

  // Normaliseer naar 100%
  const total = home + draw + away;
  home = Math.round((home / total) * 100);
  away = Math.round((away / total) * 100);
  draw = 100 - home - away;

  return { home, draw, away };
}

// ── ODDS PARSING ─────────────────────────────────────────────────
function parseOdds(data) {
  if (!data || data.length === 0) return null;
  const result = { over25: {}, btts: {}, result: {} };
  data.forEach(entry => {
    entry.bookmakers?.forEach(bm => {
      const bmKey = Object.entries(BOOKMAKER_IDS).find(([,id]) => id === bm.id)?.[0];
      if (!bmKey) return;
      bm.bets?.forEach(bet => {
        if (bet.name === "Goals Over/Under") {
          const over = bet.values?.find(v => v.value === "Over 2.5");
          const under = bet.values?.find(v => v.value === "Under 2.5");
          result.over25[bmKey] = { yes: over ? parseFloat(over.odd) : null, no: under ? parseFloat(under.odd) : null };
        }
        if (bet.name === "Both Teams Score") {
          const yes = bet.values?.find(v => v.value === "Yes");
          const no  = bet.values?.find(v => v.value === "No");
          result.btts[bmKey] = { yes: yes ? parseFloat(yes.odd) : null, no: no ? parseFloat(no.odd) : null };
        }
        if (bet.name === "Match Winner") {
          const home = bet.values?.find(v => v.value === "Home");
          const draw = bet.values?.find(v => v.value === "Draw");
          const away = bet.values?.find(v => v.value === "Away");
          result.result[bmKey] = { home: home ? parseFloat(home.odd) : null, draw: draw ? parseFloat(draw.odd) : null, away: away ? parseFloat(away.odd) : null };
        }
      });
    });
  });
  ["over25","btts","result"].forEach(market => {
    const keys = Object.keys(result[market]);
    if (!keys.length) return;
    const outcomes = Object.keys(result[market][keys[0]] || {});
    const toto = {};
    outcomes.forEach(o => {
      const vals = keys.map(k => result[market][k]?.[o]).filter(Boolean);
      if (vals.length) toto[o] = +(vals.reduce((a,b)=>a+b,0)/vals.length*0.96).toFixed(2);
    });
    result[market].toto = toto;
  });
  return result;
}

// ── MOCK DATA ────────────────────────────────────────────────────
const jitter = (v, pct=0.05) => +(v*(1+(Math.random()-0.5)*pct)).toFixed(2);
function mockOddsFromStats(hs, as_) {
  const o25p=(hs.over25Pct+as_.over25Pct)/200;
  const oo=o25p>0.05?+(1/o25p*0.92).toFixed(2):1.80, uo=+(1/(1-o25p)*0.92).toFixed(2);
  const bp=(hs.bttsPct+as_.bttsPct)/200;
  const by=bp>0.05?+(1/bp*0.92).toFixed(2):1.90, bn=+(1/(1-bp)*0.92).toFixed(2);
  const hw=hs.winPct/100,dr=hs.drawPct/100,aw=as_.winPct/100;
  const ho=hw>0.05?+(1/hw*0.92).toFixed(2):2.50,dod=dr>0.05?+(1/dr*0.92).toFixed(2):3.20,ao=aw>0.05?+(1/aw*0.92).toFixed(2):3.00;
  return {
    over25:{bet365:{yes:jitter(oo),no:jitter(uo)},unibet:{yes:jitter(oo),no:jitter(uo)},pinnacle:{yes:jitter(oo,0.02),no:jitter(uo,0.02)},toto:{yes:jitter(oo*0.96),no:jitter(uo*0.96)}},
    btts:{bet365:{yes:jitter(by),no:jitter(bn)},unibet:{yes:jitter(by),no:jitter(bn)},pinnacle:{yes:jitter(by,0.02),no:jitter(bn,0.02)},toto:{yes:jitter(by*0.96),no:jitter(bn*0.96)}},
    result:{bet365:{home:jitter(ho),draw:jitter(dod),away:jitter(ao)},unibet:{home:jitter(ho),draw:jitter(dod),away:jitter(ao)},pinnacle:{home:jitter(ho,0.02),draw:jitter(dod,0.02),away:jitter(ao,0.02)},toto:{home:jitter(ho*0.96),draw:jitter(dod*0.96),away:jitter(ao*0.96)}},
  };
}
function mockOdds() {
  const o=+(1.45+Math.random()*0.9).toFixed(2),u=+(2.05+Math.random()*0.7).toFixed(2);
  const by=+(1.65+Math.random()*0.7).toFixed(2),bn=+(2.05+Math.random()*0.5).toFixed(2);
  const h=+(1.5+Math.random()*2.5).toFixed(2),d=+(3.1+Math.random()*1.4).toFixed(2),a=+(1.8+Math.random()*2.6).toFixed(2);
  return {
    over25:{bet365:{yes:jitter(o),no:jitter(u)},unibet:{yes:jitter(o),no:jitter(u)},pinnacle:{yes:jitter(o,0.02),no:jitter(u,0.02)},toto:{yes:jitter(o,0.07),no:jitter(u,0.07)}},
    btts:{bet365:{yes:jitter(by),no:jitter(bn)},unibet:{yes:jitter(by),no:jitter(bn)},pinnacle:{yes:jitter(by,0.02),no:jitter(bn,0.02)},toto:{yes:jitter(by,0.07),no:jitter(bn,0.07)}},
    result:{bet365:{home:jitter(h),draw:jitter(d),away:jitter(a)},unibet:{home:jitter(h),draw:jitter(d),away:jitter(a)},pinnacle:{home:jitter(h,0.02),draw:jitter(d,0.02),away:jitter(a,0.02)},toto:{home:jitter(h,0.07),draw:jitter(d,0.07),away:jitter(a,0.07)}},
  };
}
function generateMockFixtures() {
  const teams={39:[["Manchester United","Liverpool"],["Arsenal","Man City"],["Tottenham","Chelsea"],["Aston Villa","West Ham"]],140:[["Barcelona","Real Madrid"],["Atletico Madrid","Valencia"]],78:[["Bayern München","Borussia Dortmund"],["Bayer Leverkusen","RB Leipzig"]],135:[["AC Milan","Napoli"],["Juventus","Inter Milan"]],61:[["Paris Saint-Germain","Lyon"],["Monaco","Rennes"]],88:[["Ajax","PSV"],["Feyenoord","AZ"]]};
  const out=[];
  LEAGUES.forEach(league=>{
    (teams[league.id]||[]).forEach(([hName,aName])=>{
      const hO25=Math.floor(Math.random()*40)+40,aO25=Math.floor(Math.random()*40)+40;
      const hBtts=Math.floor(Math.random()*40)+35,aBtts=Math.floor(Math.random()*40)+35;
      const hWin=Math.floor(Math.random()*40)+30,aWin=Math.floor(Math.random()*40)+20;
      const hDraw=20,aDraw=25;
      const hs={over25Pct:hO25,bttsPct:hBtts,winPct:hWin,drawPct:hDraw,lossPct:100-hWin-hDraw,avgGoalsFor:(Math.random()+1).toFixed(1),avgGoalsAgainst:(Math.random()*0.8+0.5).toFixed(1),wins:Math.round(hWin/10),draws:2,losses:Math.round((100-hWin-hDraw)/10),n:10};
      const as_={over25Pct:aO25,bttsPct:aBtts,winPct:aWin,drawPct:aDraw,lossPct:100-aWin-aDraw,avgGoalsFor:(Math.random()+0.8).toFixed(1),avgGoalsAgainst:(Math.random()*0.9+0.6).toFixed(1),wins:Math.round(aWin/10),draws:2,losses:Math.round((100-aWin-aDraw)/10),n:10};
      const homeRank=Math.floor(Math.random()*10)+1, awayRank=Math.floor(Math.random()*10)+1;
      const h2h=[{teams:{home:{winner:Math.random()>0.5}},goals:{home:1,away:0}},{teams:{home:{winner:null}},goals:{home:1,away:1}},{teams:{home:{winner:false}},goals:{home:0,away:1}}];
      const prob=calcWinProb(hs,as_,h2h,homeRank,awayRank,20)||{home:45,draw:27,away:28};
      out.push({id:`${league.id}-${hName}`,league,home:{name:hName,rank:homeRank},away:{name:aName,rank:awayRank},kickoff:new Date(Date.now()+Math.random()*86400000*2).toISOString(),homeStats:hs,awayStats:as_,combined:{over25:Math.round((hO25+aO25)/2),btts:Math.round((hBtts+aBtts)/2)},odds:mockOdds(),prob,h2h:h2h.slice(0,5)});
    });
  });
  return out.sort((a,b)=>b.combined.over25-a.combined.over25);
}
function generateMockLive() {
  return [
    {id:"l1",league:{name:"Premier League",flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿"},home:{name:"Arsenal"},away:{name:"Chelsea"},score:{home:1,away:0},minute:34,status:"1H",events:[{min:22,type:"goal",team:"home",player:"Saka"},{min:28,type:"yellow",team:"away",player:"Gallagher"}]},
    {id:"l2",league:{name:"La Liga",flag:"🇪🇸"},home:{name:"Real Madrid"},away:{name:"Barcelona"},score:{home:2,away:1},minute:67,status:"2H",events:[{min:15,type:"goal",team:"home",player:"Vinicius Jr."},{min:41,type:"goal",team:"away",player:"Lewandowski"},{min:58,type:"goal",team:"home",player:"Bellingham"}]},
    {id:"l3",league:{name:"Bundesliga",flag:"🇩🇪"},home:{name:"Bayern München"},away:{name:"Dortmund"},score:{home:0,away:0},minute:0,status:"HT",events:[{min:33,type:"yellow",team:"home",player:"Kimmich"}]},
    {id:"l4",league:{name:"Eredivisie",flag:"🇳🇱"},home:{name:"Ajax"},away:{name:"PSV"},score:{home:1,away:2},minute:55,status:"2H",events:[{min:12,type:"goal",team:"away",player:"Bakayoko"},{min:29,type:"goal",team:"home",player:"Brobbey"},{min:48,type:"goal",team:"away",player:"Tillman"}]},
  ];
}

// ── HOOFD LAAD FUNCTIE ───────────────────────────────────────────
async function loadAllFixtures(onProgress) {
  const now = new Date();
  const season = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const fixtures = [];
  for (const league of LEAGUES) {
    try {
      onProgress?.(`${league.flag} ${league.name} laden...`);
      const [todayFx, standingsRaw] = await Promise.all([
        fetchTodayFixtures(league.id, season),
        fetchStandings(league.id, season),
      ]);
      // Bouw ranking map: teamId → rank
      const rankMap = {};
      let totalTeams = 20;
      try {
        const table = standingsRaw?.[0]?.league?.standings?.[0] || [];
        totalTeams = table.length || 20;
        table.forEach(entry => { rankMap[entry.team.id] = entry.rank; });
      } catch {}

      for (const fx of (todayFx || []).slice(0, 6)) {
        try {
          const homeId = fx.teams.home.id, awayId = fx.teams.away.id;
          const [homeLast10, awayLast10, rawOdds, h2hMatches] = await Promise.all([
            fetchTeamHistory(homeId, league.id, season),
            fetchTeamHistory(awayId, league.id, season),
            fetchOddsForFixture(fx.fixture.id),
            fetchH2H(homeId, awayId),
          ]);
          const homeStats = calcStats(homeLast10, homeId);
          const awayStats = calcStats(awayLast10, awayId);
          if (!homeStats || !awayStats) continue;
          const homeRank = rankMap[homeId] || null;
          const awayRank = rankMap[awayId] || null;
          const prob = calcWinProb(homeStats, awayStats, h2hMatches, homeRank, awayRank, totalTeams);
          const parsedOdds = rawOdds ? parseOdds(rawOdds) : null;
          fixtures.push({
            id: fx.fixture.id, league,
            home: { id: homeId, name: fx.teams.home.name, rank: homeRank },
            away: { id: awayId, name: fx.teams.away.name, rank: awayRank },
            kickoff: fx.fixture.date, homeStats, awayStats,
            combined: {
              over25: Math.round((homeStats.over25Pct+awayStats.over25Pct)/2),
              btts:   Math.round((homeStats.bttsPct+awayStats.bttsPct)/2),
            },
            odds: parsedOdds || mockOddsFromStats(homeStats, awayStats),
            prob,
            h2h: (h2hMatches || []).slice(0, 5),
          });
        } catch {}
      }
    } catch {}
  }
  return fixtures.sort((a,b) => b.combined.over25 - a.combined.over25);
}

// ── UI HELPERS ───────────────────────────────────────────────────
function badge(pct) { return pct>=65?"hot":pct>=45?"warm":"cold"; }
const BC = {
  hot:  {bg:"rgba(0,255,135,0.12)", text:"#00ff87", border:"#00ff8740"},
  warm: {bg:"rgba(255,214,10,0.12)",text:"#ffd60a", border:"#ffd60a40"},
  cold: {bg:"rgba(255,77,109,0.1)", text:"#ff4d6d", border:"#ff4d6d30"},
};
function bestOdd(oddsObj, market, outcome) {
  let best=0;
  BOOKMAKERS.forEach(b=>{ const v=oddsObj?.[market]?.[b.key]?.[outcome]; if(v&&v>best) best=v; });
  return best;
}

// ── SHARED COMPONENTS ────────────────────────────────────────────
function PctBar({ value, type }) {
  const color = BC[type]?.text||"#00ff87";
  return (
    <div style={{position:"relative",height:6,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden",width:"100%"}}>
      <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${value}%`,background:color,borderRadius:99,transition:"width 1s cubic-bezier(.23,1,.32,1)",boxShadow:`0 0 8px ${color}88`}} />
    </div>
  );
}
function StatPill({ label, value, pct }) {
  const b=badge(pct); const c=BC[b];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:10,color:"rgba(255,255,255,0.45)",textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span>
        <span style={{fontSize:13,fontWeight:700,color:c.text,background:c.bg,border:`1px solid ${c.border}`,padding:"1px 7px",borderRadius:99}}>{value}%</span>
      </div>
      <PctBar value={value} type={b} />
    </div>
  );
}
function OddsTable({ odds, market, outcomes }) {
  return (
    <table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead>
        <tr>
          <th style={{textAlign:"left",fontSize:10,fontWeight:600,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em",paddingBottom:6}}>Bookmaker</th>
          {outcomes.map(o=><th key={o.key} style={{textAlign:"center",fontSize:10,fontWeight:600,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em",paddingBottom:6}}>{o.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {BOOKMAKERS.map(bk=>(
          <tr key={bk.key} style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
            <td style={{paddingTop:6,paddingBottom:6,paddingRight:8}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:9,fontWeight:800,color:bk.color,background:bk.color+"18",border:`1px solid ${bk.color}35`,padding:"1px 5px",borderRadius:4}}>{bk.logo}</span>
                <span style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>{bk.label}</span>
              </div>
            </td>
            {outcomes.map(o=>{
              const val=odds?.[market]?.[bk.key]?.[o.key];
              const top=bestOdd(odds,market,o.key);
              const isBest=val!=null&&val===top;
              return (
                <td key={o.key} style={{textAlign:"center",paddingTop:6,paddingBottom:6}}>
                  <span style={{display:"inline-block",minWidth:42,textAlign:"center",fontSize:12,fontWeight:isBest?800:500,color:isBest?"#00ff87":"rgba(255,255,255,0.5)",background:isBest?"rgba(0,255,135,0.1)":"transparent",border:isBest?"1px solid rgba(0,255,135,0.25)":"1px solid transparent",borderRadius:6,padding:"1px 7px"}}>{val??'—'}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── WINSTKANS COMPONENT ──────────────────────────────────────────
function WinProbBar({ prob, homeName, awayName }) {
  if (!prob || prob.home == null || prob.draw == null || prob.away == null) return null;
  const { home, draw, away } = prob;
  const winner = home > away && home > draw ? "home" : away > home && away > draw ? "away" : "draw";
  return (
    <div style={{marginTop:12,padding:"12px 14px",background:"rgba(0,0,0,0.2)",borderRadius:10}}>
      <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>
        Winstkans berekening
      </div>
      {/* Labels */}
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
        <div style={{textAlign:"left"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:2}}>{homeName}</div>
          <div style={{fontSize:20,fontWeight:900,color:winner==="home"?"#00ff87":"#fff"}}>{home}%</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:2}}>Gelijk</div>
          <div style={{fontSize:20,fontWeight:900,color:winner==="draw"?"#ffd60a":"#fff"}}>{draw}%</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:2}}>{awayName}</div>
          <div style={{fontSize:20,fontWeight:900,color:winner==="away"?"#00ff87":"#fff"}}>{away}%</div>
        </div>
      </div>
      {/* Gestapelde balk */}
      <div style={{display:"flex",height:8,borderRadius:99,overflow:"hidden",gap:2}}>
        <div style={{width:`${home}%`,background:winner==="home"?"#00ff87":"rgba(0,255,135,0.4)",borderRadius:"99px 0 0 99px",transition:"width 1s ease"}} />
        <div style={{width:`${draw}%`,background:winner==="draw"?"#ffd60a":"rgba(255,214,10,0.35)"}} />
        <div style={{width:`${away}%`,background:winner==="away"?"#00ff87":"rgba(0,255,135,0.4)",borderRadius:"0 99px 99px 0",transition:"width 1s ease"}} />
      </div>
      {/* Factoren legenda */}
      <div style={{marginTop:8,fontSize:10,color:"rgba(255,255,255,0.2)",lineHeight:1.6}}>
        Gebaseerd op: L10 W/G/V (35%) · Goals voor/tegen (25%) · Ranglijst + thuisvoordeel (25%) · Onderling (15%)
      </div>
    </div>
  );
}

// ── H2H COMPONENT ────────────────────────────────────────────────
function H2HSection({ matches, homeName, awayName, homeId }) {
  if (!matches || matches.length === 0) return null;
  return (
    <div style={{marginTop:12}}>
      <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
        Onderlinge resultaten (laatste {matches.length})
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {matches.map((m, i) => {
          const isHomeTeam = m.teams.home.id === homeId;
          const hg = m.goals.home ?? 0, ag = m.goals.away ?? 0;
          const winner = m.teams.home.winner === true ? "home" : m.teams.home.winner === null ? "draw" : "away";
          const ourResult = isHomeTeam ? winner : winner === "home" ? "away" : winner === "away" ? "home" : "draw";
          const color = ourResult === "home" ? "#00ff87" : ourResult === "draw" ? "#ffd60a" : "#ff4d6d";
          const label = ourResult === "home" ? "W" : ourResult === "draw" ? "G" : "V";
          const date = m.fixture?.date ? new Date(m.fixture.date).toLocaleDateString("nl-NL", {day:"numeric",month:"short",year:"2-digit"}) : "";
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
              <span style={{fontSize:9,fontWeight:800,color,background:color+"18",border:`1px solid ${color}35`,padding:"1px 6px",borderRadius:99,minWidth:22,textAlign:"center"}}>{label}</span>
              <span style={{color:"rgba(255,255,255,0.5)",flex:1}}>{m.teams.home.name} {hg}–{ag} {m.teams.away.name}</span>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{date}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FIXTURE CARD ─────────────────────────────────────────────────
function FixtureCard({ fx, rank }) {
  const router = useRouter();
  const [open,setOpen]=useState(false);
  const [tab,setTab]=useState("over25");
  const {home,away,homeStats,awayStats,combined,league,kickoff,odds,prob,h2h}=fx;
  const isTop=rank<3;
  const time=new Date(kickoff).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"});
  const date=new Date(kickoff).toLocaleDateString("nl-NL",{weekday:"short",day:"numeric",month:"short"});
  const tabData=MARKET_TABS.find(m=>m.key===tab);
  const probWinner = prob ? (prob.home > prob.away && prob.home > prob.draw ? home.name : prob.away > prob.home && prob.away > prob.draw ? away.name : "Gelijk") : null;
  const handleClick = () => {
    const numericId = parseInt(fx.id, 10);
    if (!isNaN(numericId) && numericId > 0) {
      router.push(`/match/${numericId}`);
    } else {
      setOpen(o => !o);
    }
  };

  return (
    <div onClick={handleClick} style={{background:isTop?"linear-gradient(135deg,rgba(0,255,135,0.06) 0%,rgba(0,20,40,0.95) 60%)":"rgba(255,255,255,0.03)",border:`1px solid ${isTop?"rgba(0,255,135,0.2)":"rgba(255,255,255,0.07)"}`,borderRadius:14,padding:"16px 18px",cursor:"pointer",transition:"all 0.2s",marginBottom:10}}
      onMouseEnter={e=>e.currentTarget.style.borderColor=isTop?"rgba(0,255,135,0.4)":"rgba(255,255,255,0.18)"}
      onMouseLeave={e=>e.currentTarget.style.borderColor=isTop?"rgba(0,255,135,0.2)":"rgba(255,255,255,0.07)"}
    >
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {isTop&&<span style={{fontSize:9,fontWeight:800,color:"#00ff87",background:"rgba(0,255,135,0.15)",border:"1px solid rgba(0,255,135,0.3)",padding:"2px 8px",borderRadius:99,textTransform:"uppercase",letterSpacing:"0.1em"}}>🔥 Top Pick</span>}
          <span style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>{league.flag} {league.name}</span>
        </div>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>{date} · {time}</span>
      </div>

      {/* Teams */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <div style={{flex:1,textAlign:"right"}}>
          <span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{home.name}</span>
          {home.rank&&<div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:2}}>#{home.rank}</div>}
        </div>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:500,padding:"3px 10px",background:"rgba(255,255,255,0.06)",borderRadius:8}}>vs</span>
        <div style={{flex:1}}>
          <span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{away.name}</span>
          {away.rank&&<div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:2}}>#{away.rank}</div>}
        </div>
      </div>

      {/* Stats + winstkans preview */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom: prob ? 10 : 0}}>
        <StatPill label="Over 2.5" value={combined.over25} pct={combined.over25} />
        <StatPill label="BTTS"     value={combined.btts}   pct={combined.btts}   />
      </div>

      {/* Winstkans mini preview */}
      {prob && prob.home != null && prob.draw != null && prob.away != null && (
        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10,padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid rgba(255,255,255,0.06)"}}>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Verwacht:</span>
          <div style={{display:"flex",gap:4,flex:1}}>
            {[{label:home.name,val:prob.home||1,color:"#00ff87"},{label:"Gelijk",val:prob.draw||1,color:"#ffd60a"},{label:away.name,val:prob.away||1,color:"#ff9f43"}].map(item=>(
              <div key={item.label} style={{flex:item.val,height:4,background:item.color,borderRadius:99,opacity:0.6+(item.val/200)}} />
            ))}
          </div>
          <span style={{fontSize:11,fontWeight:700,color:"#00ff87"}}>{probWinner} {Math.max(prob.home||0,prob.draw||0,prob.away||0)}%</span>
        </div>
      )}

      {/* Expanded */}
      {open&&(
        <div onClick={e=>e.stopPropagation()} style={{marginTop:16,paddingTop:16,borderTop:"1px solid rgba(255,255,255,0.07)"}}>

          {/* Winstkans calculator */}
          <WinProbBar prob={prob} homeName={home.name} awayName={away.name} />

          {/* H2H */}
          <H2HSection matches={h2h} homeName={home.name} awayName={away.name} homeId={home.id} />

          {/* Market tabs */}
          <div style={{display:"flex",gap:6,marginBottom:12,marginTop:16}}>
            {MARKET_TABS.map(m=><button key={m.key} onClick={()=>setTab(m.key)} style={{fontSize:11,fontWeight:600,cursor:"pointer",padding:"4px 12px",borderRadius:99,background:tab===m.key?"rgba(0,255,135,0.12)":"rgba(255,255,255,0.05)",border:`1px solid ${tab===m.key?"rgba(0,255,135,0.3)":"rgba(255,255,255,0.1)"}`,color:tab===m.key?"#00ff87":"rgba(255,255,255,0.45)",transition:"all 0.15s"}}>{m.label}</button>)}
          </div>

          {/* Odds tabel */}
          <div style={{background:"rgba(0,0,0,0.25)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
            <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Quoteringen · {tabData?.label}</div>
            <OddsTable odds={odds} market={tab} outcomes={tabData?.outcomes||[]} />
            <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.05)",fontSize:10,color:"rgba(255,255,255,0.2)"}}>🟢 Beste quotering · * Toto: geschat o.b.v. marktgemiddelde</div>
          </div>

          {/* Team stats */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            {[{label:home.name,stats:homeStats},{label:away.name,stats:awayStats}].map(({label,stats})=>(
              <div key={label}>
                <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label} · L10</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <StatPill label="Over 2.5" value={stats.over25Pct} pct={stats.over25Pct} />
                  <StatPill label="BTTS"     value={stats.bttsPct}   pct={stats.bttsPct}   />
                  <div style={{display:"flex",gap:6,marginTop:2}}>
                    {[["W",stats.winPct,"#00ff87"],["G",stats.drawPct,"#ffd60a"],["V",stats.lossPct,"#ff4d6d"]].map(([l,v,c])=>(
                      <div key={l} style={{flex:1,textAlign:"center",background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"6px 4px"}}>
                        <div style={{fontSize:10,color:c,fontWeight:700}}>{l}</div>
                        <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{v}%</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:2}}>
                    <span>⚽ {stats.avgGoalsFor} gem.</span>
                    <span>🥅 {stats.avgGoalsAgainst} gem.</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LIVE CARD ────────────────────────────────────────────────────
function LiveCard({ fx }) {
  const [open,setOpen]=useState(false);
  const {home,away,score,minute,status,league,events=[]}=fx;
  const isHT=status==="HT";
  const totalGoals=(score?.home??0)+(score?.away??0);
  const over25done=totalGoals>2;
  const bttsHome=(score?.home??0)>0, bttsAway=(score?.away??0)>0;
  const statusColor=isHT?"#ffd60a":"#00ff87";
  const statusLabel=STATUS_LABELS[status]||status;
  return (
    <div onClick={()=>setOpen(o=>!o)} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:14,padding:"14px 18px",cursor:"pointer",transition:"border-color 0.2s",marginBottom:10}}
      onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.2)"}
      onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.09)"}
    >
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>{league.flag} {league.name}</span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {!isHT&&<span style={{fontSize:10,color:statusColor,fontWeight:700}}>{minute}&apos;</span>}
          <span style={{fontSize:9,fontWeight:800,color:statusColor,background:statusColor+"18",border:`1px solid ${statusColor}35`,padding:"2px 8px",borderRadius:99,textTransform:"uppercase",letterSpacing:"0.08em",display:"flex",alignItems:"center",gap:4}}>
            {!isHT&&<span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:statusColor,animation:"livePulse 1.2s ease-in-out infinite"}} />}
            {statusLabel}
          </span>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",marginBottom:12}}>
        <div style={{flex:1,textAlign:"right"}}><span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{home.name}</span></div>
        <div style={{display:"flex",alignItems:"center",margin:"0 14px",background:"rgba(255,255,255,0.07)",borderRadius:10,padding:"6px 16px"}}>
          <span style={{fontSize:24,fontWeight:900,color:"#fff",lineHeight:1,minWidth:22,textAlign:"center"}}>{score?.home??0}</span>
          <span style={{fontSize:14,color:"rgba(255,255,255,0.3)",margin:"0 6px"}}>–</span>
          <span style={{fontSize:24,fontWeight:900,color:"#fff",lineHeight:1,minWidth:22,textAlign:"center"}}>{score?.away??0}</span>
        </div>
        <div style={{flex:1}}><span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{away.name}</span></div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <span style={{fontSize:10,fontWeight:700,padding:"2px 9px",borderRadius:99,background:over25done?"rgba(0,255,135,0.15)":"rgba(255,255,255,0.05)",color:over25done?"#00ff87":"rgba(255,255,255,0.35)",border:`1px solid ${over25done?"rgba(0,255,135,0.3)":"rgba(255,255,255,0.08)"}`}}>{over25done?"✓":"○"} Over 2.5</span>
        <span style={{fontSize:10,fontWeight:700,padding:"2px 9px",borderRadius:99,background:(bttsHome&&bttsAway)?"rgba(0,255,135,0.15)":bttsHome||bttsAway?"rgba(255,214,10,0.12)":"rgba(255,255,255,0.05)",color:(bttsHome&&bttsAway)?"#00ff87":bttsHome||bttsAway?"#ffd60a":"rgba(255,255,255,0.35)",border:`1px solid ${(bttsHome&&bttsAway)?"rgba(0,255,135,0.3)":bttsHome||bttsAway?"rgba(255,214,10,0.3)":"rgba(255,255,255,0.08)"}`}}>{(bttsHome&&bttsAway)?"✓ BTTS":bttsHome?"½ BTTS (thuis)":bttsAway?"½ BTTS (uit)":"○ BTTS"}</span>
        <span style={{fontSize:10,fontWeight:600,padding:"2px 9px",borderRadius:99,background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.35)",border:"1px solid rgba(255,255,255,0.08)"}}>{totalGoals} doelpunt{totalGoals!==1?"en":""}</span>
      </div>
      {open&&events.length>0&&(
        <div onClick={e=>e.stopPropagation()} style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Wedstrijdgebeurtenissen</div>
          {events.map((ev,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,marginBottom:4}}>
              <span style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.3)",minWidth:28,textAlign:"right"}}>{ev.min}&apos;</span>
              <span>{ev.type==="goal"?"⚽":ev.type==="yellow"?"🟨":"🔴"}</span>
              <span style={{color:"rgba(255,255,255,0.55)"}}>{ev.player}</span>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginLeft:"auto"}}>{ev.team==="home"?home.name:away.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ────────────────────────────────────────────────────
export default function Home() {
  const [activeTab,setActiveTab]=useState("vandaag");
  const [fixtures,setFixtures]=useState([]);
  const [liveGames,setLiveGames]=useState([]);
  const [loadingFix,setLoadingFix]=useState(false);
  const [loadingLive,setLoadingLive]=useState(false);
  const [progress,setProgress]=useState("");
  const [error,setError]=useState(null);
  const [filter,setFilter]=useState("all");
  const [sortBy,setSortBy]=useState("over25");
  const [lastUpdate,setLastUpdate]=useState(null);
  const [lastLiveUpdate,setLastLiveUpdate]=useState(null);
  const [countdown,setCountdown]=useState(LIVE_REFRESH/1000);
  const liveRef=useRef(null), cdRef=useRef(null);

  const loadFixtures=useCallback(async()=>{
    setLoadingFix(true); setError(null); setProgress("");
    try {
      let data;
      if (USE_LIVE) {
        data = await loadAllFixtures(msg=>setProgress(msg));
        if (data.length===0) setError("Geen wedstrijden gevonden voor vandaag.");
      } else {
        await new Promise(r=>setTimeout(r,800));
        data = generateMockFixtures();
      }
      setFixtures(data); setLastUpdate(new Date());
    } catch(e) {
      setError(`Fout: ${e.message}`);
      setFixtures(generateMockFixtures());
    } finally { setLoadingFix(false); setProgress(""); }
  },[]);

  const loadLiveScores=useCallback(async()=>{
    setLoadingLive(true);
    try {
      let data;
      if (USE_LIVE) {
        const raw = await fetchLive();
        data = raw.map(fx=>({
          id: fx.fixture.id,
          league: LEAGUES.find(l=>l.id===fx.league.id)||{name:fx.league.name,flag:"🌍"},
          home: {name:fx.teams.home.name},
          away: {name:fx.teams.away.name},
          score: {home:fx.goals.home??0,away:fx.goals.away??0},
          minute: fx.fixture.status.elapsed??0,
          status: fx.fixture.status.short,
          events: [],
        }));
      } else {
        await new Promise(r=>setTimeout(r,500));
        data = generateMockLive();
      }
      setLiveGames(data); setLastLiveUpdate(new Date()); setCountdown(LIVE_REFRESH/1000);
    } catch(e) {
      console.warn("Live fout:",e.message);
      setLiveGames(generateMockLive());
    } finally { setLoadingLive(false); }
  },[]);

  useEffect(()=>{ loadFixtures(); },[loadFixtures]);
  useEffect(()=>{
    if (activeTab==="live") {
      loadLiveScores();
      liveRef.current=setInterval(loadLiveScores,LIVE_REFRESH);
      cdRef.current=setInterval(()=>setCountdown(c=>c<=1?LIVE_REFRESH/1000:c-1),1000);
    }
    return ()=>{ clearInterval(liveRef.current); clearInterval(cdRef.current); };
  },[activeTab,loadLiveScores]);

  const topOver25=fixtures.length?Math.max(...fixtures.map(f=>f.combined.over25)):0;
  const topBtts=fixtures.length?Math.max(...fixtures.map(f=>f.combined.btts)):0;
  const visible=[...fixtures]
    .filter(f=>{ if(filter==="hot-over25") return f.combined.over25>=65; if(filter==="hot-btts") return f.combined.btts>=65; if(filter==="value") return bestOdd(f.odds,"over25","yes")>=2.0; return true; })
    .sort((a,b)=>sortBy==="btts"?b.combined.btts-a.combined.btts:b.combined.over25-a.combined.over25);

  return (
    <>
      <Head>
        <title>Odds Bot · Dagelijkse Voetbalstats</title>
        <meta name="description" content="Dagelijkse voetbalstatistieken, bookmaker quoteringen, winstkans en live scores" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div style={{minHeight:"100vh",background:"#060d18",fontFamily:"'DM Sans','Segoe UI',sans-serif",color:"#fff",padding:"24px 16px"}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap');
          *,*::before,*::after{box-sizing:border-box;}
          button{font-family:inherit;}
          ::-webkit-scrollbar{width:4px;}
          ::-webkit-scrollbar-thumb{background:rgba(0,255,135,0.3);border-radius:99px;}
          .chip{cursor:pointer;padding:6px 14px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid;transition:all 0.15s;user-select:none;}
          .chip:hover{transform:translateY(-1px);}
          @keyframes spin{to{transform:rotate(360deg);}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
          @keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.8)}}
        `}</style>
        <div style={{maxWidth:680,margin:"0 auto"}}>
          {/* Header */}
          <div style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
              <div>
                <h1 style={{margin:0,fontSize:26,fontWeight:800,letterSpacing:"-0.02em",lineHeight:1.1}}>
                  <span style={{color:"#00ff87"}}>⚽</span> Odds Bot
                </h1>
                <p style={{margin:"4px 0 0",fontSize:13,color:"rgba(255,255,255,0.4)"}}>
                  Dagelijkse stats · L10 · {USE_LIVE?<span style={{color:"#00ff87"}}>● Live</span>:<span style={{color:"#ffd60a"}}>● Demo</span>}
                </p>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {activeTab==="vandaag"&&lastUpdate&&<span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>{lastUpdate.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}</span>}
                {activeTab==="vandaag"&&<button onClick={loadFixtures} disabled={loadingFix} style={{background:"rgba(0,255,135,0.12)",border:"1px solid rgba(0,255,135,0.3)",color:"#00ff87",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:loadingFix?"default":"pointer",opacity:loadingFix?0.6:1}}>{loadingFix?"Laden...":"↻ Vernieuwen"}</button>}
                {activeTab==="live"&&<button onClick={loadLiveScores} disabled={loadingLive} style={{background:"rgba(255,77,109,0.12)",border:"1px solid rgba(255,77,109,0.3)",color:"#ff6b6b",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:loadingLive?"default":"pointer",opacity:loadingLive?0.6:1}}>{loadingLive?"Laden...":`↻ Nu (${countdown}s)`}</button>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginTop:20}}>
              {[{label:"Wedstrijden vandaag",value:fixtures.length,icon:"📅"},{label:"Beste Over 2.5",value:`${topOver25}%`,icon:"🎯"},{label:"Live nu",value:liveGames.length,icon:"🔴"}].map(({label,value,icon})=>(
                <div key={label} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"14px 16px"}}>
                  <div style={{fontSize:18}}>{icon}</div>
                  <div style={{fontSize:22,fontWeight:800,marginTop:4}}>{value}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:2}}>{label}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Tabs */}
          <div style={{display:"flex",gap:6,marginBottom:20,borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
            {[{key:"vandaag",label:"📅 Vandaag"},{key:"live",label:"🔴 Live Scores"}].map(t=>(
              <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{fontSize:13,fontWeight:700,cursor:"pointer",padding:"9px 18px",borderRadius:"10px 10px 0 0",background:activeTab===t.key?"rgba(255,255,255,0.06)":"transparent",border:`1px solid ${activeTab===t.key?"rgba(255,255,255,0.12)":"transparent"}`,borderBottom:activeTab===t.key?"1px solid #060d18":"1px solid transparent",color:activeTab===t.key?"#fff":"rgba(255,255,255,0.4)",transition:"all 0.15s",marginBottom:-1}}>
                {t.label}
                {t.key==="live"&&liveGames.length>0&&<span style={{marginLeft:6,fontSize:10,fontWeight:800,color:"#ff6b6b",background:"rgba(255,77,109,0.18)",border:"1px solid rgba(255,77,109,0.3)",padding:"1px 6px",borderRadius:99}}>{liveGames.length}</span>}
              </button>
            ))}
          </div>
          {/* Vandaag tab */}
          {activeTab==="vandaag"&&(
            <>
              {error&&<div style={{background:"rgba(255,77,109,0.08)",border:"1px solid rgba(255,77,109,0.25)",borderRadius:12,padding:"10px 16px",marginBottom:16,fontSize:12,color:"rgba(255,255,255,0.6)",display:"flex",gap:8,alignItems:"center"}}><span>⚠️</span>{error}</div>}
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
                {BOOKMAKERS.map(b=><div key={b.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"rgba(255,255,255,0.4)",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:99,padding:"3px 10px"}}><span style={{width:6,height:6,borderRadius:"50%",background:b.color,display:"inline-block"}}/>{b.label}</div>)}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginRight:4}}>Filter:</span>
                {[{key:"all",label:"Alle"},{key:"hot-over25",label:"🔥 Over 2.5 ≥65%"},{key:"hot-btts",label:"⚡ BTTS ≥65%"},{key:"value",label:"💰 Odd ≥2.0"}].map(({key,label})=>(
                  <button key={key} className="chip" onClick={()=>setFilter(key)} style={{background:filter===key?"rgba(0,255,135,0.15)":"rgba(255,255,255,0.05)",color:filter===key?"#00ff87":"rgba(255,255,255,0.5)",borderColor:filter===key?"rgba(0,255,135,0.35)":"rgba(255,255,255,0.1)"}}>{label}</button>
                ))}
                <span style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginLeft:8}}>Sorteer:</span>
                {[["over25","Over 2.5"],["btts","BTTS"]].map(([k,l])=>(
                  <button key={k} className="chip" onClick={()=>setSortBy(k)} style={{background:sortBy===k?"rgba(255,214,10,0.12)":"rgba(255,255,255,0.04)",color:sortBy===k?"#ffd60a":"rgba(255,255,255,0.4)",borderColor:sortBy===k?"rgba(255,214,10,0.3)":"rgba(255,255,255,0.08)"}}>{l}</button>
                ))}
              </div>
              {loadingFix?(
                <div style={{textAlign:"center",padding:"60px 0",color:"rgba(255,255,255,0.3)"}}>
                  <div style={{fontSize:32,marginBottom:12,display:"inline-block",animation:"spin 1s linear infinite"}}>⚽</div>
                  <div style={{fontSize:13,marginBottom:6}}>Statistieken worden geladen...</div>
                  {progress&&<div style={{fontSize:11,color:"rgba(255,255,255,0.2)",animation:"pulse 1.5s ease-in-out infinite"}}>{progress}</div>}
                </div>
              ):visible.length===0?(
                <div style={{textAlign:"center",padding:"40px 0",color:"rgba(255,255,255,0.3)",fontSize:14}}>Geen wedstrijden gevonden.</div>
              ):(
                <>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.3)",marginBottom:12}}>{visible.length} wedstrijden · klik voor winstkans, onderlinge stats & quoteringen</div>
                  {visible.map((fx,i)=><FixtureCard key={fx.id} fx={fx} rank={i}/>)}
                </>
              )}
            </>
          )}
          {/* Live tab */}
          {activeTab==="live"&&(
            <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#ff6b6b",animation:"livePulse 1.2s ease-in-out infinite"}}/>
                  <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{liveGames.length} wedstrijden live</span>
                </div>
                {lastLiveUpdate&&<span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>Bijgewerkt {lastLiveUpdate.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit",second:"2-digit"})} · volgende refresh in {countdown}s</span>}
              </div>
              {loadingLive&&liveGames.length===0?(
                <div style={{textAlign:"center",padding:"60px 0",color:"rgba(255,255,255,0.3)"}}>
                  <div style={{fontSize:32,marginBottom:12,display:"inline-block",animation:"spin 1s linear infinite"}}>⚽</div>
                  <div style={{fontSize:13}}>Live scores laden...</div>
                </div>
              ):liveGames.length===0?(
                <div style={{textAlign:"center",padding:"60px 0",color:"rgba(255,255,255,0.3)"}}>
                  <div style={{fontSize:40,marginBottom:12}}>😴</div>
                  <div style={{fontSize:14,marginBottom:6}}>Geen live wedstrijden op dit moment</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.2)"}}>Kom later terug of check de Vandaag tab</div>
                </div>
              ):(
                <>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.3)",marginBottom:12}}>Klik op een wedstrijd voor gebeurtenissen</div>
                  {liveGames.map(fx=><LiveCard key={fx.id} fx={fx}/>)}
                </>
              )}
            </>
          )}
          {/* Legenda */}
          <div style={{marginTop:24,padding:16,background:"rgba(255,255,255,0.02)",borderRadius:12,border:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.08em"}}>Legenda</div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[["#00ff87","Sterk ≥65%"],["#ffd60a","Gemiddeld ≥45%"],["#ff4d6d","Zwak <45%"]].map(([c,l])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"rgba(255,255,255,0.45)"}}>
                  <div style={{width:10,height:10,borderRadius:99,background:c}}/>{l}
                </div>
              ))}
            </div>
            <div style={{marginTop:12,fontSize:11,color:"rgba(255,255,255,0.25)",lineHeight:1.7}}>
              Over 2.5: kans op meer dan 2 doelpunten · BTTS: beide teams scoren · W/G/V op basis van L10 · 🟢 beste quotering · Winstkans: gewogen model op basis van 4 factoren
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
