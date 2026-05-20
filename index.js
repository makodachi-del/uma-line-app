const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');

const UMA_PROMPT_RAW = require('./uma_prompt');
const UMA_KNOWLEDGE_RAW = require('./uma_knowledge');

const app = express();
const PORT = process.env.PORT || 3000;

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function toText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.default === 'string') return value.default;
  if (value && typeof value.prompt === 'string') return value.prompt;
  if (value && typeof value.knowledge === 'string') return value.knowledge;
  return JSON.stringify(value, null, 2);
}

const UMA_PROMPT = toText(UMA_PROMPT_RAW);
const UMA_KNOWLEDGE = toText(UMA_KNOWLEDGE_RAW);

app.get('/', (_, res) => {
  res.status(200).send('umapyon-ai is running');
});

app.get('/health', (_, res) => {
  res.status(200).json({
    ok: true,
    app: 'umapyon-ai',
    now: new Date().toISOString(),
  });
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).end();

  const events = req.body.events || [];

  await Promise.all(
    events.map(async (event) => {
      try {
        await handleEvent(event);
      } catch (error) {
        console.error('handleEvent error:', error);
      }
    })
  );
});

async function handleEvent(event) {
  if (event.type !== 'message') return;
  if (!event.message || event.message.type !== 'text') return;

  const userText = event.message.text.trim();
  const replyToken = event.replyToken;

  let replyText = '';

  try {
    replyText = await handleUserText(userText);
  } catch (error) {
    console.error('handleUserText error:', error);
    replyText =
      'ごめんなさい。うまぴょんAIの中でエラーが出ました。\nRender Logsを確認してください。';
  }

  await replyLine(replyToken, replyText);
}

async function handleUserText(userText) {
  if (userText === 'テスト') {
    return 'うまぴょんAIです。接続OKです。';
  }

  const systemMessage = `
${UMA_PROMPT}

【Knowledge】
${UMA_KNOWLEDGE}

【現在の重要ルール】
あなたは必ず「うまぴょんAI」として返答してください。
「うまデータちゃん」と名乗ってはいけません。
ユーザーは素人なので、専門用語だけで説明せず、わかりやすく答えてください。
まだレース取得機能は接続していないため、実レースの一覧取得や予想が必要な場合は、その旨を正直に伝えてください。
`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: systemMessage,
      },
      {
        role: 'user',
        content: userText,
      },
    ],
  });

  return completion.choices?.[0]?.message?.content || 'うまぴょんAIの返事が空でした。';
}

async function replyLine(replyToken, text) {
  const messages = splitForLine(text).map((t) => ({
    type: 'text',
    text: cleanLineText(t),
  }));

  await lineClient.replyMessage({
    replyToken,
    messages,
  });
}

function cleanLineText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, 4900);
}

function splitForLine(text) {
  const clean = String(text || '').trim();

  if (!clean) return ['うまぴょんAIの返事が空でした。'];

  const chunks = [];
  let rest = clean;

  while (rest.length > 0 && chunks.length < 5) {
    chunks.push(rest.slice(0, 4900));
    rest = rest.slice(4900);
  }

  return chunks;
}

app.listen(PORT, () => {
  console.log(`umapyon-ai listening on ${PORT}`);
});