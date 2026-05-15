 const LOCAL_RACECOURSES = ['川崎','浦和','大井','船橋','園田','高知','佐賀','名古屋','笠松','門別','金沢','水沢','盛岡','姫路','帯広'];
const JRA_COURSE_BY_CODE = {
  '01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉'
};
const JRA_COURSE_EN_TO_JP = {
  SAPPORO:'札幌', HAKODATE:'函館', FUKUSHIMA:'福島', NIIGATA:'新潟', TOKYO:'東京', NAKAYAMA:'中山', CHUKYO:'中京', KYOTO:'京都', HANSHIN:'阪神', KOKURA:'小倉'
};

function venueFromRaceId(raceId) {
  const s = String(raceId || '');
  if (s.length >= 6) return JRA_COURSE_BY_CODE[s.slice(4,6)] || '不明';
  return '不明';
}

function isLocalRace(text) {
  return LOCAL_RACECOURSES.some(v => String(text || '').includes(v));
}

function isJumpRace(race) {
  const s = `${race.name || ''} ${race.condition || ''} ${race.surface || ''}`;
  return /障害|ジャンプ|ハイジャンプ|J-G|JG1|JG2|JG3|J\d{3,4}m|\bJ\b/i.test(s);
}

function isFlatRace(race) {
  if (isJumpRace(race)) return false;
  const s = `${race.condition || ''} ${race.surface || ''}`;
  return /芝|ダ|T\d{3,4}m|D\d{3,4}m|\bT\b|\bD\b/i.test(s);
}

function isGradeRace(race) {
  const s = `${race.name || ''} ${race.grade || ''} ${race.condition || ''}`;
  return /(^|\s)(G1|G2|G3)(\s|$)|\((G1|G2|G3)\)/i.test(s);
}

function isListedOrOpen(race) {
  const s = `${race.name || ''} ${race.grade || ''} ${race.condition || ''}`;
  return /(^|\s)(L|OP)(\s|$)|Listed|Open/i.test(s);
}

function isSpecialRace(race) {
  const s = `${race.name || ''} ${race.condition || ''}`;
  if (isGradeRace(race)) return false;
  if (isListedOrOpen(race)) return true;
  return /Stakes|Tokubetsu|Sho|Hai|Cup|特別|ステークス|賞|杯|ハンデ|記念/i.test(s) && !/Maiden|新馬|未勝利/i.test(s);
}

function isMaidenRace(race) {
  const s = `${race.name || ''} ${race.condition || ''}`;
  return /Maiden|未勝利/i.test(s) && !/Newcomer|新馬/i.test(s);
}

function isNewcomerRace(race) {
  const s = `${race.name || ''} ${race.condition || ''}`;
  return /Newcomer|新馬|Debut/i.test(s);
}

function classifyRace(race) {
  if (!race || isLocalRace(`${race.venue || ''}${race.name || ''}`)) return '対象外';
  if (!isFlatRace(race)) return '対象外';
  if (isNewcomerRace(race)) return '対象外';
  if (isGradeRace(race)) return '重賞';
  if (isMaidenRace(race)) return '未勝利';
  if (isSpecialRace(race)) return '特別';
  return '対象外';
}

function filterRacesByMode(races, mode) {
  return (races || []).map(r => ({...r, category: classifyRace(r)})).filter(r => {
    if (mode === 'grade') return r.category === '重賞';
    if (mode === 'special_or_above') return ['重賞','特別'].includes(r.category);
    if (mode === 'special') return r.category === '特別';
    if (mode === 'maiden') return r.category === '未勝利';
    return r.category !== '対象外';
  });
}

function modeFromText(text) {
  const t = String(text || '');
  if (/検証/.test(t)) return 'verify';
  if (/集計/.test(t)) return 'summary';
  if (/結果/.test(t)) return 'result';
  if (/未勝利/.test(t)) return 'maiden';
  if (/特別以上/.test(t)) return 'special_or_above';
  if (/特別/.test(t)) return 'special';
  if (/重賞|G1|G2|G3/.test(t)) return 'grade';
  if (/予想/.test(t)) return 'predict';
  return 'chat';
}

module.exports = {
  JRA_COURSE_BY_CODE,
  JRA_COURSE_EN_TO_JP,
  venueFromRaceId,
  isJumpRace,
  isFlatRace,
  isGradeRace,
  isSpecialRace,
  isMaidenRace,
  classifyRace,
  filterRacesByMode,
  modeFromText,
};
