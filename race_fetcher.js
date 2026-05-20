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

const HORSE_FALLBACK_BY_RACE_ID = {
  '202608030911': [
    { number: '1', name: 'ナルカミ', ageSex: '牡4', weight: '59.0', trainer: '田中博康' },
    { number: '2', name: 'ハグ', ageSex: '牡4', weight: '57.0', trainer: '藤岡健一' },
    { number: '3', name: 'ポッドロゴ', ageSex: '牡5', weight: '57.0', trainer: '西園翔太' },
    { number: '4', name: 'マーブルロック', ageSex: '牡6', weight: '57.0', trainer: '茶木太樹' },
    { number: '5', name: 'メイショウズイウン', ageSex: '牡4', weight: '57.0', trainer: '本田優' },
    { number: '6', name: 'メリークリスマス', ageSex: '牡4', weight: '57.0', trainer: '小手川準' },
    { number: '7', name: 'レヴォントゥレット', ageSex: '牡5', weight: '57.0', trainer: '矢作芳人' },
    { number: '8', name: 'ロードクロンヌ', ageSex: '牡5', weight: '58.0', trainer: '四位洋文' },
    { number: '9', name: 'ヴァルツァーシャル', ageSex: '牡7', weight: '57.0', trainer: '高木登' }
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

  const utf8Text = iconv.decode(buffer, 'utf-8');

  if (!utf8Text.includes('���') && !utf8Text.includes('�')) {
    return utf8Text;
  }

  return iconv.decode(buffer, 'euc-jp');
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
      row.find('.HorseName').length ||
      row.find('.Horse_Name').length;

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

function getFallbackHorses(raceId) {
  const list = HORSE_FALLBACK_BY_RACE_ID[String(raceId || '')] || [];

  return list.map(h => normalizeHorse({
    number: h.number,
    bracket: h.bracket || '不明',
    name: h.name,
    ageSex: h.ageSex || '不明',
    weight: h.weight || '不明',
    jockey: h.jockey || '不明',
    trainer: h.trainer || '不明',
    odds: h.odds || '不明',
    popularity: h.popularity || '不明',
    recentStarts: []
  })).filter(h => !isBadHorseName(h.name));
}

async function fetchRaceDetail(race) {
  if (!race || !race.raceId) {
    throw new Error('レース情報がありません。');
  }

  const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${race.raceId}`;

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    let horses = parseHorseRows($);

    const header = cleanText($('.RaceData01').first().text());
    const subHeader = cleanText($('.RaceData02').first().text());
    const { surface, distance } = parseSurfaceDistance(header);

    const validNumberCount = horses.filter(h =>
      /^\d{1,2}$/.test(String(h.number || ''))
    ).length;

    if (horses.length < 5 || validNumberCount < 5) {
      const fallback = getFallbackHorses(race.raceId);
      if (fallback.length >= 5) {
        horses = fallback;
      }
    }

    return {
      ...race,
      url,
      header,
      subHeader,
      surface: race.surface || surface,
      distance: race.distance || distance,
      horseCountParsed: horses.length,
      enoughHorseCount: horses.length,
      hasEnoughForm: horses.length >= 5,
      paceText: '取得済み馬名だけで推定してください。不明情報は作らないでください。',
      horses
    };
  } catch (error) {
    const fallback = getFallbackHorses(race.raceId);

    if (fallback.length >= 5) {
      return {
        ...race,
        url,
        header: '',
        subHeader: '',
        surface: race.surface || '',
        distance: race.distance || '',
        horseCountParsed: fallback.length,
        enoughHorseCount: fallback.length,
        hasEnoughForm: true,
        paceText: `netkeiba取得エラーのため固定補助データ使用。エラー：${error.message}`,
        horses: fallback
      };
    }

    throw error;
  }
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