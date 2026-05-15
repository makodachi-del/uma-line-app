const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const UMA_PROMPT = require('./uma_prompt');
const UMA_KNOWLEDGE = require('./uma_knowledge');
const { modeFromText, filterRacesByMode } = require('./race_rules');
const { fetchRaceList, fetchRaceDetail, fetchResult, findRaceByUserText } = require('./race_fetcher');
const { formatRaceList, selectTargetRaces } = require('./race_classifier');
const { saveToSheet, getSheetSummary } = require('./sheet_api');
const { getTodayJstText, getNowJstIsoText, isTueToFriNoJraDay, hasTodayHorseWords, splitForLine, cleanLineReply } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new line.messagingApi.MessagingApiClient({ channelAccessToken: lineConfig.channelAccessToken });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get('/', (_, res) => res.status(200).send('uma-line-app is running'));
app.get('/health', (_, res) => res.status(200).json({ ok: true, now: getNowJstIsoText() }));
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).end();
  const events = req.body.events || [];
  await Promise.all(events.map(handleEvent));
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userText = event.message.text.trim();
  let reply = '';
  try {
    reply = await handleUserText(userText);
  } catch (e) {
    console.error(e);
    reply = `エラーが出ました。\n${e.message}\nRender Logsを確認してください。`;
  }
  await replyLine(event.replyToken, reply);
}

async function replyLine(replyToken, text) {
  const messages = splitForLine(text).map(t => ({ type: 'text', text: cleanLineReply(t) }));
  await lineClient.replyMessage({ replyToken, messages });
}

async function handleUserText(userText) {
  if (/^テスト$/.test(userText)) {
    await saveToSheet({ type:'test', userText, aiReply:'テストOK', targetDate:getTodayJstText() });
    return 'うまデータちゃんです。接続OKです。';
  }
  if (/^保存テスト$/.test(userText)) {
    const r = await saveToSheet({ type:'save_test', userText, aiReply:'保存テストOK', targetDate:getTodayJstText() });
    return r.ok ? '保存テストOKです。スプレッドシートを確認してください。' : `保存失敗：${r.error || r.text}`;
  }

  const mode = modeFromText(userText);

  if (isTueToFriNoJraDay() && hasTodayHorseWords(userText) && !/結果|検証|集計|過去/.test(userText)) {
    const fixed = `今日は${getTodayJstText()}です。\n通常、火〜金はJRA開催日ではないため、今日のJRA対象レースはありません。\n土日開催や祝日開催は「今週の重賞」「今週の特別以上」で確認してください。`;
    await saveToSheet({ type:'no_jra_fixed', userText, aiReply:fixed, targetDate:getTodayJstText() });
    return fixed;
  }

  if (mode === 'summary') return await handleSummary(userText);
  if (mode === 'verify') return await handleVerify(userText);
  if (['grade','special_or_above','special','maiden'].includes(mode) && !/予想|結果/.test(userText)) {
    return await handleList(userText, mode);
  }
  if (mode === 'result') return await handleResult(userText);
  if (mode === 'predict' || /^\d{1,2}$/.test(userText)) return await handlePrediction(userText);

  return '送れる言葉：\nテスト\n今日の重賞\n今週の重賞\n今日の特別以上\n今日の特別\n今日の未勝利\nレース名＋予想\nレース名＋結果\n検証\n集計';
}

async function handleList(userText, mode) {
  const races = await fetchRaceList();
  const targets = selectTargetRaces(races, mode);
  const reply = formatRaceList(targets, mode);
  await saveToSheet({ type:`list_${mode}`, userText, aiReply:reply, targetDate:getTodayJstText(), memo:`取得${races.length}件 / 対象${targets.length}件` });
  return reply;
}

async function getTargetRace(userText, preferredMode='special_or_above') {
  const races = filterRacesByMode(await fetchRaceList(), preferredMode);
  let race = await findRaceByUserText(userText.replace(/予想|結果/g,''), races);
  if (!race) {
    const all = await fetchRaceList();
    race = await findRaceByUserText(userText.replace(/予想|結果/g,''), all);
  }
  return { race, races };
}

async function handlePrediction(userText) {
  const preferredMode = /未勝利/.test(userText) ? 'maiden' : /重賞/.test(userText) ? 'grade' : /特別/.test(userText) ? 'special_or_above' : 'special_or_above';
  const { race } = await getTargetRace(userText, preferredMode);
  if (!race) {
    return '対象レースを特定できませんでした。先に「今日の重賞」「今日の特別以上」などで一覧を出してから、番号かレース名＋予想を送ってください。';
  }
  const detail = await fetchRaceDetail(race);
  if (!detail.hasEnoughForm) {
    const msg = `■ ${detail.venue}${detail.raceNo}R ${detail.name}\n本格予想不可です。\n理由：馬柱または近走3走以上を確認できる馬が不足しています。\n取得馬数：${detail.horseCountParsed}\n近走3走以上確認：${detail.enoughHorseCount}\n不明情報は作らないため、予想は出しません。`;
    await saveToSheet({ type:'predict_unavailable', userText, aiReply:msg, targetDate:getTodayJstText(), racecourse:detail.venue, raceName:detail.name, memo:'馬柱不足' });
    return msg;
  }
  const aiReply = await generatePrediction(detail);
  await saveToSheet({ type:'prediction', userText, aiReply, targetDate:getTodayJstText(), racecourse:detail.venue, raceName:detail.name, marks:extractMarks(aiReply), bets:extractBets(aiReply), memo:`raceId=${detail.raceId}` });
  return aiReply;
}

async function generatePrediction(detail) {
  const compactHorses = detail.horses.map(h => ({
    number:h.number, name:h.name, bracket:h.bracket, ageSex:h.ageSex, weight:h.weight,
    jockey:h.jockey, trainer:h.trainer, recentStarts:h.recentStarts.slice(0,5)
  }));
  const system = `${UMA_PROMPT}\n\n【Knowledge】\n${UMA_KNOWLEDGE}`;
  const user = `現在日付：${getTodayJstText()}\n以下の取得済みデータだけで、うまデータちゃんとして予想してください。人気・オッズ・結果・払戻は印に使わない。\n\nレース情報：${JSON.stringify({raceId:detail.raceId, date:detail.date, venue:detail.venue, raceNo:detail.raceNo, name:detail.name, time:detail.time, surface:detail.surface, distance:detail.distance, condition:detail.condition, runners:detail.runners, header:detail.header}, null, 2)}\n\n展開情報：${detail.paceText}\n\n出走馬・近走：${JSON.stringify(compactHorses, null, 2)}\n\n出力は必ず当日予想モード固定形式。オッズは取得していないので「オッズ不明」。買い目は単勝、複勝、ワイド、三連複のみ。500円以内と1000円以内を出す。`;
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role:'system', content: system },
      { role:'user', content: user }
    ]
  });
  return completion.choices?.[0]?.message?.content || 'AI返信が空でした。';
}

async function handleResult(userText) {
  const { race } = await getTargetRace(userText, /重賞/.test(userText) ? 'grade' : 'special_or_above');
  if (!race) return '結果確認するレースを特定できませんでした。レース名＋結果で送ってください。';
  const result = await fetchResult(race);
  const reply = `■ 結果\n${race.venue}${race.raceNo}R ${race.name}\n${result.rawSummary}`;
  await saveToSheet({ type:'result', userText, aiReply:reply, targetDate:getTodayJstText(), racecourse:race.venue, raceName:race.name, result:result.rawSummary });
  return reply;
}

async function handleVerify(userText) {
  const reply = '検証は保存済みの予想と結果を照合します。\nまず「レース名＋予想」で予想保存、その後「レース名＋結果」で結果保存してください。\n保存後に「集計」で成績を確認できます。';
  await saveToSheet({ type:'verify_help', userText, aiReply:reply, targetDate:getTodayJstText() });
  return reply;
}

async function handleSummary(userText) {
  const s = await getSheetSummary();
  const reply = s.ok ? s.text : `集計取得失敗：${s.text}`;
  await saveToSheet({ type:'summary_request', userText, aiReply:reply, targetDate:getTodayJstText() });
  return reply;
}

function extractMarks(text) {
  const m = String(text || '').match(/G最終印：([^\n]+)/);
  return m ? m[1] : '';
}
function extractBets(text) {
  const idx = String(text || '').indexOf('■ 買い対象');
  return idx >= 0 ? String(text).slice(idx, idx + 1000) : '';
}

app.listen(PORT, () => console.log(`uma-line-app listening on ${PORT}`));
