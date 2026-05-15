const { isTargetForMode } = require('./race_rules');

function classifyRaces(races, mode) {
  return (races || [])
    .filter((race) => isTargetForMode(race, mode))
    .map((race, idx) => ({ ...race, no: idx + 1 }));
}

function formatRaceList(races, mode) {
  if (!races.length) {
    return `対象レースが見つかりませんでした。\n対象：${mode}\n理由：JRA平地・対象条件・障害除外・地方除外で分類した結果、該当なしです。`;
  }
  const title = mode === 'grade' ? '重賞' : mode === 'special_plus' ? '特別以上' : mode === 'special' ? '特別' : mode === 'maiden' ? '未勝利' : '対象';
  const lines = [`${title}レース一覧`, 'No｜日付｜競馬場｜R｜レース名｜発走｜条件｜頭数｜馬柱'];
  for (const r of races) {
    lines.push(`${r.no}｜${r.date || '不明'}｜${r.course || '不明'}｜${r.raceNo || '不明'}｜${r.name || '不明'}｜${r.startTime || '不明'}｜${r.condition || '不明'}｜${r.headCount || '不明'}｜${r.cardStatus || '未確認'}`);
  }
  lines.push('番号を送ると予想します。例：1 または 1,3');
  return lines.join('\n');
}

module.exports = { classifyRaces, formatRaceList };
