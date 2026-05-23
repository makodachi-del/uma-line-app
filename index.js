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

  const aiReplyRaw = await makeAiPrediction(detail, horses);
  const aiReply = normalizePredictionReply(aiReplyRaw);

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

function countRecentReadyHorses(horses) {
  return horses.filter(h => Array.isArray(h.recentStarts) && h.recentStarts.length > 0).length;
}

function buildRecentText(horse) {
  if (!horse.recentStarts || horse.recentStarts.length === 0) {
    return '不明';
  }

  return horse.recentStarts.slice(0, 5).map(r => {
    return [
      r.date || '日付不明',
      r.raceName || 'レース名不明',
      `着順:${r.rank || '不明'}`,
      `距離:${r.course || '不明'}`,
      `馬場:${r.going || '不明'}`,
      `上り:${r.last3f || '不明'}`,
      `通過:${r.passing || '不明'}`,
      `着差:${r.margin || '不明'}`
    ].join(' / ');
  }).join('\n');
}

function buildHorseListText(horses) {
  return horses.map(h => {
    return (
      `${h.number} ${h.name}\n` +
      `枠：${h.bracket}\n` +
      `性齢：${h.ageSex}\n` +
      `斤量：${h.weight}\n` +
      `騎手：${h.jockey}\n` +
      `調教師：${h.trainer}\n` +
      `近走：\n${buildRecentText(h)}`
    );
  }).join('\n\n');
}

function normalizeWideLineSeparators(text) {
  return String(text || '')
    .split('\n')
    .map(line => {
      if (!/ワイド/.test(line)) return line;

      const moneyMatch = line.match(/(\d{2,5})\s*円/);
      const money = moneyMatch ? moneyMatch[1] : '';

      const nums = line.match(/\d{1,2}/g) || [];
      if (nums.length >= 2) {
        const amountText = money ? ` ${money}円` : '';
        return line.replace(/ワイド.*$/g, `ワイド ${nums[0]} － ${nums[1]}${amountText}`);
      }

      return line
        .replace(/(\d{1,2})\s*[-‐-‒–—―−ーｰ－]\s*(\d{1,2})/g, '$1 － $2')
        .replace(/(\d{1,2})\s+－\s+(\d{1,2})/g, '$1 － $2');
    })
    .join('\n');
}

function normalizePredictionReply(text) {
  let s = String(text || '');

  s = s.replace(/(\d{1,2})番/g, '$1');
  s = s.replace(/【買い目候補】/g, '【買い目の候補だよ】');
  s = s.replace(/【短い理由】/g, '【予想理由】');

  s = normalizeWideLineSeparators(s);

  s = s.replace(/勝負度：S(?!（)/g, '勝負度：S（かなり自信ありだよ）');
  s = s.replace(/勝負度：A(?!（)/g, '勝負度：A（しっかり狙えそうだよ）');
  s = s.replace(/勝負度：B\+(?!（)/g, '勝負度：B+（楽しみだけど少し注意だよ）');
  s = s.replace(/勝負度：B(?![+（])/g, '勝負度：B（標準くらいだよ）');
  s = s.replace(/勝負度：C(?!（)/g, '勝負度：C（混戦で注意だよ）');
  s = s.replace(/勝負度：D(?!（)/g, '勝負度：D（見送り寄りだよ）');

  return s;
}

async function makeAiPrediction(detail, horses) {
  const horseListText = buildHorseListText(horses);
  const recentReadyCount = countRecentReadyHorses(horses);

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
    `補足情報：${detail.subHeader || '不明'}\n` +
    `近走確認：${horses.length}頭中${recentReadyCount}頭\n\n` +
    `【出走馬情報】\n` +
    `${horseListText}\n\n` +
    `【厳守】\n` +
    `・uma_prompt.js と uma_knowledge.js のルールに従って予想してください。\n` +
    `・保育士さんがやさしく話すような、あたたかい口調にしてください。\n` +
    `・ただし予想は真剣に行い、ふざけすぎないでください。\n` +
    `・人気とオッズは予想印、採点、着順予想、勝負度、危険馬、消し馬の判断に使わないでください。\n` +
    `・人気とオッズが不明でも、それを理由に予想を止めないでください。\n` +
    `・予想印と5着までの馬番は「12番」ではなく「12」のように数字だけで表示してください。\n` +
    `・買い目も「12番」ではなく「12」、「12番-3番」ではなく「12 － 3」と空白ありの全角ハイフンで表示してください。\n` +
    `・馬番と馬名を必ず併記してください。\n` +
    `・渡された出走馬情報だけを使い、不明情報は作らないでください。\n` +
    `・単なる馬番順に並べないでください。\n` +
    `・取得できている近走、騎手、斤量、性齢、調教師、条件、コース、Knowledgeを使って評価してください。\n` +
    `・近走が取得できている場合は、予想理由に自然に反映してください。\n` +
    `・近走が取得できていない場合は、作らずに「近走は不明」と扱ってください。\n` +
    `・勝負度は「B（標準くらいだよ）」のように短い補足を付けてください。\n` +
    `・買い目候補の見出しは「買い目の候補だよ」にしてください。\n` +
    `・買い目候補は単勝、複勝、ワイドのみで出してください。\n` +
    `・単勝だけにしないでください。\n` +
    `・500円以内プランは、買い目すべての合計金額を必ず500円以内にしてください。\n` +
    `・1000円以内プランは、買い目すべての合計金額を必ず1000円以内にしてください。\n` +
    `・各買い目の金額は100円単位にしてください。\n` +
    `・500円以内プランと1000円以内プランは、同じ内容の丸写しにしないでください。\n` +
    `・ワイドは「馬番 － 馬番」の空白あり全角ハイフンで表示してください。\n` +
    `・合計金額は「合計：500円」「合計：800円」のように実額で表示してください。\n` +
    `・的中や利益を保証しない文を最後に入れてください。\n\n` +
    `【返答形式】\n` +
    `【うまぴょんAI予想】\n` +
    `レース名：\n` +
    `出走時間：\n` +
    `条件：\n` +
    `近走確認：${horses.length}頭中${recentReadyCount}頭\n\n` +
    `【最終印】\n` +
    `◎ 数字 馬名\n` +
    `○ 数字 馬名\n` +
    `▲ 数字 馬名\n` +
    `☆ 数字 馬名\n` +
    `△ 数字 馬名\n\n` +
    `【5着まで】\n` +
    `1着 数字 馬名\n` +
    `2着 数字 馬名\n` +
    `3着 数字 馬名\n` +
    `4着 数字 馬名\n` +
    `5着 数字 馬名\n\n` +
    `【勝負度】\n` +
    `S/A/B+/B/C/D のどれか＋短い補足\n\n` +
    `【予想理由】\n` +
    `2〜4行。保育士さん風にやさしく。\n\n` +
    `【買い目の候補だよ】\n` +
    `500円以内：\n` +
    `・単勝 数字 金額\n` +
    `・複勝 数字 金額\n` +
    `・ワイド 数字 － 数字 金額\n` +
    `合計：実額\n\n` +
    `1000円以内：\n` +
    `・単勝 数字 金額\n` +
    `・複勝 数字 金額\n` +
    `・ワイド 数字 － 数字 金額\n` +
    `合計：実額\n\n` +
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
予想印、5着まで、買い目では「番」を付けず、数字だけで表示してください。
ワイドは「11 － 14」のように空白あり全角ハイフンで表示してください。
買い目候補は、各プランの合計金額を必ず上限以内にしてください。
返答は保育士さんがやさしく説明するような口調にしてください。
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