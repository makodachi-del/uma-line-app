const cheerio = require('cheerio');
const { venueFromRaceId, JRA_COURSE_EN_TO_JP } = require('./race_rules');
const { normalizeText } = require('./utils');

const BASE = 'https://en.netkeiba.com';
const LIST_URL = `${BASE}/race/race_list.html`;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 uma-line-app/2.0',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${url}`);
  return await res.text();
}

function absUrl(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return BASE + href;
}

function extractRaceId(href) {
  const m = String(href || '').match(/race_id=(\d{12})/);
  return m ? m[1] : '';
}

function parseRaceAnchorText(text) {
  const s = normalizeText(text).replace(/４/g,'4');
  const m = s.match(/R(\d{1,2})\s+(.+?)\s+(?:(G1|G2|G3|L|OP|\d\s*Win|ALW|Maiden|Open Class|Newcomer)\s+)?(\d{1,2}:\d{2})\s+([TDJ])(\d{3,4})m.*?(\d+)\s*Rnrs/i);
  if (!m) return null;
  return {
    raceNo: Number(m[1]),
    name: normalizeText(m[2]),
    grade: m[3] || '',
    time: m[4],
    surface: m[5].toUpperCase() === 'T' ? '芝' : m[5].toUpperCase() === 'D' ? 'ダート' : '障害',
    distance: Number(m[6]),
    runners: Number(m[7]),
    condition: `${m[5].toUpperCase()}${m[6]}m ${m[3] || ''}`.trim(),
  };
}

function parseRaceList(html) {
  const $ = cheerio.load(html);
  const races = [];
  const seen = new Set();
  $('a[href*="shutuba.html?race_id="]').each((_, a) => {
    const href = $(a).attr('href');
    const raceId = extractRaceId(href);
    if (!raceId || seen.has(raceId)) return;
    const text = normalizeText($(a).text());
    if (!/^R\d+\s+/.test(text)) return;
    const parsed = parseRaceAnchorText(text);
    if (!parsed) return;
    seen.add(raceId);
    races.push({
      raceId,
      date: raceId.slice(0,4) + '-' + raceId.slice(4,6) + '-' + raceId.slice(6,8),
      venue: venueFromRaceId(raceId),
      fieldUrl: absUrl(href),
      fullFormUrl: `${BASE}/race/newspaper.html?race_id=${raceId}`,
      oddsUrl: `${BASE}/race/odds.html?race_id=${raceId}`,
      resultUrl: `${BASE}/race/result.html?race_id=${raceId}`,
      ...parsed,
    });
  });
  return races.sort((a,b) => String(a.raceId).localeCompare(String(b.raceId)) || a.raceNo - b.raceNo);
}

async function fetchRaceList() {
  const html = await fetchHtml(LIST_URL);
  return parseRaceList(html);
}

function parseHeader($) {
  const body = $('body').text();
  const lines = body.split('\n').map(normalizeText).filter(Boolean);
  let headerLine = '';
  for (let i=0;i<lines.length;i++) {
    if (/^R\d+$/.test(lines[i]) && /^(G1|G2|G3|L|OP)?$/.test(lines[i+1] || '')) {
      headerLine = `${lines[i]} ${lines[i+1] || ''} ${lines[i+2] || ''} ${lines[i+3] || ''}`;
      break;
    }
  }
  return headerLine || lines.slice(90, 100).join(' ');
}

function parseHorsesFromFullForm(html) {
  const $ = cheerio.load(html);
  const lines = $('body').text().split('\n').map(normalizeText).filter(Boolean);
  const horses = [];
  for (let i=0; i<lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\d+)\s+(\d+)\s+(.+?)\s+(\d+[A-Z])\s+([\d.]+)\s+(.+)$/);
    if (!m) continue;
    const horse = {
      bracket: Number(m[1]),
      number: Number(m[2]),
      name: normalizeText(m[3]),
      ageSex: m[4],
      weight: m[5],
      jockey: normalizeText(m[6]),
      trainer: normalizeText(lines[i+1] || '不明'),
      recentStarts: [],
    };
    let j=i+1;
    while (j < lines.length && !/^(\d+)\s+(\d+)\s+.+?\s+(\d+[A-Z])\s+([\d.]+)\s+/.test(lines[j])) {
      if (/Recent Starts/i.test(lines[j])) {
        j++;
        continue;
      }
      if (/^\d{2}\s+[A-Z][a-z]{2}\s+\d{2}/.test(lines[j]) || /^\d{2}\s+[A-Z]{3}/.test(lines[j])) {
        const dateRace = lines[j];
        const finish = lines[j+1] || '';
        const detail = lines[j+2] || '';
        horse.recentStarts.push(normalizeText(`${dateRace} / ${finish} / ${detail}`));
        j += 3;
        continue;
      }
      j++;
    }
    horses.push(horse);
  }
  const unique = [];
  const seen = new Set();
  for (const h of horses) {
    if (!seen.has(h.number)) { seen.add(h.number); unique.push(h); }
  }
  return unique.sort((a,b)=>a.number-b.number);
}

function parsePaceFromField(html) {
  const $ = cheerio.load(html);
  const text = $('body').text();
  const idx = text.indexOf('PREDICTED PACE');
  if (idx < 0) return '不明';
  return normalizeText(text.slice(idx, idx + 1400));
}

async function fetchRaceDetail(race) {
  const fieldHtml = await fetchHtml(race.fieldUrl);
  const fullHtml = await fetchHtml(race.fullFormUrl);
  const $ = cheerio.load(fullHtml);
  const horses = parseHorsesFromFullForm(fullHtml);
  const enoughHorseCount = horses.filter(h => (h.recentStarts || []).length >= 3).length;
  return {
    ...race,
    header: parseHeader($),
    paceText: parsePaceFromField(fieldHtml),
    horses,
    horseCountParsed: horses.length,
    enoughHorseCount,
    hasEnoughForm: horses.length >= 3 && enoughHorseCount >= Math.min(3, horses.length),
    source: 'en.netkeiba.com',
  };
}

async function fetchResult(race) {
  const html = await fetchHtml(race.resultUrl || `${BASE}/race/result.html?race_id=${race.raceId}`);
  const $ = cheerio.load(html);
  const lines = $('body').text().split('\n').map(normalizeText).filter(Boolean);
  const resultLines = [];
  for (const line of lines) {
    if (/^(1|2|3|4|5)\s+\d+\s+/.test(line)) resultLines.push(line);
  }
  return {
    raceId: race.raceId,
    raceName: race.name,
    topLines: resultLines.slice(0, 5),
    rawSummary: resultLines.length ? resultLines.slice(0, 10).join('\n') : '結果未確認または取得不可',
  };
}

async function findRaceByUserText(userText, races) {
  const t = normalizeText(userText).toLowerCase();
  const no = t.match(/^(\d{1,2})$/);
  if (no) return races[Number(no[1])-1] || null;
  return races.find(r => t.includes(String(r.name || '').toLowerCase()) || String(r.name || '').toLowerCase().includes(t.replace(/予想|結果/g,'').trim())) || null;
}

module.exports = {
  fetchRaceList,
  fetchRaceDetail,
  fetchResult,
  findRaceByUserText,
  parseRaceList,
};
