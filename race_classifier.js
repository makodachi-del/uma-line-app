function selectTargetRaces(races, mode) {
  const list = Array.isArray(races) ? races : [];

  if (mode === 'grade') return list.filter(r => r.isGrade);
  if (mode === 'special_or_above') return list.filter(r => r.isGrade || r.isSpecial || r.isMain);
  if (mode === 'special') return list.filter(r => r.isSpecial && !r.isGrade);
  if (mode === 'maiden') return list.filter(r => r.isMaiden);

  return list;
}

function oneLine(value, fallback = '') {
  return String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanRaceName(name) {
  return oneLine(name, 'レース名不明')
    .replace(/^\d{1,2}R\s*/g, '')
    .replace(/\s*\d{1,2}R$/g, '')
    .trim();
}

function formatRaceList(races, mode) {
  const list = Array.isArray(races) ? races : [];

  const titleMap = {
    grade: '重賞',
    special_or_above: '特別以上',
    special: '特別',
    maiden: '未勝利'
  };

  const title = titleMap[mode] || '対象レース';

  if (list.length === 0) {
    return `うまぴょんAIです。\n${title}の対象レースが見つかりませんでした。\n開催日・取得元の更新状況によって、まだ取れない場合があります。`;
  }

  const lines = [];
  lines.push('うまぴょんAIです。');
  lines.push(`${title}の対象レースです。`);
  lines.push('');

  list.forEach((r, i) => {
    const date = oneLine(r.date, '日付不明');
    const venue = oneLine(r.venue, '競馬場不明');
    const raceNo = oneLine(r.raceNo, '?');
    const name = cleanRaceName(r.name);
    const time = oneLine(r.time, '時刻不明');
    const surface = oneLine(r.surface, '条件不明');
    const distance = oneLine(r.distance, '');
    const grade = oneLine(r.className || r.grade, '区分不明');
    const runners = oneLine(r.runners, '');

    lines.push(`${i + 1}. ${date} ${venue}${raceNo}R ${name}`);

    let detail = `   ${time} / ${surface}${distance} / ${grade}`;
    if (runners) detail += ` / ${runners}頭`;

    lines.push(detail);
    lines.push('');
  });

  lines.push('予想したい場合は、番号だけ送ってください。');
  lines.push('例：1');

  return lines.join('\n');
}

module.exports = {
  selectTargetRaces,
  formatRaceList
};