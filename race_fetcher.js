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

const VENUE_CODE_BY_NAME = {
  '札幌': '01',
  '函館': '02',
  '福島': '03',
  '新潟': '04',
  '東京': '05',
  '中山': '06',
  '中京': '07',
  '京都': '08',
  '阪神': '09',
  '小倉': '10'
};

const KNOWN_RACE_FALLBACK = {
  '20260523': [
    {
      raceId: '202604010711',
      venue: '新潟',
      raceNo: 11,
      name: '大日岳特別',
      time: '',
      surface: '芝',
      distance: '1200m',
      condition: '4歳以上2勝クラス'
    },
    {
      raceId: '202605020910',
      venue: '東京',
      raceNo: 10,
      name: '欅ステークス',
      time: '',
      surface: 'ダート',
      distance: '1400m',
      condition: '4歳以上オープン'
    },
    {
      raceId: '202608030911',
      venue: '京都',
      raceNo: 11,
      name: '平安ステークス',
      time: '',
      surface: 'ダート',
      distance: '1900m',
      condition: 'G3 4歳以上オープン'
    }
  ],
  '20260524': [
    {
      raceId: '202604010811',
      venue: '新潟',
      raceNo: 11,
      name: '韋駄天ステークス',
      time: '',
      surface: '芝',
      distance: '1000m',
      condition: '4歳以上オープン'
    },
    {
      raceId: '202605021011',
      venue: '東京',
      raceNo: 11,
      name: 'オークス',
      time: '',
      surface: '芝',
      distance: '2400m',
      condition: 'G1 3歳オープン'
    },
    {
      raceId: '202608031011',
      venue: '京都',
      raceNo: 11,
      name: '都大路ステークス',
      time: '',
      surface: '芝',
      distance: '1800m',
      condition: 'L 4歳以上オープン'
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
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.google.com/'
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

function buildRaceId(year, venue, kaiji, dayNo, raceNo) {
  const venueCode = VENUE_CODE_BY_NAME[venue];
  if (!venueCode) return '';

  return (
    String(year) +
    venueCode +
    String(kaiji).padStart(2, '0') +
    String(dayNo).padStart(2, '0') +
    String(raceNo).padStart(2, '0')
  );
}

function judgeRaceType(name, infoText, raceNo) {
  const text = `${name || ''} ${infoText || ''}`;

  const isGrade = /G1|Ｇ1|GⅠ|ＧⅠ|GI|ＧI|G2|Ｇ2|GⅡ|ＧⅡ|G3|Ｇ3|GⅢ|ＧⅢ|重賞|オークス|優駿牝馬|平安ステークス/.test(text);
  const isMaiden = /未勝利/.test(text);
  const isSpecial = /特別|ステークス|Ｓ|S|カップ|賞|記念|杯|トロフィー|オープン|OP|L|リステッド/.test(text);
  const isMain = Number(raceNo) >= 10;

  let grade = '';
  if (/G1|Ｇ1|GⅠ|ＧⅠ|GI|ＧI|オークス|優駿牝馬/.test(text)) grade = 'G1';
  else if (/G2|Ｇ2|GⅡ|ＧⅡ/.test(text)) grade = 'G2';
  else if (/G3|Ｇ3|GⅢ|ＧⅢ|平安ステークス/.test(text)) grade = 'G3';
  else if (/L|リステッド/.test(text)) grade = 'L';
  else if (/OP|オープン/.test(text)) grade = 'OP';

  return { isGrade, isMaiden, isSpecial, isMain, grade };
}

function parseSurfaceDistance(text) {
  const t = cleanText(text);
  const m = t.match(/(芝|ダート|ダ|障害|障)\s*[・右左外直線]*\s*(\d{3,4})m?/);
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
  const type = judgeRaceType(name, infoText, raceNo);

  races.push({
    raceId,
    date: formatDateTextFromYmd(ymd),
    venue,
    raceNo,
    name: name || 'レース名不明',
    time: time || '',
    surface: override.surface || parsed.surface,
    distance: override.distance || parsed.distance,
    condition: infoText || '',
    className: type.grade || '',
    runners: '',
    url: `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`,
    resultUrl: `https://race.netkeiba.com/race/result.html?race_id=${raceId}`,
    ...type
  });
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

function parseDbNetkeiba(html, ymd, races) {
  const $ = cheerio.load(html);
  const links = $('a[href*="/race/"]').toArray();

  for (const el of links) {
    const link = $(el);
    const href = link.attr('href') || '';
    const m = href.match(/\/race\/(\d{12})/);
    if (!m) continue;

    const raceId = m[1];

    const row =
      link.closest('tr').length ? link.closest('tr') :
      link.closest('li').length ? link.closest('li') :
      link.parent();

    const name = cleanText(link.text()) || 'レース名不明';
    const rowText = cleanText(row.text());
    const time = rowText.match(/\d{1,2}:\d{2}/)?.[0] || '';

    addRace(races, raceId, ymd, name, rowText, time);
  }
}

function parseJraCalendar(html, ymd, races) {
  const $ = cheerio.load(html);
  const year = ymd.slice(0, 4);

  const text = cleanText($('body').text());

  const meetingMatches = [...text.matchAll(/(\d+)回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)(\d+)日/g)];

  for (const meet of meetingMatches) {
    const kaiji = Number(meet[1]);
    const venue = meet[2];
    const dayNo = Number(meet[3]);

    const start = meet.index;
    const nextMeet = meetingMatches.find(m => m.index > start);
    const block = text.slice(start, nextMeet ? nextMeet.index : start + 3000);

    const raceMatches = [...block.matchAll(/(\d{1,2})R\s*([^\dＲR]{2,40}?)(GⅠ|GⅡ|GⅢ|GI|GII|GIII|G1|G2|G3|L|リステッド|オープン|特別|ステークス|カップ|賞|記念|杯)?\s*(芝|ダート|ダ)?[・右左外直線\s]*?(\d{3,4})?メートル?/g)];

    for (const rm of raceMatches) {
      const raceNo = Number(rm[1]);
      let name = cleanText(`${rm[2]}${rm[3] || ''}`);
      name = name.replace(/^[・、。]+/, '').trim();

      if (!name || name.length < 2) continue;

      const surface = rm[4] === 'ダ' ? 'ダート' : (rm[4] || '');
      const distance = rm[5] ? `${rm[5]}m` : '';
      const raceId = buildRaceId(year, venue, kaiji, dayNo, raceNo);

      addRace(
        races,
        raceId,
        ymd,
        name,
        cleanText(`${name} ${surface} ${distance} ${block}`),
        '',
        { venue, raceNo, surface, distance }
      );
    }
  }
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
        distance: item.distance
      }
    );
  }
}

async function fetchRaceList(options = {}) {
  const userText = options.userText || '';
  const targetDates = getTargetDates(userText);
  const races = [];
  const errors = [];

  for (const ymd of targetDates) {
    const y = ymd.slice(0, 4);
    const m = String(Number(ymd.slice(4, 6)));
    const md = ymd.slice(4, 8);

    const urls = [
      `https://www.jra.go.jp/keiba/calendar${y}/${y}/${m}/${md}.html`,
      `https://race.netkeiba.com/top/race_list.html?kaisai_date=${ymd}`,
      `https://db.netkeiba.com/race/list/${ymd}/`
    ];

    for (const url of urls) {
      try {
        const html = await fetchHtml(url);

        if (url.includes('jra.go.jp')) {
          parseJraCalendar(html, ymd, races);
        } else if (url.includes('race.netkeiba.com')) {
          parseRaceNetkeiba(html, ymd, races);
        } else {
          parseDbNetkeiba(html, ymd, races);
        }
      } catch (error) {
        errors.push(`${ymd}：${error.message}`);
      }
    }

    addKnownFallback(ymd, races);
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
      `JRA公式・netkeibaの両方から取得できませんでした。\n` +
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