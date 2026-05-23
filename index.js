const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');

const UMA_PROMPT_RAW = require('./uma_prompt');
const UMA_KNOWLEDGE_RAW = require('./uma_knowledge');

const { modeFromText, filterRacesByMode } = require('./race_rules');
const { fetchRaceList, fetchRaceDetail, fetchResult, findRaceByUserText } = require('./race_fetcher');
const { formatRaceList, selectTargetRaces } = require('./race_classifier');
const { saveToSheet, getSheetSummary } = require('./sheet_api');
const {
  getTodayJstText,
  getNowJstIsoText,
  splitForLine,
  cleanLineReply,
  hasHorseWords,
  isTueToFriNoJraDay
} = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

const userLastLists = new Map();

const FIXED_THIS_WEEK_GRADE_RACES = [
  {
    raceId: '202608030911',
    date: '2026-05-23',
    venue: '京都',
    raceNo: 11,
    name: '平安ステークス',
    time: '15:45',
    surface: 'ダート',
    distance: '1900m',
    grade: 'G3',
    className: 'G3',
    runners: '19',
    isGrade: true,
    isSpecial: true,
    isMain: true,
    isMaiden: false,
    condition: '4歳以上オープン',
    url: 'https://race.netkeiba.com/race/shutuba.html?race_id=202608030911',
    resultUrl: 'https://race.netkeiba.com/race/result.html?race_id=202608030911'
  },
  {
    raceId: '202605021011',
    date: '2026-05-24',
    venue: '東京',
    raceNo: 11,
    name: 'オークス',
    time: '15:40',
    surface: '芝',
    distance: '2400m',
    grade: 'G1',
    className: 'G1',
    runners: '',
    isGrade: true,
    isSpecial: true,
    isMain: true,
    isMaiden: false,
    condition: '3歳牝馬オープン',
    url: 'https://race.netkeiba.com/race/shutuba.html?race_id=202605021011',
    resultUrl: 'https://race.netkeiba.com/race/result.html?race_id=202605021011'
  }
];

function toText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.default === 'string') return value.default;
  if (value && typeof value.prompt === 'string') return value.prompt;
  if (value && typeof value.knowledge === 'string') return value.knowledge;
  return JSON.stringify(value, null, 2);
}

const UMA_PROMPT = toText(UMA_PROMPT_RAW);
const UMA_KNOWLEDGE = toText(UMA_KNOWLEDGE_RAW);

app.get('/', (_, res) => res.status(200).send('umapyon-ai is running'));
app.get('/health', (_, res) => res.status(200).json({ ok: true, app: 'umapyon-ai', now: getNowJstIsoText() }));

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).end();
  const events = req.body.events || [];

  await Promise.all(events.map(async event => {
    try {
      await handleEvent(event);
    } catch (error) {
      console.error('handleEvent error:', error);
    }
  }));
});

async function handleEvent(event) {
  if (event.type !== 'message') return;
  if (!event.message || event.message.type !== 'text') return;

  const userText = event.message.text.trim();
  const userId = event.source?.userId || 'default';

  let reply = '';
  try {
    reply = await handleUserText(userText, userId);
  } catch (error) {
    console.error('handleUserText error:', error);
    reply = `ごめんなさい。うまぴょんAIの中でエラーが出ました。\n${error.message}\nRender Logsを確認してください。`;
  }

  await replyLine(event.replyToken, reply);
}

async function replyLine(replyToken, text) {
  const messages = splitForLine(text).map(t => ({ type: 'text', text: cleanLineReply(t) }));
  await lineClient.replyMessage({ replyToken, messages });
}

function isFixedThisWeekGradeRequest(userText) {
  const t = String(userText || '').replace(/\s/g, '');
  return /今週/.test(t) && /重賞|G1|GⅠ|ＧⅠ|G2|GⅡ|ＧⅡ|G3|GⅢ|ＧⅢ/.test(t) && !/予想|結果|検証|集計/.test(t);
}

function isNumberOnly(userText) {
  return /^\d{1,2}$/.test(String(userText || '').trim());
}

function setFixedGradeCache(userId) {
  userLastLists.set(userId, {
    mode: 'grade',
    races: FIXED_THIS_WEEK_GRADE_RACES,
    savedAt: Date.now(),
    userText: '今週の重賞'
  });
}

function hasCachedRaceList(userId) {
  const cached = userLastLists.get(userId);
  return cached && Array.isArray(cached.races) && cached.races.length > 0;
}

function formatFixedThisWeekGradeList() {
  return (
    `うまぴょんAIです。\n` +
    `今週の重賞レースです。\n\n` +
    `1. 2026-05-23 京都11R 平安ステークス\n` +
    `   15:45 / ダート1900m / G3 / 19頭\n\n` +
    `2. 2026-05-24 東京11R オークス\n` +
    `   15:40 / 芝2400m / G1\n\n` +
    `予想したい場合は、番号だけ送ってください。\n` +
    `例：1`
  );
}

async function handleFixedThisWeekGrade(userText, userId) {
  setFixedGradeCache(userId);
  const reply = formatFixedThisWeekGradeList();

  await saveToSheet({
    type: 'list_grade_fixed',
    userText,
    aiReply: reply,
    targetDate: getTodayJstText(),
    memo: '今週の重賞 固定表示'
  });

  return reply;
}

async function handleUserText(userText, userId = 'default') {
  if (userText === 'テスト') {
    const reply = 'うまぴょんAIです。接続OKです。';
    await saveToSheet({ type: 'test', userText, aiReply: reply, targetDate: getTodayJstText() });
    return reply;
  }

  if (isFixedThisWeekGradeRequest(userText)) {
    return await handleFixedThisWeekGrade(userText, userId);
  }

  if (isNumberOnly(userText)) {
    if (!hasCachedRaceList(userId)) setFixedGradeCache(userId);
    return await handlePrediction(`${userText} 予想`, userId);
  }

  const mode = modeFromText(userText);

  if (mode === 'summary') return await handleSummary(userText);
  if (mode === 'verify') return await handleVerify(userText);
  if (mode === 'result') return await handleResult(userText, userId);

  if (['grade', 'special_or_above', 'special', 'maiden'].includes(mode) && !/予想|結果/.test(userText)) {
    return await handleList(userText, mode, userId);
  }

  if (mode === 'predict') return await handlePrediction(userText, userId);

  if (isTueToFriNoJraDay() && hasHorseWords(userText) && !/今週|来週|結果|検証|集計|過去/.test(userText)) {
    const fixed =
      `今日は${getTodayJstText()}です。\n` +
      `通常、火〜金はJRA開催日ではないため、今日のJRA対象レースはありません。\n` +
      `「今週の重賞」「今週の特別以上」で確認してください。`;

    await saveToSheet({ type: 'no_jra_fixed', userText, aiReply: fixed, targetDate: getTodayJstText() });
    return fixed;
  }

  return await handleChat(userText);
}

async function handleChat(userText) {
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: buildSystemMessage() },
      { role: 'user', content: userText }
    ]
  });

  const reply = completion.choices?.[0]?.message?.content || 'うまぴょんAIの返事が空でした。';
  await saveToSheet({ type: 'chat', userText, aiReply: reply, targetDate: getTodayJstText() });
  return reply;
}

async function handleList(userText, mode, userId = 'default') {
  const races = await fetchRaceList({ userText });
  const filtered = filterRacesByMode(races, mode);
  const targets = selectTargetRaces(filtered, mode);

  userLastLists.set(userId, { mode, races: targets, savedAt: Date.now(), userText });

  const reply = formatRaceList(targets, mode);
  await saveToSheet({
    type: `list_${mode}`,
    userText,
    aiReply: reply,
    targetDate: getTodayJstText(),
    memo: `取得${races.length}件 / 対象${targets.length}件`
  });

  return reply;
}

async function getTargetRace(userText, preferredMode = 'grade', userId = 'default') {
  const cleaned = String(userText || '').replace(/予想|結果/g, '').trim();
  const cached = userLastLists.get(userId);

  if (/^\d{1,2}$/.test(cleaned)) {
    if (cached && Array.isArray(cached.races)) {
      const cachedRace = await findRaceByUserText(cleaned, cached.races);
      if (cachedRace) return { race: cachedRace, races: cached.races };
    }

    const fixedRace = FIXED_THIS_WEEK_GRADE_RACES[Number(cleaned) - 1] || null;
    if (fixedRace) return { race: fixedRace, races: FIXED_THIS_WEEK_GRADE_RACES };
  }

  const races = await fetchRaceList({ userText });
  const filtered = filterRacesByMode(races, preferredMode);
  let race = await findRaceByUserText(cleaned, filtered);

  if (!race) race = await findRaceByUserText(cleaned, races);
  return { race, races };
}

async function handlePrediction(userText, userId = 'default') {
  const preferredMode =
    /未勝利/.test(userText) ? 'maiden' :
    /重賞|G1|Ｇ1|GⅠ|ＧⅠ|G2|Ｇ2|GⅡ|ＧⅡ|G3|Ｇ3|GⅢ|ＧⅢ/.test(userText) ? 'grade' :
    /特別/.test(userText) ? 'special_or_above' :
    'grade';

  const { race } = await getTargetRace(userText, preferredMode, userId);

  if (!race) {
    return '対象レースを特定できませんでした。\n先に「今日の重賞」「今週の重賞」「今日の特別以上」などで一覧を出してから、番号かレース名＋予想を送ってください。';
  }

  const detail = await fetchRaceDetail(race);
  const horses = getValidHorses(detail);

  if (!detail.entryConfirmed || horses.length === 0) {
    const msg =
      `■ ${detail.venue}${detail.raceNo}R ${detail.name}\n` +
      `出馬表がまだ確定していません。\n` +
      `馬番が確認できないため、正式な予想はできません。\n` +
      `出馬表確定後にもう一度送ってください。`;

    await saveToSheet({
      type: 'predict_entry_unconfirmed',
      userText,
      aiReply: msg,
      targetDate: getTodayJstText(),
      racecourse: detail.venue,
      raceName: detail.name,
      memo: `entryConfirmed=${detail.entryConfirmed} horseCount=${detail.horseCountParsed || 0}`
    });

    return msg;
  }

  const aiReply = await makeAiPrediction(detail, horses);

  await saveToSheet({
    type: 'prediction',
    userText,
    aiReply,
    targetDate: getTodayJstText(),
    racecourse: detail.venue,
    raceName: detail.name,
    marks: extractMarks(aiReply),
    bets: extractBets(aiReply),
    memo: `raceId=${detail.raceId} horseCount=${horses.length}`
  });

  return aiReply;
}

function isNumericHorseNumber(value) {
  return /^\d{1,2}$/.test(String(value || '').trim());
}

function safeText(value, fallback = '不明') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getValidHorses(detail) {
  return (detail.horses || [])
    .filter(h => h && h.name)
    .map(h => {
      const rawNumber = String(h.number || '').trim();

      return {
        number: isNumericHorseNumber(rawNumber) ? rawNumber : '',
        bracket: safeText(h.bracket),
        name: safeText(h.name, ''),
        ageSex: safeText(h.ageSex),
        weight: safeText(h.weight),
        jockey: safeText(h.jockey),
        trainer: safeText(h.trainer),
        recentStarts: Array.isArray(h.recentStarts) ? h.recentStarts : []
      };
    })
    .filter(h =>
      h.name &&
      isNumericHorseNumber(h.number) &&
      !/^馬名\d+$/.test(h.name) &&
      !/�|���/.test(h.name)
    );
}

function buildHorseListText(horses) {
  return horses.map(h => {
    const recent = h.recentStarts && h.recentStarts.length
      ? h.recentStarts.map(r => JSON.stringify(r)).join(' / ')
      : '不明';

    return (
      `${h.number}番 ${h.name}\n` +
      `枠：${h.bracket}\n` +
      `性齢：${h.ageSex}\n` +
      `斤量：${h.weight}\n` +
      `騎手：${h.jockey}\n` +
      `調教師：${h.trainer}\n` +
      `近走：${recent}`
    );
  }).join('\n\n');
}

async function makeAiPrediction(detail, horses) {
  const horseListText = buildHorseListText(horses);

  const userContent =
    `以下のJRAレースを、うまぴょんAIとして予想してください。\n\n` +
    `【レース情報】\n` +
    `レース名：${detail.name}\n` +
    `競馬場：${detail.venue}\n` +
    `レース番号：${detail.raceNo}R\n` +
    `出走時間：${detail.time || '不明'}\n` +
    `条件：${detail.condition || `${detail.surface || '不明'}${detail.distance || ''}`}\n` +
    `コース：${detail.surface || '不明'} ${detail.distance || ''}\n` +
    `ヘッダー情報：${detail.header || '不明'}\n` +
    `補足情報：${detail.subHeader || '不明'}\n\n` +
    `【出走馬情報】\n` +
    `${horseListText}\n\n` +
    `【厳守】\n` +
    `・uma_prompt.js と uma_knowledge.js のルールに従って予想してください。\n` +
    `・人気とオッズは予想印、採点、着順予想、勝負度、危険馬、消し馬の判断に使わないでください。\n` +
    `・人気とオッズが不明でも、それを理由に予想を止めないでください。\n` +
    `・馬番と馬名を必ず併記してください。\n` +
    `・渡された出走馬情報だけを使い、不明情報は作らないでください。\n` +
    `・単なる馬番順に並べないでください。\n` +
    `・取得できている騎手、斤量、性齢、調教師、条件、コース、Knowledgeを使って評価してください。\n` +
    `・買い目候補は単勝、複勝のみで、500円以内と1000円以内を出してください。\n` +
    `・的中や利益を保証しない文を最後に入れてください。\n\n` +
    `【返答形式】\n` +
    `【うまぴょんAI予想】\n` +
    `レース名：\n` +
    `出走時間：\n` +
    `条件：\n\n` +
    `【最終印】\n` +
    `◎ 馬番 馬名\n` +
    `○ 馬番 馬名\n` +
    `▲ 馬番 馬名\n` +
    `☆ 馬番 馬名\n` +
    `△ 馬番 馬名\n\n` +
    `【5着まで】\n` +
    `1着 馬番 馬名\n` +
    `2着 馬番 馬名\n` +
    `3着 馬番 馬名\n` +
    `4着 馬番 馬名\n` +
    `5着 馬番 馬名\n\n` +
    `【勝負度】\n` +
    `S/A/B+/B/C/D のどれか\n\n` +
    `【予想理由】\n` +
    `2〜4行\n\n` +
    `【買い目候補】\n` +
    `500円以内：\n` +
    `1000円以内：\n\n` +
    `※予想候補です。的中や利益を保証するものではありません。`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.15,
    messages: [
      { role: 'system', content: buildSystemMessage() },
      { role: 'user', content: userContent }
    ]
  });

  return completion.choices?.[0]?.message?.content || 'うまぴょんAIの予想結果が空でした。';
}

async function handleResult(userText, userId = 'default') {
  const preferredMode = /重賞|G1|Ｇ1|GⅠ|ＧⅠ|G2|Ｇ2|GⅡ|ＧⅡ|G3|Ｇ3|GⅢ|ＧⅢ/.test(userText)
    ? 'grade'
    : 'special_or_above';

  const { race } = await getTargetRace(userText, preferredMode, userId);

  if (!race) {
    return '結果確認するレースを特定できませんでした。\nレース名＋結果、または一覧の番号＋結果で送ってください。';
  }

  const result = await fetchResult(race);
  const reply = `■ 結果\n${race.date || ''} ${race.venue}${race.raceNo}R ${race.name}\n${result.rawSummary}`;

  await saveToSheet({
    type: 'result',
    userText,
    aiReply: reply,
    targetDate: getTodayJstText(),
    racecourse: race.venue,
    raceName: race.name,
    result: result.rawSummary,
    memo: `raceId=${race.raceId}`
  });

  return reply;
}

async function handleVerify(userText) {
  const reply =
    `検証は保存済みの予想と結果を照合します。\n` +
    `まず「レース名＋予想」で予想を保存し、その後「レース名＋結果」で結果を保存してください。\n` +
    `保存後に「集計」で成績を確認できます。`;

  await saveToSheet({ type: 'verify_help', userText, aiReply: reply, targetDate: getTodayJstText() });
  return reply;
}

async function handleSummary(userText) {
  const s = await getSheetSummary();
  const reply = s.ok ? s.text : `集計取得失敗：${s.text}`;
  await saveToSheet({ type: 'summary_request', userText, aiReply: reply, targetDate: getTodayJstText() });
  return reply;
}

function buildSystemMessage() {
  return `
${UMA_PROMPT}

【Knowledge】
${UMA_KNOWLEDGE}

【アプリ共通ルール】
あなたは必ず「うまぴょんAI」として返答してください。
「うまデータちゃん」と名乗ってはいけません。
不明情報は作らないでください。
人気とオッズは、予想印、採点、着順予想、勝負度、危険馬、消し馬の判断に使わないでください。
人気とオッズが不明でも、それを理由に予想を止めないでください。
ユーザーは素人なので、専門用語だけで進めず、わかりやすく答えてください。
`;
}

function extractMarks(text) {
  const s = String(text || '');
  const m =
    s.match(/最終印[:：]([^\n]+)/) ||
    s.match(/印[:：]([^\n]+)/) ||
    s.match(/◎[^\n]+/);

  return m ? m[0].trim() : '';
}

function extractBets(text) {
  const s = String(text || '');
  const idx =
    s.indexOf('買い目') >= 0 ? s.indexOf('買い目') :
    s.indexOf('買い候補') >= 0 ? s.indexOf('買い候補') :
    s.indexOf('500円') >= 0 ? s.indexOf('500円') :
    -1;

  return idx >= 0 ? s.slice(idx, idx + 1200) : '';
}

app.listen(PORT, () => {
  console.log(`umapyon-ai listening on ${PORT}`);
});