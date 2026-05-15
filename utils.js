const MAX_LINE_MESSAGE = 4500;

function nowJstDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

function getNowJstIsoText() {
  const d = nowJstDate();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+09:00`;
}

function getTodayJstYmd() {
  const d = nowJstDate();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

function getTodayJstText() {
  const d = nowJstDate();
  const days = ['日','月','火','水','木','金','土'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${pad(d.getMonth()+1)}月${pad(d.getDate())}日(${days[d.getDay()]})`;
}

function isTueToFriNoJraDay() {
  const day = nowJstDate().getDay();
  return day >= 2 && day <= 5;
}

function hasTodayHorseWords(text) {
  return /(今日|本日).*(重賞|特別|未勝利|競馬|レース|予想)|^(今日|本日)$/.test(text || '');
}

function cleanLineReply(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/\r\n/g, '\n')
    .trim();
}

function splitForLine(text) {
  const cleaned = cleanLineReply(text);
  if (cleaned.length <= MAX_LINE_MESSAGE) return [cleaned || '不明'];
  const parts = [];
  let rest = cleaned;
  while (rest.length > MAX_LINE_MESSAGE) {
    let cut = rest.lastIndexOf('\n', MAX_LINE_MESSAGE);
    if (cut < 1000) cut = MAX_LINE_MESSAGE;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.slice(0, 5);
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function yen(n) { return `${n}円`; }

module.exports = {
  nowJstDate,
  getNowJstIsoText,
  getTodayJstYmd,
  getTodayJstText,
  isTueToFriNoJraDay,
  hasTodayHorseWords,
  cleanLineReply,
  splitForLine,
  normalizeText,
  yen,
};
