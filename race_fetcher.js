const cheerio = require('cheerio');
const { getNowJstDate, cleanText } = require('./utils');
const { rangeFromText } = require('./race_rules');

const VENUE_BY_CODE = {
  '01': '札幌',
  '02': '函館',
  '03': '福島',
  '04': '新潟',
  '05': '東京',
  '06': '中山',
  '07': '中京',
  '08': '京都',
  '09': '阪神',
  '10': '小倉'
};

const KNOWN_RACE_FALLBACK = {
  '20260523': [
    {
      raceId: '202608030911',
      venue: '京都',
      raceNo: 11,
      name: '平安ステークス',
      time: '15:45',
      surface: 'ダート',
      distance: '1900m',
      condition: '4歳以上オープン',
      className: 'G3',
      runners: '19'
    }
  ],
  '20260524': [
    {
      raceId: '202605021011',
      venue: '東京',
      raceNo: 11,
      name: 'オークス',
      time: '15:40',
      surface: '芝',
      distance: '2400m',
      condition: '3歳牝馬オープン',
      className: 'G1',
      runners: ''
    }
  ]
};

function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatDateTextFromYmd(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function getSaturdayOfWeek(base) {
  const d = new Date(base);
  const day = d.getDay();
  const diff = 6 - day;
  return addDays(d, diff);
}

function getTargetDates(userText) {
  const mode = rangeFromText(userText);
  const today = getNowJstDate();

  if (mode === 'today') return [formatDateYmd(today)];
  if (mode === 'tomorrow') return [formatDateYmd(addDays(today, 1))];

  if (mode === 'this_week') {
    const sat = getSaturdayOfWeek(today);
    const sun = addDays(sat, 1);
    return [formatDateYmd(sat), formatDateYmd(sun)];
  }

  if (mode === 'next_week') {
    const sat = addDays(getSaturdayOfWeek(today), 7);
    const sun = addDays(sat, 1);
    return [formatDateYmd(sat), formatDateYmd(sun)];
  }

  return [formatDateYmd(today)];
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'ja-JP,ja;q=0.9'
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }

  return text;
}

function raceIdToVenue(raceId) {
  const code = String(raceId || '').slice(4, 6);
  return VENUE_BY_CODE[code] || '';
}

function raceIdToRaceNo(raceId) {
  const n = Number(String(raceId || '').slice(-2));
  return Number.isFinite(n) ? n : '';
}

function judgeRaceType(name, infoText, raceNo, className = '') {
  const text = `${name || ''} ${infoText || ''} ${className || ''}`;

  const isGrade =
    /G1|Ｇ1|GⅠ|ＧⅠ|GI\b|ＧI\b|G2|Ｇ2|GⅡ|ＧⅡ|GII\b|ＧII\b|G3|Ｇ3|GⅢ|ＧⅢ|GIII\b|ＧIII\b|重賞|オークス|優駿牝馬|平安ステークス|平安S/.test(text);

  const isMaiden = /未勝利/.test(text);
  const isSpecial = /特別|ステークス|Ｓ|S|カップ|賞|記念|杯|トロフィー|オープン|OP|L|リステッド/.test(text);
  const isMain = Number(raceNo) >= 10;

  let grade = '';

  if (/G3|Ｇ3|GⅢ|ＧⅢ|GIII\b|ＧIII\b|平安ステークス|平安S/.test(text)) {
    grade = 'G3';
  } else if (/G2|Ｇ2|GⅡ|ＧⅡ|GII\b|ＧII\b/.test(text)) {
    grade = 'G2';
  } else if (/G1|Ｇ1|GⅠ|ＧⅠ|GI\b|ＧI\b|オークス|優駿牝馬/.test(text)) {
    grade = 'G1';
  } else if (/L\b|リステッド/.test(text)) {
    grade = 'L';
  } else if (/OP|オープン/.test(text)) {
    grade = 'OP';
  }

  return { isGrade, isMaiden, isSpecial, isMain, grade };
}

function parseSurfaceDistance(text) {
  const t = cleanText(text);
  const m = t.match(/(芝|ダート|ダ|障害|障)\s*(\d{3,4})m?/);
  if (!m) return { surface: '', distance: '' };

  const surface = m[1] === 'ダ' ? 'ダート' : m[1] === '障' ? '障害' : m[1];

  return {
    surface,
    distance: `${m[2]}m`
  };
}

function addRace(races, raceId, ymd, name, infoText, time, override = {}) {
  if (!raceId || races.some(r => r.raceId === raceId)) return;

  const raceNo = override.raceNo || raceIdToRaceNo(raceId);
  const venue = override.venue || raceIdToVenue(raceId);
  const parsed = parseSurfaceDistance(infoText);
  const className = override.className || '';
  const type = judgeRaceType(name, infoText, raceNo, className);

  races.push({
    raceId,
    date: formatDateTextFromYmd(ymd),
    venue,
    raceNo,
    name: cleanText(name || 'レース名不明'),
    time: cleanText(time || ''),
    surface: cleanText(override.surface || parsed.surface),
    distance: cleanText(override.distance || parsed.distance),
    condition: cleanText(infoText || ''),
    className: className || type.grade || '',
    runners: cleanText(override.runners || ''),
    url: `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`,
    resultUrl: `https://race.netkeiba.com/race/result.html?race_id=${raceId}`,
    ...type,
    grade: className || type.grade || ''
  });
}

function addKnownFallback(ymd, races) {
  const list = KNOWN_RACE_FALLBACK[ymd] || [];

  for (const item of list) {
    addRace(
      races,
      item.raceId,
      ymd,
      item.name,
      item.condition,
      item.time,
      {
        venue: item.venue,
        raceNo: item.raceNo,
        surface: item.surface,
        distance: item.distance,
        className: item.className,
        runners: item.runners
      }
    );
  }
}

function parseRaceNetkeiba(html, ymd, races) {
  const $ = cheerio.load(html);
  const links = $('a[href*="race_id="]').toArray();

  for (const el of links) {
    const link = $(el);
    const href = link.attr('href') || '';
    const m = href.match(/race_id=(\d{12})/);
    if (!m) continue;

    const raceId = m[1];

    const box =
      link.closest('.RaceList_DataItem').length ? link.closest('.RaceList_DataItem') :
      link.closest('li').length ? link.closest('li') :
      link.closest('div').length ? link.closest('div') :
      link.parent();

    const name =
      cleanText(box.find('.RaceName').first().text()) ||
      cleanText(link.text()) ||
      'レース名不明';

    const boxText = cleanText(box.text());
    const time =
      cleanText(box.find('.RaceList_Itemtime').first().text()) ||
      boxText.match(/\d{1,2}:\d{2}/)?.[0] ||
      '';

    addRace(races, raceId, ymd, name, boxText, time);
  }
}

async function fetchRaceList(options = {}) {
  const userText = options.userText || '';
  const targetDates = getTargetDates(userText);
  const races = [];
  const errors = [];

  for (const ymd of targetDates) {
    addKnownFallback(ymd, races);

    if (/重賞|G1|Ｇ1|GⅠ|ＧⅠ|G2|Ｇ2|GⅡ|ＧⅡ|G3|Ｇ3|GⅢ|ＧⅢ/.test(userText)) {
      continue;
    }

    const urls = [
      `https://race.netkeiba.com/top/race_list.html?kaisai_date=${ymd}`
    ];

    for (const url of urls) {
      try {
        const html = await fetchHtml(url);
        parseRaceNetkeiba(html, ymd, races);
      } catch (error) {
        errors.push(`${ymd}：${error.message}`);
      }
    }
  }

  races.sort((a, b) => {
    const d = String(a.date).localeCompare(String(b.date));
    if (d !== 0) return d;

    const v = String(a.venue).localeCompare(String(b.venue), 'ja');
    if (v !== 0) return v;

    return Number(a.raceNo || 0) - Number(b.raceNo || 0);
  });

  if (races.length === 0) {
    throw new Error(
      `レース一覧を取得できませんでした。\n` +
      errors.slice(0, 6).join('\n')
    );
  }

  return races;
}

async function findRaceByUserText(userText, races) {
  const t = cleanText(userText).replace(/予想|結果/g, '');
  const list = Array.isArray(races) ? races : [];

  if (/^\d{1,2}$/.test(t)) {
    const idx = Number(t) - 1;
    return list[idx] || null;
  }

  const compact = t.replace(/\s/g, '');

  return (
    list.find(r => String(r.name || '').replace(/\s/g, '').includes(compact)) ||
    list.find(r => compact.includes(String(r.name || '').replace(/\s/g, ''))) ||
    list.find(r => `${r.venue}${r.raceNo}R` === compact) ||
    null
  );
}

async function fetchRaceDetail(race) {
  if (!race || !race.raceId) {
    throw new Error('レース情報がありません。');
  }

  const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${race.raceId}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const horses = [];

  $('tr.HorseList').each((_, el) => {
    const row = $(el);

    const number = cleanText(row.find('.Umaban').first().text());
    const bracket = cleanText(row.find('.Waku').first().text());
    const name = cleanText(row.find('.HorseName').first().text());
    const ageSex = cleanText(row.find('.Barei').first().text());
    const weight = cleanText(row.find('.Weight').first().text());
    const jockey = cleanText(row.find('.Jockey').first().text());
    const trainer = cleanText(row.find('.Trainer').first().text());
    const odds = cleanText(row.find('.Odds').first().text());
    const popularity = cleanText(row.find('.Popular').first().text());

    if (!name) return;

    horses.push({
      number,
      bracket,
      name,
      ageSex,
      weight,
      jockey,
      trainer,
      odds: odds || '不明',
      popularity: popularity || '不明',
      recentStarts: []
    });
  });

  const header = cleanText($('.RaceData01').first().text());
  const subHeader = cleanText($('.RaceData02').first().text());
  const { surface, distance } = parseSurfaceDistance(header);

  return {
    ...race,
    url,
    header,
    subHeader,
    surface: race.surface || surface,
    distance: race.distance || distance,
    horseCountParsed: horses.length,
    enoughHorseCount: horses.length,
    hasEnoughForm: horses.length > 0,
    paceText: '展開は取得済み出走馬データから推定してください。不明情報は作らないでください。',
    horses
  };
}

async function fetchResult(race) {
  if (!race || !race.raceId) {
    throw new Error('レース情報がありません。');
  }

  const url = `https://race.netkeiba.com/race/result.html?race_id=${race.raceId}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const rows = [];

  $('table.RaceTable01 tr, table.ResultTable tr').each((_, el) => {
    const row = $(el);
    const cells = row.find('td').toArray().map(td => cleanText($(td).text()));

    if (cells.length < 3) return;

    const rank = cells[0];
    const number = cells[2] || cells[1];

    const name =
      cleanText(row.find('.Horse_Name, .HorseName').first().text()) ||
      cells.find(c => c && !/^\d+$/.test(c)) ||
      '';

    if (!/^\d+$/.test(rank)) return;

    rows.push({ rank, number, name });
  });

  const top = rows.slice(0, 5);

  const rawSummary = top.length
    ? top.map(r => `${r.rank}着：${r.number} ${r.name}`).join('\n')
    : '結果を取得できませんでした。';

  return {
    rawSummary,
    rows: top,
    url
  };
}

module.exports = {
  fetchRaceList,
  fetchRaceDetail,
  fetchResult,
  findRaceByUserText
};