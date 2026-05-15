const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const { UMA_PROMPT } = require('./uma_prompt');
const { UMA_KNOWLEDGE } = require('./uma_knowledge');
const { getRequestMode } = require('./race_rules');
const { fetchRaceList, fetchRaceDetail } = require('./race_fetcher');
const { classifyRaces, formatRaceList } = require('./race_classifier');
const { saveToSheet, buildSheetPayload } = require('./sheet_api');
const { cleanLineReply, getTodayJstDateKey, getTodayJstText, getNowJstIsoText, getNoJraTodayReplyIfNeeded, splitNumbers } = require('./utils');

const app = express();
const port = process.env.PORT || 3000;

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const client = new line.Client(lineConfig);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const userState = new Map();

app.get('/', (_, res) => res.status(200).send('uma-line-app is running'));
app.get('/health', (_, res) => res.status(200).json({ ok: true, now: getNowJstIsoText() }));
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).end();
  const events = req.body.events || [];
  await Promise.all(events.map(handleEvent));
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userId = event.source?.userId || 'unknown';
  const userText = event.message.text.trim();
  let reply = '';
  let type = '';
  let raceForSave = null;

  try {
    if (/^テスト$/.test(userText)) {
      reply = 'うまデータちゃん起動OKです。LINE、Render、OpenAI、スプレッドシート保存まで使えます。';
      type = 'test';
      await replyAndSave(event.replyToken, userText, reply, type, raceForSave);
      return;
    }

    const noJra = getNoJraTodayReplyIfNeeded(userText);
    if (noJra) {
      reply = noJra;
      type = 'no_jra_today';
      await replyAndSave(event.replyToken, userText, reply, type, raceForSave);
      return;
    }

    const state = userState.get(userId);
    const nums = splitNumbers(userText);
    if (state?.races?.length && nums.length) {
      const selected = nums.map((n) => state.races.find((r) => r.no === n)).filter(Boolean);
      if (!selected.length) {
        reply = '番号が見つかりませんでした。表示されたNoから選んでください。';
        await client.replyMessage(event.replyToken, { type: 'text', text: cleanLineReply(reply) });
        return;
      }
      const results = [];
      for (const r of selected.slice(0, 3)) {
        const detail = await fetchRaceDetail(r);
        raceForSave = detail;
        const ai = await makePrediction(userText, detail, state.mode);
        results.push(ai);
        await saveToSheet(buildSheetPayload({ type: 'prediction', userText, aiReply: ai, race: detail }));
      }
      reply = results.join('\n\n---\n\n');
      await client.replyMessage(event.replyToken, { type: 'text', text: cleanLineReply(reply) });
      return;
    }

    const mode = getRequestMode(userText);
    type = mode;

    if (['grade', 'special_plus', 'special', 'maiden'].includes(mode)) {
      const dateKey = getTodayJstDateKey();
      const { races, sourceUrl, errors } = await fetchRaceList(dateKey);
      let targets = classifyRaces(races, mode);
      const checked = [];
      for (const r of targets.slice(0, 30)) checked.push(await fetchRaceDetail(r));
      targets = checked.map((r, i) => ({ ...r, no: i + 1 }));
      userState.set(userId, { mode, races: targets, sourceUrl, createdAt: Date.now() });
      reply = formatRaceList(targets, mode);
      if (!targets.length && errors?.length) reply += `\n取得メモ：${errors[0]}`;
      await replyAndSave(event.replyToken, userText, reply, type, null);
      return;
    }

    if (['result', 'verify', 'aggregate', 'summary'].includes(mode)) {
      reply = await askAI({ userText, mode, race: null, extra: 'スプレッドシートに保存済みの履歴を前提に、未取得の結果は不明として扱う。現時点ではSheets読取API未使用のため、ユーザー入力範囲だけで回答する。' });
      await replyAndSave(event.replyToken, userText, reply, type, null);
      return;
    }

    reply = await askAI({ userText, mode, race: null, extra: '通常会話。対象外なら、何を送ればよいか短く案内する。' });
    await replyAndSave(event.replyToken, userText, reply, type, null);
  } catch (e) {
    reply = `エラーが出ました。\n${e.message}\n\nRender Logsで詳細を確認してください。`;
    await client.replyMessage(event.replyToken, { type: 'text', text: cleanLineReply(reply) });
  }
}

async function replyAndSave(replyToken, userText, reply, type, race) {
  const text = cleanLineReply(reply);
  await client.replyMessage(replyToken, { type: 'text', text });
  await saveToSheet(buildSheetPayload({ type, userText, aiReply: text, race }));
}

async function makePrediction(userText, race, mode) {
  if (race.cardStatus !== '確認済み' || !race.horses?.length) {
    return `■ レース\n${race.course}${race.raceNo} ${race.name}\n\n馬柱：未確認\n本格予想不可です。馬柱・出走馬・騎手などが確認できません。`;
  }
  return await askAI({ userText, mode: 'predict', race, extra: 'コード側で取得したこのレースだけを予想する。結果は確認しない。人気・オッズは印・勝負度に使わない。' });
}

async function askAI({ userText, mode, race, extra }) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const raceJson = race ? JSON.stringify(race, null, 2).slice(0, 20000) : 'なし';
  const messages = [
    { role: 'system', content: `${UMA_PROMPT}\n\n${UMA_KNOWLEDGE}` },
    { role: 'user', content: `今日: ${getTodayJstText()}\n現在: ${getNowJstIsoText()}\nモード: ${mode}\nユーザー入力: ${userText}\n補足: ${extra || ''}\nコード取得レース情報:\n${raceJson}` }
  ];
  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.2
  });
  return cleanLineReply(completion.choices?.[0]?.message?.content || '回答を生成できませんでした。');
}

app.listen(port, () => console.log(`uma-line-app listening on ${port}`));
