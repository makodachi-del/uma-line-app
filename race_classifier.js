function selectTargetRaces(races, mode) {
  const list = Array.isArray(races) ? races : [];

  if (mode === 'grade') return list.filter(r => r.isGrade);
  if (mode === 'special_or_above') return list.filter(r => r.isGrade || r.isSpecial || r.isMain);
  if (mode === 'special') return list.filter(r => r.isSpecial && !r.isGrade);
  if (mode === 'maiden') return list.filter(r => r.isMaiden);

  return list;
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
  lines.push(`うまぴょんAIです。`);
  lines.push(`${title}の対象レースです。`);
  lines.push('');

  list.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.date || '日付不明'} ${r.venue || '競馬場不明'}${r.raceNo || '?'}R ${r.name || 'レース名不明'}`
    );
    lines.push(
      `   ${r.time || '時刻不明'} / ${r.surface || '条件不明'}${r.distance || ''} / ${r.grade || r.className || '区分不明'}`
    );
  });

  lines.push('');
  lines.push('予想したい場合は、番号だけ送ってください。');
  lines.push('例：1');

  return lines.join('\n');
}

module.exports = {
  selectTargetRaces,
  formatRaceList
};