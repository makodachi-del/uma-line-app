const LOCAL_COURSES = ['川崎','浦和','大井','船橋','園田','高知','佐賀','名古屋','笠松','門別','金沢','水沢','盛岡','姫路','帯広'];
const JRA_COURSES = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
const JUMP_WORDS = ['障害','ジャンプ','ハイジャンプ','グランドジャンプ','J・G','Ｊ・Ｇ'];
const NEWCOMER_WORDS = ['新馬','メイクデビュー'];
const GRADE_WORDS = ['G1','G2','G3','Ｇ１','Ｇ２','Ｇ３','GI','GII','GIII','Jpn'];
const LISTED_WORDS = ['リステッド','L)','（L）','(L)','Ｌ'];
const SPECIAL_SUFFIX = ['特別','ステークス','Ｓ','カップ','賞'];

function includesAny(text, words) {
  return words.some((w) => String(text || '').includes(w));
}

function isLocalRace(race) {
  const text = `${race.course || ''} ${race.name || ''}`;
  return includesAny(text, LOCAL_COURSES);
}

function isJraCourse(race) {
  return JRA_COURSES.includes(race.course);
}

function isJumpRace(race) {
  return includesAny(`${race.name || ''} ${race.condition || ''}`, JUMP_WORDS);
}

function isNewcomerRace(race) {
  return includesAny(`${race.name || ''} ${race.condition || ''}`, NEWCOMER_WORDS);
}

function isMaidenRace(race) {
  return String(race.name || '').includes('未勝利') || String(race.condition || '').includes('未勝利');
}

function isGradeRace(race) {
  const text = `${race.name || ''} ${race.grade || ''} ${race.condition || ''}`;
  return includesAny(text, GRADE_WORDS) && !isJumpRace(race);
}

function isListedRace(race) {
  const text = `${race.name || ''} ${race.grade || ''} ${race.condition || ''}`;
  return includesAny(text, LISTED_WORDS) && !isJumpRace(race);
}

function isSpecialRace(race) {
  const text = `${race.name || ''} ${race.condition || ''}`;
  if (isGradeRace(race) || isListedRace(race)) return false;
  if (isMaidenRace(race) || isNewcomerRace(race) || isJumpRace(race)) return false;
  return SPECIAL_SUFFIX.some((w) => text.includes(w));
}

function isFlatJraTargetBase(race) {
  if (!race) return false;
  if (isLocalRace(race)) return false;
  if (!isJraCourse(race)) return false;
  if (isJumpRace(race)) return false;
  if (isNewcomerRace(race)) return false;
  return true;
}

function getRequestMode(userText) {
  const t = String(userText || '');
  if (/集計まとめ|まとめ/.test(t)) return 'summary';
  if (/検証/.test(t)) return 'verify';
  if (/集計/.test(t)) return 'aggregate';
  if (/結果/.test(t)) return 'result';
  if (/未勝利/.test(t)) return 'maiden';
  if (/特別以上/.test(t)) return 'special_plus';
  if (/特別/.test(t)) return 'special';
  if (/重賞|G1|G2|G3|Ｇ１|Ｇ２|Ｇ３/.test(t)) return 'grade';
  if (/予想/.test(t)) return 'predict';
  if (/テスト/.test(t)) return 'test';
  return 'chat';
}

function isTargetForMode(race, mode) {
  if (!isFlatJraTargetBase(race)) return false;
  if (mode === 'grade') return isGradeRace(race);
  if (mode === 'special_plus') return isGradeRace(race) || isListedRace(race) || isSpecialRace(race);
  if (mode === 'special') return isSpecialRace(race);
  if (mode === 'maiden') return isMaidenRace(race) && race.hasEnoughPastRuns === true;
  return isGradeRace(race) || isListedRace(race) || isSpecialRace(race);
}

module.exports = {
  JRA_COURSES,
  LOCAL_COURSES,
  isGradeRace,
  isListedRace,
  isSpecialRace,
  isMaidenRace,
  isTargetForMode,
  getRequestMode
};
