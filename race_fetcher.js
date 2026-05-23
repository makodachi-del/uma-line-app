const cheerio = require('cheerio');
const iconv = require('iconv-lite');
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

function countBadChars(text) {
  return (String(text || '').match(/�|���/g) || []).length;
}

function scoreJapaneseHtml(text) {
  const s = String(text || '');
  let score = 0;

  if (/競馬|馬名|騎手|レース|着順|距離|出馬表|netkeiba/i.test(s)) score += 10;
  if (/<html|<table|<tr|<td|charset/i.test(s)) score += 5;
  score -= countBadChars(s) * 20;

  return score;
}

function decodeHtmlBuffer(buffer, contentType = '') {
  const ct = String(contentType || '').toLowerCase();

  if (/charset\s*=\s*euc-jp|charset\s*=\s*eucjp/.test(ct)) {
    return iconv.decode(buffer, 'euc-jp');
  }

  if (/charset\s*=\s*shift_jis|charset\s*=\s*sjis/.test(ct)) {
    return iconv.decode(buffer, 'shift_jis');
  }

  if (/charset\s*=\s*utf-8|charset\s*=\s*utf8/.test(ct)) {
    return iconv.decode(buffer, 'utf-8');
  }

  const utf8 = iconv.decode(buffer, 'utf-8');
  const euc = iconv.decode(buffer, 'euc-jp');
  const sjis = iconv.decode(buffer, 'shift_jis');

  const candidates = [utf8, euc, sjis];
  candidates.sort((a, b) => scoreJapaneseHtml(b) - scoreJapaneseHtml(a));

  return candidates[0];
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'ja-JP,ja;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }

  return decodeHtmlBuffer(buffer, res.headers.get('content-type') || '');
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

function getCellTexts($, row) {
  return row.find('td').toArray().map(td => cleanText($(td).text())).filter(Boolean);
}

function textAt(cells, index) {
  return cleanText(cells[index] || '');
}

function absolutizeUrl(url) {
  const u = cleanText(url);
  if (!u) return '';
  if (u.startsWith('https://')) return u;
  if (u.startsWith('http://')) return u.replace('http://', 'https://');
  if (u.startsWith('//')) return `https:${u}`;

  try {
    return new URL(u, 'https://db.netkeiba.com/').toString();
  } catch (_) {
    return u;
  }
}

function horseIdToUrl(horseId) {
  const id = cleanText(horseId);
  if (!/^\d{6,12}$/.test(id)) return '';
  return `https://db.netkeiba.com/horse/${id}/`;
}

function pickHorseLink($, row) {
  const directHref =
    row.find('a[href*="/horse/"]').first().attr('href') ||
    row.find('a[href*="db.netkeiba.com/horse"]').first().attr('href') ||
    row.find('a[href*="horse_id="]').first().attr('href') ||
    '';

  if (directHref) {
    const directUrl = absolutizeUrl(directHref);
    const idFromDirect =
      directUrl.match(/\/horse\/(\d{6,12})/)?.[1] ||
      directUrl.match(/horse_id=(\d{6,12})/)?.[1] ||
      '';

    if (idFromDirect) return horseIdToUrl(idFromDirect);
    return directUrl;
  }

  const attrs = [];
  row.find('*').each((_, el) => {
    const node = $(el);
    const rawAttrs = el.attribs || {};
    Object.keys(rawAttrs).forEach(k => {
      attrs.push(`${k}=${rawAttrs[k]}`);
    });
  });

  const attrText = attrs.join(' ');
  const rowHtml = $.html(row);

  const horseId =
    attrText.match(/horse[_-]?id=["']?(\d{6,12})/i)?.[1] ||
    attrText.match(/HorseID["']?\s*[:=]\s*["']?(\d{6,12})/i)?.[1] ||
    rowHtml.match(/\/horse\/(\d{6,12})/)?.[1] ||
    rowHtml.match(/horse_id=(\d{6,12})/)?.[1] ||
    rowHtml.match(/data-horse-id=["']?(\d{6,12})/i)?.[1] ||
    '';

  return horseIdToUrl(horseId);
}

function pickHorseName($, row, cells) {
  const byLink =
    cleanText(row.find('a[href*="/horse/"]').first().text()) ||
    cleanText(row.find('a[href*="db.netkeiba.com/horse"]').first().text());

  return (
    cleanText(row.find('.HorseName').first().text()) ||
    cleanText(row.find('.Horse_Name').first().text()) ||
    byLink ||
    textAt(cells, 3) ||
    textAt(cells, 2) ||
    ''
  );
}

function pickJockey($, row, cells) {
  return (
    cleanText(row.find('.Jockey').first().text()) ||
    cleanText(row.find('a[href*="/jockey/"]').first().text()) ||
    cleanText(row.find('a[href*="db.netkeiba.com/jockey"]').first().text()) ||
    textAt(cells, 6) ||
    ''
  );
}

function pickTrainer($, row, cells) {
  return (
    cleanText(row.find('.Trainer').first().text()) ||
    cleanText(row.find('a[href*="/trainer/"]').first().text()) ||
    cleanText(row.find('a[href*="db.netkeiba.com/trainer"]').first().text()) ||
    textAt(cells, 7) ||
    ''
  );
}

function isBadHorseName(name) {
  const n = cleanText(name);
  if (!n) return true;
  if (/^馬名\d+$/.test(n)) return true;
  if (/�|���/.test(n)) return true;
  if (/馬番|枠|印|人気|オッズ|騎手|調教師|性齢|斤量/.test(n)) return true;
  return false;
}

function normalizeHorse(h) {
  const rawNumber = cleanText(h.number || '');
  const number = /^\d{1,2}$/.test(rawNumber) ? rawNumber : '不明';

  return {
    number,
    bracket: cleanText(h.bracket || '不明'),
    name: cleanText(h.name || ''),
    ageSex: cleanText(h.ageSex || '不明'),
    weight: cleanText(h.weight || '不明'),
    jockey: cleanText(h.jockey || '不明'),
    trainer: cleanText(h.trainer || '不明'),
    horseUrl: cleanText(h.horseUrl || ''),
    odds: cleanText(h.odds || '不明'),
    popularity: cleanText(h.popularity || '不明'),
    recentStarts: Array.isArray(h.recentStarts) ? h.recentStarts : []
  };
}

function parseHorseRows($) {
  const horses = [];
  const seen = new Set();

  const rows = $(
    [
      'tr.HorseList',
      'tr[class*="HorseList"]',
      'table.Shutuba_Table tr',
      'table.RaceTable01 tr',
      'table.Nk_Table tr',
      'tr'
    ].join(',')
  ).toArray();

  for (const el of rows) {
    const row = $(el);
    const rowText = cleanText(row.text());

    if (!rowText) continue;
    if (!row.find('td').length) continue;

    const hasHorse =
      row.find('a[href*="/horse/"]').length ||
      row.find('a[href*="db.netkeiba.com/horse"]').length ||
      row.find('a[href*="horse_id="]').length ||
      row.find('.HorseName').length ||
      row.find('.Horse_Name').length ||
      /horse[_-]?id|\/horse\/\d{6,12}/i.test($.html(row));

    if (!hasHorse) continue;

    const cells = getCellTexts($, row);

    const numberRaw =
      cleanText(row.find('.Umaban').first().text()) ||
      cleanText(row.find('td.Umaban').first().text()) ||
      textAt(cells, 1);

    const number = /^\d{1,2}$/.test(numberRaw) ? numberRaw : '';

    const bracketRaw =
      cleanText(row.find('.Waku').first().text()) ||
      cleanText(row.find('td.Waku').first().text()) ||
      textAt(cells, 0);

    const bracket = /^\d{1,2}$/.test(bracketRaw) ? bracketRaw : '';

    const name = pickHorseName($, row, cells);
    if (isBadHorseName(name)) continue;

    const key = `${number || 'no'}_${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ageSex =
      cleanText(row.find('.Barei').first().text()) ||
      cleanText(row.find('.Age').first().text()) ||
      textAt(cells, 4);

    const weight =
      cleanText(row.find('.Weight').first().text()) ||
      cleanText(row.find('.Kinryo').first().text()) ||
      textAt(cells, 5);

    const jockey = pickJockey($, row, cells);
    const trainer = pickTrainer($, row, cells);
    const horseUrl = pickHorseLink($, row);

    const odds =
      cleanText(row.find('.Odds').first().text()) ||
      cleanText(row.find('.Txt_R').first().text()) ||
      '';

    const popularity =
      cleanText(row.find('.Popular').first().text()) ||
      cleanText(row.find('.Ninki').first().text()) ||
      '';

    horses.push(normalizeHorse({
      number,
      bracket,
      name,
      ageSex,
      weight,
      jockey,
      trainer,
      horseUrl,
      odds,
      popularity,
      recentStarts: []
    }));
  }

  horses.sort((a, b) => {
    const an = /^\d{1,2}$/.test(a.number) ? Number(a.number) : 999;
    const bn = /^\d{1,2}$/.test(b.number) ? Number(b.number) : 999;
    return an - bn;
  });

  return horses;
}

function normalizeHeaderText(text) {
  return cleanText(text).replace(/\s/g, '').replace(/[()（）]/g, '');
}

function buildHeaderMap($, table) {
  const map = {};
  const headerRow =
    table.find('tr').filter((_, el) => $(el).find('th').length > 3).first();

  const headerCells = headerRow.find('th').toArray();

  headerCells.forEach((th, index) => {
    const key = normalizeHeaderText($(th).text());
    if (key) map[key] = index;
  });

  return map;
}

function getByHeader(cells, headerMap, names, fallbackIndex = -1) {
  for (const name of names) {
    const key = normalizeHeaderText(name);
    if (Object.prototype.hasOwnProperty.call(headerMap, key)) {
      return cleanText(cells[headerMap[key]] || '');
    }
  }

  if (fallbackIndex >= 0) {
    return cleanText(cells[fallbackIndex] || '');
  }

  return '';
}

function isRaceResultLikeTable($, table) {
  const text = cleanText(table.text());
  return /レース名/.test(text) && /着順/.test(text) && /距離/.test(text);
}

function pickRecentResultTables($) {
  const tables = [];

  $('table').each((_, el) => {
    const table = $(el);
    if (isRaceResultLikeTable($, table)) {
      tables.push(table);
    }
  });

  return tables;
}

function parseRecentStartsFromTable($, table) {
  const headerMap = buildHeaderMap($, table);
  const starts = [];

  table.find('tr').each((_, el) => {
    const row = $(el);
    const tds = row.find('td').toArray();
    if (!tds.length) return;

    const cells = tds.map(td => cleanText($(td).text()));

    const date = getByHeader(cells, headerMap, ['日付'], 0);
    const raceName = getByHeader(cells, headerMap, ['レース名'], 4);
    const rank = getByHeader(cells, headerMap, ['着順'], 11);
    const jockey = getByHeader(cells, headerMap, ['騎手'], 12);
    const weight = getByHeader(cells, headerMap, ['斤量'], 13);
    const course = getByHeader(cells, headerMap, ['距離'], 14);
    const going = getByHeader(cells, headerMap, ['馬場'], 15);
    const time = getByHeader(cells, headerMap, ['タイム'], 17);
    const margin = getByHeader(cells, headerMap, ['着差'], 18);
    const passing = getByHeader(cells, headerMap, ['通過'], 20);
    const pace = getByHeader(cells, headerMap, ['ペース'], 21);
    const last3f = getByHeader(cells, headerMap, ['上り', '上がり', '上3F'], 22);
    const bodyWeight = getByHeader(cells, headerMap, ['馬体重'], 23);

    if (!date || !raceName) return;
    if (!/\d{4}\/\d{1,2}\/\d{1,2}|\d{4}\.\d{1,2}\.\d{1,2}/.test(date)) return;
    if (/取消|除外|中止/.test(rank)) return;

    starts.push({
      date,
      raceName,
      rank: rank || '不明',
      jockey: jockey || '不明',
      weight: weight || '不明',
      course: course || '不明',
      going: going || '不明',
      time: time || '不明',
      margin: margin || '不明',
      passing: passing || '不明',
      pace: pace || '不明',
      last3f: last3f || '不明',
      bodyWeight: bodyWeight || '不明'
    });
  });

  return starts;
}

function parseRecentStartsFromHorseHtml(html) {
  const $ = cheerio.load(html);
  const starts = [];

  const mainTable =
    $('table.db_h_race_results').first().length ? $('table.db_h_race_results').first() :
    $('table.race_table_01').first().length ? $('table.race_table_01').first() :
    null;

  if (mainTable && mainTable.length) {
    starts.push(...parseRecentStartsFromTable($, mainTable));
  }

  if (starts.length === 0) {
    const tables = pickRecentResultTables($);
    for (const table of tables) {
      starts.push(...parseRecentStartsFromTable($, table));
      if (starts.length > 0) break;
    }
  }

  return starts.slice(0, 5);
}

async function fetchRecentStartsForHorse(horse) {
  if (!horse || !horse.horseUrl) return [];

  const base = horse.horseUrl.endsWith('/') ? horse.horseUrl : `${horse.horseUrl}/`;

  const urls = [
    base,
    `${base}result/`,
    base.replace('https://db.netkeiba.com/horse/', 'https://db.netkeiba.com/horse/result/')
  ];

  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const starts = parseRecentStartsFromHorseHtml(html);
      if (starts.length > 0) return starts;
    } catch (error) {
      console.error(`recentStarts error: ${horse.name} ${url} ${error.message}`);
    }
  }

  return [];
}

async function addRecentStartsToHorses(horses) {
  const result = [];
  const concurrency = 2;
  let index = 0;

  async function worker() {
    while (index < horses.length) {
      const currentIndex = index;
      index += 1;

      const horse = horses[currentIndex];
      const recentStarts = await fetchRecentStartsForHorse(horse);
      result[currentIndex] = {
        ...horse,
        recentStarts
      };
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return result.filter(Boolean);
}

async function fetchRaceDetail(race) {
  if (!race || !race.raceId) {
    throw new Error('レース情報がありません。');
  }

  const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${race.raceId}`;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const horses = parseHorseRows($);

  const header = cleanText($('.RaceData01').first().text());
  const subHeader = cleanText($('.RaceData02').first().text());
  const { surface, distance } = parseSurfaceDistance(header);

  const validNumberCount = horses.filter(h =>
    /^\d{1,2}$/.test(String(h.number || ''))
  ).length;

  const isEntryConfirmed = horses.length >= 5 && validNumberCount >= 5;
  const horsesWithRecentStarts = isEntryConfirmed ? await addRecentStartsToHorses(horses) : [];

  return {
    ...race,
    url,
    header,
    subHeader,
    surface: race.surface || surface,
    distance: race.distance || distance,
    horseCountParsed: horses.length,
    enoughHorseCount: horses.length,
    hasEnoughForm: isEntryConfirmed,
    entryConfirmed: isEntryConfirmed,
    entryStatusMessage: isEntryConfirmed
      ? '出馬表を確認できました。'
      : '出馬表がまだ確定していません。馬番が確認できないため、正式な予想はできません。出馬表確定後にもう一度送ってください。',
    paceText: isEntryConfirmed
      ? '出馬表取得済み。取得できない情報は作らないでください。'
      : '出馬表未確定。正式予想は行わないでください。',
    horses: isEntryConfirmed ? horsesWithRecentStarts : []
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
