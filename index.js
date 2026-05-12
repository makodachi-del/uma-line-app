const express = require("express");
const line = require("@line/bot-sdk");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(lineConfig);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PORT = process.env.PORT || 3000;

// ==============================
// txtファイル読み込み
// ==============================
function readTextFile(fileName) {
  try {
    const filePath = path.join(__dirname, fileName);
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`${fileName} read error:`, error.message);
    return "";
  }
}

const UMADATA_PROMPT_FILE = readTextFile("umadata_prompt.txt");
const UMADATA_KNOWLEDGE_FILE = readTextFile("umadata_knowledge_jra_logic.txt");

// ==============================
// LINE版の最優先安全ルール
// ==============================
const LINE_SAFE_RULES = `
あなたはLINE競馬AI「うまデータちゃん」です。

【LINE版 最優先ルール】
このLINE版では、現時点でJRA公式サイト、開催日程、重賞一覧、出馬表、馬柱、人気、オッズ、結果を自動取得できません。
添付Knowledgeやプロンプトは判断ルールとして使いますが、外部サイトの最新情報を自動確認できるわけではありません。

以下を必ず守ってください。

1. 未確認情報の断定禁止
・今日、明日、今週、来週の開催や重賞を確認していない場合、開催されるとは言ってはいけません。
・「今日は重賞があります」「本日開催されます」「出走馬は〇〇です」など、確認済みのような表現は禁止です。
・確認していないレース名、開催日、出走馬、馬番、枠順、騎手、人気、オッズ、馬場、結果を作ってはいけません。

2. 馬柱未確認時の対応
・馬柱、出馬表、枠順、馬番、騎手、斤量、調教師、近走3〜5走がない場合、本格予想はしません。
・ユーザーに「JRAの出馬表・馬柱・出走馬情報を貼ってください」と案内します。
・情報不足のまま、印、予想着順、買い目を作ってはいけません。

3. 「今日の重賞」「今週の重賞」「明日の重賞」と聞かれた時
・現在のLINE版ではJRA開催日・重賞日程の自動取得は未実装です、と伝えます。
・正確に答えるには、JRAの開催情報・重賞一覧・出馬表を貼ってください、と案内します。
・開催有無を断定しません。

4. 添付プロンプトとKnowledgeの扱い
・下にある「うまデータちゃんプロンプト」と「Knowledge」は必ず参照します。
・ただし、LINE版最優先ルールと矛盾する場合は、LINE版最優先ルールを優先します。
・特に、馬柱未確認なのに予想することは禁止です。

5. 買い目について
・買い目は、必要情報が揃って予想できる場合だけ表示します。
・券種は単勝、複勝、ワイド、三連複のみです。
・馬連、枠連、馬単、三連単は出しません。
・的中や利益は保証しません。
・無理な購入はすすめません。

6. 返答
・日本語で返します。
・LINEなので、長すぎず分かりやすく返します。
・不明なことは「不明」と書きます。
`;

// ==============================
// system prompt 組み立て
// ==============================
function buildSystemPrompt() {
  return `
${LINE_SAFE_RULES}

==============================
【うまデータちゃんプロンプト】
==============================
${UMADATA_PROMPT_FILE || "umadata_prompt.txt が読み込めていません。"}

==============================
【うまデータちゃんKnowledge】
==============================
${UMADATA_KNOWLEDGE_FILE || "umadata_knowledge_jra_logic.txt が読み込めていません。"}
`;
}

// ==============================
// 固定返信
// ==============================
function getFixedReply(userText) {
  const text = userText.trim();

  if (
    text === "テスト" ||
    text.toLowerCase() === "test" ||
    text === "接続確認"
  ) {
    return "うまデータちゃん起動中です🐴\nLINEとRenderの接続は成功しています。";
  }

  if (
    text === "使い方" ||
    text === "ヘルプ" ||
    text.toLowerCase() === "help"
  ) {
    return [
      "うまデータちゃんです🐴",
      "",
      "今できること：",
      "・「テスト」→ 接続確認",
      "・「今日の重賞」→ 自動取得未実装の案内",
      "・「予想」→ 馬柱が必要なことを案内",
      "・馬柱や出馬表を貼る → その情報をもとに予想補助",
      "",
      "※現在はまだJRA馬柱・重賞日程の自動取得は未実装です。"
    ].join("\n");
  }

  return null;
}

// ==============================
// OpenAI APIを使う言葉だけ判定
// ==============================
function shouldUseOpenAI(userText) {
  const text = userText.trim();

  const triggerWords = [
    "今日の重賞",
    "今週の重賞",
    "来週の重賞",
    "明日の重賞",
    "重賞",
    "予想",
    "競馬予想",
    "うまデータ",
    "馬柱",
    "出馬表",
    "出走表",
    "出走馬",
    "印",
    "買い目",
    "検証",
    "集計",
    "結果",
    "回顧",
    "レース"
  ];

  return triggerWords.some((word) => text.includes(word));
}

// ==============================
// 関係ない言葉への固定返信
// ==============================
function getNotTargetReply() {
  return [
    "うまデータちゃんです🐴",
    "競馬の予想や重賞について聞きたい時は、",
    "「今日の重賞」",
    "「予想」",
    "「使い方」",
    "のように送ってください。"
  ].join("\n");
}

// ==============================
// OpenAI API呼び出し
// ==============================
async function callUmaDataChan(userText) {
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: userText,
      },
    ],
    temperature: 0.1,
    max_tokens: 1200,
  });

  return completion.choices[0].message.content;
}

// ==============================
// Webhook
// ==============================
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).end();
  }
});

// ==============================
// LINEイベント処理
// ==============================
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userText = event.message.text || "";

  const fixedReply = getFixedReply(userText);
  if (fixedReply) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: fixedReply,
    });
  }

  if (!shouldUseOpenAI(userText)) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: getNotTargetReply(),
    });
  }

  try {
    const aiReply = await callUmaDataChan(userText);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: aiReply,
    });
  } catch (err) {
    console.error("OpenAI API error:", {
      message: err.message,
      code: err.code,
      type: err.type,
      status: err.status,
    });

    let errorMessage = [
      "うまデータちゃんのAI返信でエラーが出ています🐴",
      "",
      "OpenAI APIの課金・残高・利用上限を確認してください。",
      "",
      "ChatGPT Plusとは別に、OpenAI Platform APIの課金設定が必要です。"
    ].join("\n");

    if (err.code === "insufficient_quota") {
      errorMessage = [
        "OpenAI APIの利用枠が足りません🐴",
        "",
        "確認すること：",
        "・OpenAI Platformの残高",
        "・課金設定",
        "・利用上限",
        "・Auto rechargeがOFFかどうか",
        "",
        "※LINEとRenderの接続は成功しています。"
      ].join("\n");
    }

    if (err.code === "invalid_api_key") {
      errorMessage = [
        "OpenAI APIキーが正しくありません🐴",
        "",
        "RenderのEnvironment Variablesで",
        "OPENAI_API_KEY のValueを確認してください。",
        "",
        "※LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN は触らなくて大丈夫です。"
      ].join("\n");
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: errorMessage,
    });
  }
}

// ==============================
// 起動確認用
// ==============================
app.get("/", (req, res) => {
  res.send("uma-line-app is running 🐴");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});