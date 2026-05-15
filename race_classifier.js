const { filterRacesByMode } = require('./race_rules');

function raceRow(r, index) {
  const cond = `${r.surface || ''}${r.distance || ''}m ${r.grade || ''}`.trim();
  const horseReady = r.hasEnoughForm ? '確認済み' : '未確認';
  return `|${index + 1}|${r.date || '不明'} ${r.venue || '不明'}${r.raceNo || '?'}R ${r.name || '不明'}|${r.time || '不明'}|${cond || r.condition || '不明'}|${r.runners || '不明'}|${horseReady}|`;
}

function formatRaceList(races, mode) {
  const filtered = filterRacesByMode(races, mode);
  if (!filtered.length) {
    return '対象レースが見つかりませんでした。\n取得元からレース一覧を取得できない、または条件に合うJRA平地レースがありません。';
  }
  const title = mode === 'grade' ? '重賞' : mode === 'special_or_above' ? '特別以上' : mode === 'special' ? '特別' : mode === 'maiden' ? '未勝利' : '対象';
  return [
    `■ ${title}レース一覧`,
    '|No|レース|発走時刻|条件|頭数|馬柱|',
    '|---:|---|---|---|---:|---|',
    ...filtered.map(raceRow),
    '',
    '予想する時は「レース名＋予想」または番号だけ送ってください。'
  ].join('\n');
}

function selectTargetRaces(races, mode) {
  return filterRacesByMode(races, mode);
}

module.exports = { formatRaceList, selectTargetRaces };
