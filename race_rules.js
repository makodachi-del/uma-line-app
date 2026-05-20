function modeFromText(text) {
  const t = String(text || '').trim();

  if (/集計|成績/.test(t)) return 'summary';
  if (/検証|照合/.test(t)) return 'verify';
  if (/結果|着順|払戻|払い戻し/.test(t)) return 'result';
  if (/予想/.test(t) || /^\d{1,2}$/.test(t)) return 'predict';

  if (/重賞|G1|Ｇ1|GⅠ|ＧⅠ|G2|Ｇ2|GⅡ|ＧⅡ|G3|Ｇ3|GⅢ|ＧⅢ/.test(t)) {
    return 'grade';
  }

  if (/特別以上|メイン|メインレース/.test(t)) {
    return 'special_or_above';
  }

  if (/特別/.test(t)) {
    return 'special';
  }

  if (/未勝利/.test(t)) {
    return 'maiden';
  }

  if (/今日のレース|今週のレース|来週のレース|レース一覧/.test(t)) {
    return 'special_or_above';
  }

  return 'chat';
}

function rangeFromText(text) {
  const t = String(text || '');

  if (/来週/.test(t)) return 'next_week';
  if (/今週/.test(t)) return 'this_week';
  if (/明日/.test(t)) return 'tomorrow';
  if (/今日/.test(t)) return 'today';

  return 'today';
}

function filterRacesByMode(races, mode) {
  const list = Array.isArray(races) ? races : [];

  if (mode === 'grade') {
    return list.filter(r => r.isGrade);
  }

  if (mode === 'special_or_above') {
    return list.filter(r => r.isGrade || r.isSpecial || r.isMain);
  }

  if (mode === 'special') {
    return list.filter(r => r.isSpecial && !r.isGrade);
  }

  if (mode === 'maiden') {
    return list.filter(r => r.isMaiden);
  }

  return list;
}

module.exports = {
  modeFromText,
  rangeFromText,
  filterRacesByMode
};