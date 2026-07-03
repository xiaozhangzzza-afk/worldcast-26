import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TOURNAMENT = 'fifa.world';
const TOURNAMENT_RANGE = '20260611-20260719';
const HISTORY_RANGE = '20250101-20260719';

const zh = {
  ARG:'阿根廷',ALG:'阿尔及利亚',AUS:'澳大利亚',AUT:'奥地利',BEL:'比利时',BIH:'波黑',BRA:'巴西',CAN:'加拿大',CPV:'佛得角',COL:'哥伦比亚',CRC:'哥斯达黎加',CRO:'克罗地亚',CUW:'库拉索',CZE:'捷克',COD:'刚果（金）',CIV:'科特迪瓦',ECU:'厄瓜多尔',EGY:'埃及',ENG:'英格兰',FRA:'法国',GER:'德国',GHA:'加纳',HAI:'海地',IRN:'伊朗',IRQ:'伊拉克',JPN:'日本',JOR:'约旦',KOR:'韩国',MEX:'墨西哥',MAR:'摩洛哥',NED:'荷兰',NZL:'新西兰',NOR:'挪威',PAN:'巴拿马',PAR:'巴拉圭',POR:'葡萄牙',QAT:'卡塔尔',KSA:'沙特阿拉伯',SCO:'苏格兰',SEN:'塞内加尔',RSA:'南非',ESP:'西班牙',SUI:'瑞士',SWE:'瑞典',TUN:'突尼斯',TUR:'土耳其',USA:'美国',UZB:'乌兹别克斯坦',URU:'乌拉圭'
};
const positionZh = { Goalkeeper:'门将', Defender:'后卫', Midfielder:'中场', Forward:'前锋' };
const stageZh = {'group-stage':'小组赛','round-of-32':'32强','round-of-16':'16强','quarterfinals':'四分之一决赛','semifinals':'半决赛','3rd-place-match':'三四名决赛','final':'决赛'};

async function getJson(url, retries = 3) {
  let error;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'WorldCast26/1.0' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (e) {
      error = e;
      await new Promise(resolve => setTimeout(resolve, 600 * (i + 1)));
    }
  }
  throw error;
}

function moneylineProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

function probabilities(odds) {
  const ml = odds?.moneyline;
  const raw = [moneylineProbability(ml?.home?.close?.odds), moneylineProbability(ml?.draw?.close?.odds), moneylineProbability(ml?.away?.close?.odds)];
  if (raw.some(v => v == null)) return [40, 30, 30];
  const total = raw.reduce((a, b) => a + b, 0);
  const p = raw.map(v => Math.round(v / total * 100));
  p[1] += 100 - p.reduce((a, b) => a + b, 0);
  return p;
}

function predictScore(p) {
  if (p[0] >= 72) return '3–0';
  if (p[0] >= 58) return '2–0';
  if (p[0] >= 45) return '2–1';
  if (p[2] >= 65) return '0–2';
  if (p[2] >= 42) return '1–2';
  return '1–1';
}

function resultLabel(home, away) {
  return home > away ? '胜' : home < away ? '负' : '平';
}

function scoreNumbers(score) {
  const values = String(score).match(/\d+/g)?.map(Number) || [];
  return values.length >= 2 ? values.slice(0, 2) : [0, 0];
}

function predictedHalfFull(p, score) {
  const [home, away] = scoreNumbers(score);
  const full = resultLabel(home, away);
  const half = full === '胜' && p[0] >= 62 ? '胜' : full === '负' && p[2] >= 62 ? '负' : '平';
  return `${half} / ${full}`;
}

function actualHalfTime(competition, home, away) {
  const details = competition.details;
  if (!Array.isArray(details)) return null;
  let homeGoals = 0, awayGoals = 0;
  for (const play of details) {
    if (!play.scoringPlay || play.shootout || Number(play.clock?.value) > 2700) continue;
    if (String(play.team?.id) === String(home.team?.id)) homeGoals += Number(play.scoreValue || 1);
    if (String(play.team?.id) === String(away.team?.id)) awayGoals += Number(play.scoreValue || 1);
  }
  return { home:homeGoals, away:awayGoals, score:`${homeGoals}–${awayGoals}`, result:resultLabel(homeGoals, awayGoals) };
}

function normalizeTimeline(summary, event) {
  const competition = event.competitions?.[0] || {};
  const home = competition.competitors?.find(t => t.homeAway === 'home') || {};
  const away = competition.competitors?.find(t => t.homeAway === 'away') || {};
  return (summary.keyEvents || []).filter(play => play.scoringPlay || ['yellow-card','red-card'].includes(play.type?.type)).map(play => {
    const rawType = play.type?.type || '';
    const text = play.text || '';
    const ownGoal = Boolean(play.ownGoal) || /own goal/i.test(text) || /own-goal/i.test(rawType);
    const penalty = Boolean(play.penaltyKick) || /penalty/i.test(rawType) || /penalty/i.test(text);
    const header = /header/i.test(rawType) || /header/i.test(text);
    const type = play.scoringPlay ? 'goal' : rawType === 'red-card' ? 'red' : 'yellow';
    const people = (play.participants || []).map(p => p.athlete?.displayName).filter(Boolean);
    const teamId = String(play.team?.id || '');
    return {
      id:play.id || `${play.clock?.value}-${type}-${teamId}`,
      minute:play.clock?.displayValue || '',
      clock:Number(play.clock?.value || 0),
      period:Number(play.period?.number || 0),
      type,
      team:teamId === String(home.team?.id) ? home.team?.abbreviation : teamId === String(away.team?.id) ? away.team?.abbreviation : '',
      side:teamId === String(home.team?.id) ? 'home' : teamId === String(away.team?.id) ? 'away' : 'neutral',
      player:people[0] || '球员待确认',
      assist:type === 'goal' && !ownGoal ? people[1] || '' : '',
      goalKind:type === 'goal' ? ownGoal ? '乌龙球' : penalty ? '点球' : header ? '头球' : '正常进球' : '',
      ownGoal,
      description:text
    };
  }).sort((a, b) => a.clock - b.clock);
}

function normalizeEvent(event, matchNo) {
  const competition = event.competitions?.[0] || {};
  const home = competition.competitors?.find(t => t.homeAway === 'home') || {};
  const away = competition.competitors?.find(t => t.homeAway === 'away') || {};
  const p = probabilities(competition.odds?.[0]);
  const completed = Boolean(event.status?.type?.completed);
  const live = event.status?.type?.state === 'in';
  const prediction = predictScore(p);
  const halfTime = actualHalfTime(competition, home, away);
  const finalHome = Number(home.score || 0), finalAway = Number(away.score || 0);
  const halfFull = completed
    ? halfTime ? `${halfTime.result} / ${resultLabel(finalHome, finalAway)}` : '暂无半场数据'
    : live
      ? Number(event.status?.period || 0) >= 2 && halfTime ? `${halfTime.result} / 进行中` : '半场进行中'
      : predictedHalfFull(p, prediction);
  return {
    id: event.id,
    matchNo,
    date: event.date,
    stage: stageZh[event.season?.slug] || event.season?.slug || '世界杯',
    stageSlug: event.season?.slug || '',
    group: (competition.altGameNote?.match(/Group\s+([A-L])/i) || [])[1]?.toUpperCase() || '',
    status: event.status?.type?.name || '',
    statusText: event.status?.type?.description || '',
    completed,
    period:Number(event.status?.period || 0),
    displayClock:event.status?.displayClock || '',
    progress:completed ? 100 : live ? Math.max(1, Math.min(99, Math.round(Number(event.status?.clock || 0) / 54))) : 0,
    home: home.team?.abbreviation || 'TBD',
    away: away.team?.abbreviation || 'TBD',
    homeName: zh[home.team?.abbreviation] || home.team?.displayName || '待定',
    awayName: zh[away.team?.abbreviation] || away.team?.displayName || '待定',
    homeScore: finalHome,
    awayScore: finalAway,
    score: completed || live ? `${home.score || 0}–${away.score || 0}` : prediction,
    scoreType: completed ? '赛果' : live ? '实时比分' : '预测比分',
    probabilities: p,
    halfTimeScore: halfTime?.score || '',
    halfFull,
    halfFullType: completed ? 'actual' : live ? 'live' : 'prediction',
    halfFullLabel: completed ? '半全场赛果' : live ? '半全场状态' : '半全场预测',
    venue: competition.venue?.fullName || '场地待定',
    city: competition.venue?.address?.city || '',
    broadcast: competition.broadcasts?.flatMap(b => b.names || []) || []
  };
}

function recentForTeam(data, code) {
  return (data.events || []).filter(event => {
    const competitors = event.competitions?.[0]?.competitors || [];
    return new Date(event.date) < new Date() && competitors.length === 2 && competitors.every(c => c.score?.value != null || Number.isFinite(Number(c.score)));
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).map(event => {
    const competitors = event.competitions?.[0]?.competitors || [];
    const self = competitors.find(c => c.team?.abbreviation === code) || {};
    const opponent = competitors.find(c => c.team?.abbreviation !== code) || {};
    const own = Number(self.score?.value ?? self.score ?? 0), other = Number(opponent.score?.value ?? opponent.score ?? 0);
    return { date:event.date, opponent:zh[opponent.team?.abbreviation] || opponent.team?.displayName || '未知', score:`${own}-${other}`, result:own > other ? 'W' : own === other ? 'D' : 'L', competition:event.season?.name || '' };
  });
}

async function concurrentMap(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const scoreboard = await getJson(`${DATA_URL}/${TOURNAMENT}/scoreboard?dates=${TOURNAMENT_RANGE}&limit=200`);
const sortedEvents = [...(scoreboard.events || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
const fixtures = sortedEvents.map((event, index) => normalizeEvent(event, index + 1));
const timelineEvents = sortedEvents.filter(event => ['in','post'].includes(event.status?.type?.state));
const timelineData = await concurrentMap(timelineEvents, 8, async event => {
  const summary = await getJson(`${DATA_URL}/${TOURNAMENT}/summary?event=${event.id}`);
  return { id:event.id, timeline:normalizeTimeline(summary, event) };
});
const timelineById = new Map(timelineData.filter(item => item && !item.error).map(item => [item.id, item.timeline]));
for (const fixture of fixtures) fixture.timeline = timelineById.get(fixture.id) || [];
const teamIndex = new Map();
for (const event of sortedEvents) {
  for (const competitor of event.competitions?.[0]?.competitors || []) {
    const team = competitor.team;
    if (team?.id && team?.abbreviation && zh[team.abbreviation]) teamIndex.set(team.abbreviation, { id:team.id, code:team.abbreviation, name:zh[team.abbreviation], nameEn:team.displayName, logo:team.logo || '', color:team.color || '24496b' });
  }
}

const teamList = [...teamIndex.values()];
const details = await concurrentMap(teamList, 6, async team => {
  const [roster, schedule] = await Promise.all([
    getJson(`${DATA_URL}/${TOURNAMENT}/teams/${team.id}/roster`),
    getJson(`${DATA_URL}/all/teams/${team.id}/schedule?dates=${HISTORY_RANGE}`)
  ]);
  const players = (roster.athletes || []).map(a => ({
    id:a.id, name:a.displayName, shortName:a.shortName, number:a.jersey || '', position:positionZh[a.position?.displayName] || a.position?.displayName || '球员', age:a.age || null,
    injuries:(a.injuries || []).map(i => ({ status:i.status || i.type?.description || '伤情待确认', detail:i.details || i.detail || i.description || '', date:i.date || '' }))
  }));
  return { ...team, players, injuries:players.flatMap(p => p.injuries.map(i => ({ player:p.name, ...i }))), recent:recentForTeam(schedule, team.code) };
});

const teams = Object.fromEntries(teamList.map((team, index) => [team.code, details[index]?.error ? { ...team, players:[], injuries:[], recent:[], fetchError:details[index].error } : details[index]]));
const output = {
  schemaVersion:1,
  updatedAt:new Date().toISOString(),
  source:{ name:'ESPN public soccer data', tournament:'FIFA World Cup', url:'https://www.espn.com/soccer/league/_/name/fifa.world' },
  refreshPolicy:'Every 6 hours during the tournament via GitHub Actions',
  fixtures,
  teams
};

await fs.mkdir(path.join(root, 'data'), { recursive:true });
await fs.writeFile(path.join(root, 'data', 'live.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`Updated ${fixtures.length} fixtures and ${Object.keys(teams).length} teams at ${output.updatedAt}`);
