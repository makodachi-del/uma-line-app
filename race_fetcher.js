const cheerio = require('cheerio');
const { yyyymmdd } = require('./utils');

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
};

async function fetchHtml(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return await res.text();
}

function detectCourse(text) {
  const courses = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
  return courses.find((c) => String(text || '').includes(c)) || '不明';
}

function parseNetkeibaRaceList(html, dateKey) {
  const $ = cheerio.load(html);
  const races = [];
  $('a[href*="/race/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const text = $(a).text().replace(/\s+/g, ' ').trim();
    const idMatch = href.match(/race_id=(\d{12})/) || href.match(/race\/(\d{12})/);
    if (!idMatch || !text) return;
    const raceId = idMatch[1];
    if (races.some((r) => r.raceId === raceId)) return;
    const parentText = $(a).parent().text().replace(/\s+/g, ' ').trim();
    const nearby = `${parentText} ${text}`;
    const rMatch = nearby.match(/(\d{1,2})R/);
    const timeMatch = nearby.match(/(\d{1,2}:\d{2})/);
    races.push({
      source: 'netkeiba',
      raceId,
      date: dateKey,
      course: detectCourse(nearby),
      raceNo: rMatch ? `${rMatch[1]}R` : '不明',
      name: text,
      startTime: timeMatch ? timeMatch[1] : '不明',
      condition: nearby.includes('ダ') ? 'ダート' : nearby.includes('芝') ? '芝' : '不明',
      grade: nearby.match(/G[123]|Ｇ[１２３]|\(L\)|（L）/)?.[0] || '',
      url: href.startsWith('http') ? href : `https://race.netkeiba.com${href}`,
      hasEnoughPastRuns: false,
      rawText: nearby.slice(0, 500)
    });
  });
  return races;
}

async function fetchRaceList(dateKey) {
  const d = yyyymmdd(dateKey);
  const errors = [];
  const sources = [
    process.env.UMA_FREE_RACE_LIST_URL ? process.env.UMA_FREE_RACE_LIST_URL.replace('{date}', d).replace('{yyyy-mm-dd}', dateKey) : null,
    `https://race.netkeiba.com/top/race_list.html?kaisai_date=${d}`
  ].filter(Boolean);

  for (const url of sources) {
    try {
      const html = await fetchHtml(url);
      const list = parseNetkeibaRaceList(html, dateKey);
      if (list.length) return { races: list, sourceUrl: url, errors };
      errors.push(`取得できたがレース一覧を解析できません: ${url}`);
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { races: [], sourceUrl: '', errors };
}

function parseHorseRows(html) {
  const $ = cheerio.load(html);
  const horses = [];
  $('tr').each((_, tr) => {
    const text = $(tr).text().replace(/\s+/g, ' ').trim();
    const horseName = $(tr).find('a[href*="/horse/"]').first().text().replace(/\s+/g, ' ').trim();
    if (!horseName) return;
    const nums = text.match(/\b\d{1,2}\b/g) || [];
    const horseNo = nums[0] || '不明';
    const jockey = $(tr).find('a[href*="/jockey/"]').first().text().replace(/\s+/g, ' ').trim() || '不明';
    const trainer = $(tr).find('a[href*="/trainer/"]').first().text().replace(/\s+/g, ' ').trim() || '不明';
    horses.push({ horseNo, horseName, jockey, trainer, rawText: text.slice(0, 500) });
  });
  return horses;
}

async function fetchRaceDetail(race) {
  if (!race?.url) return { ...race, horses: [], cardStatus: '未確認', detailText: '' };
  try {
    const html = await fetchHtml(race.url);
    const horses = parseHorseRows(html);
    const $ = cheerio.load(html);
    const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
    return {
      ...race,
      horses,
      cardStatus: horses.length ? '確認済み' : '未確認',
      headCount: horses.length || race.headCount || '不明',
      detailText: pageText
    };
  } catch (e) {
    return { ...race, horses: [], cardStatus: '未確認', detailText: '', fetchError: e.message };
  }
}

module.exports = { fetchRaceList, fetchRaceDetail };
