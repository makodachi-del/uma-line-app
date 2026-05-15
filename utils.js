function getNowJstIsoText() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace('Z', '+09:00');
}

function getTodayJstDateKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function getTodayJstText() {
  const d = getTodayJstDateKey();
  return `${d} JST`;
}

function yyyymmdd(dateKey = getTodayJstDateKey()) {
  return dateKey.replaceAll('-', '');
}

function cleanLineReply(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .trim()
    .slice(0, 4800);
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isTuesdayToFridayJst() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.getUTCDay();
  return day >= 2 && day <= 5;
}

function getNoJraTodayReplyIfNeeded(userText) {
  const t = String(userText || '');
  const hasToday = /今日|本日/.test(t);
  const hasKeiba = /競馬|重賞|特別|未勝利|予想|結果|レース/.test(t);
  if (isTuesdayToFridayJst() && hasToday && hasKeiba) {
    return '今日は原則JRA開催日ではありません。JRA開催が確認できる土日・祝日開催日、または「今週の重賞」「来週の重賞」のように送ってください。';
  }
  return null;
}

function splitNumbers(text) {
  const m = String(text || '').match(/\d+/g) || [];
  return m.map(Number).filter((n) => Number.isFinite(n));
}

module.exports = {
  getNowJstIsoText,
  getTodayJstDateKey,
  getTodayJstText,
  yyyymmdd,
  cleanLineReply,
  normalizeText,
  getNoJraTodayReplyIfNeeded,
  splitNumbers
};
