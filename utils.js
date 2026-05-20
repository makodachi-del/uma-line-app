function getNowJstDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

function getTodayJstText() {
  const d = getNowJstDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getNowJstIsoText() {
  const d = getNowJstDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${s}+09:00`;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function cleanLineReply(text) {
  return cleanText(text).slice(0, 4900);
}

function splitForLine(text) {
  const clean = cleanText(text);

  if (!clean) return ['うまぴょんAIの返事が空でした。'];

  const chunks = [];
  let rest = clean;

  while (rest.length > 0 && chunks.length < 5) {
    chunks.push(rest.slice(0, 4900));
    rest = rest.slice(4900);
  }

  return chunks;
}

function hasHorseWords(text) {
  return /競馬|JRA|重賞|特別|未勝利|予想|結果|検証|集計|レース|馬|うま|今日|今週|来週/.test(String(text || ''));
}

function isTueToFriNoJraDay() {
  const d = getNowJstDate();
  const day = d.getDay();
  return day >= 2 && day <= 5;
}

module.exports = {
  getNowJstDate,
  getTodayJstText,
  getNowJstIsoText,
  cleanText,
  cleanLineReply,
  splitForLine,
  hasHorseWords,
  isTueToFriNoJraDay
};