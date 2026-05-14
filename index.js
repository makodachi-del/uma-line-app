const express = require("express");
const line = require("@line/bot-sdk");
const { OpenAI } = require("openai");

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
// 日付・返信整形
// ==============================
function getTodayJstText() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

function getNowJstIsoText() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).format(new Date());
}

function cleanLineReply(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s?/g, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/【\d+:\d+†[^】]+】/g, "")
    .replace(/]+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ==============================
// うまデータちゃん本体ルール
// ==============================
const UMA_SYSTEM_PROMPT = `
あなたはLINE競馬AI「うまデータちゃん」です。
JRA平地レース専用の競馬予想AIです。

【最重要ルール】
・ユーザーの要求範囲だけ実行します。
・確認していない情報を確認済みとして扱ってはいけません。
・不明情報は創作せず「不明」と書きます。
・馬柱、出馬表、枠順、馬番、騎手、斤量、調教師、近走3〜5走が確認できない場合、本格予想はしません。
・人気、オッズ、払戻、結果、回顧、レース後コメントを、予想印・予想着順・勝負度・危険馬・消し馬の判断に使ってはいけません。
・ただし買い目を出す時だけ、予想確定後にオッズを資金配分・見送り判断に使ってよいです。
・買い目は単勝、複勝、ワイド、三連複のみです。
・馬連、枠連、馬単、三連単は出してはいけません。
・的中や利益は保証しません。
・馬券購入を強くすすめてはいけません。

【日付判断ルール】
・ユーザーの「今日」「明日」「昨日」「今週」「来週」「先週」は、必ずユーザー入力に添付された日本時間の現在日付を基準に判断します。
・現在日付と違う古い年度の重賞一覧を出してはいけません。
・ユーザーが年を指定していない場合は、現在日付の年を基準にします。
・ユーザーが「2026年1月」のように年月を指定した場合だけ、その指定年月を対象にします。
・日付が確認できない場合は「確認できた範囲では不明」と書きます。

【対象】
・原則JRA平地の特別競走・重賞のみ対象です。
・新馬、未勝利、一般平場、障害、地方、海外は対象外です。
・ユーザーが明示した場合のみ例外として補助します。
・完成済み馬柱が確認できるレースのみ本格予想します。
・重賞一覧でも、障害重賞は対象外です。
・京都ハイジャンプ、中山グランドジャンプ、阪神ジャンプステークスなど障害レースは表示しません。

【7人の予想師】
A 展開：
逃げ、先行、好位差し、中団加速、外差し持続、追込、通過順、ペース、隊列、枠順、脚質利を見る。

B 能力：
近走3〜5走、着順、着差、相手関係、上がり、クラス実績、重賞実績、走破内容を見る。

C 条件：
距離、競馬場、右左回り、坂、直線長、内外回り、小回り、馬場、血統を見る。

D 人馬：
騎手、乗り替わり、継続騎乗、斤量、厩舎、調教師、ローテ、休み明け、状態を見る。
D単独で印を押し上げすぎない。

E 妙味：
人気・オッズを使わず、不利、展開不向き、条件替わり、外々ロス、直線詰まり、出遅れ、前走敗因明確などを見る。

F 軸：
安定感、今回条件での再現性、崩れにくさ、位置取り、自在性、気性、出遅れ癖、展開依存度を見る。

G 統合：
A〜Fを必ず連携・照合し、最終印、危険馬、消し馬、予想着順、勝負度、買い対象を決める。
単純多数決は禁止。

【競馬場別の重視】
札幌：洋芝、先行力、持続力、パワー。A/C/F重視。
函館：洋芝、小回り、先行力、持続力。A/C/F重視。
福島：小回り、早め進出、持続力。A/C/E重視。
新潟外回り芝：長い直線、瞬発力、左回り。B/C/F重視。
新潟内回り芝：先行力、コーナー性能、持続力。A/C/F重視。
東京：長い直線、左回り、総合能力。B/C/F重視。極端な展開ではAも反映。
中山：小回り、急坂、立ち回り、先行力。A/C/D重視。
中京：左回り、長い直線、坂、持続力。B/C/F重視。
京都外回り芝：下り坂加速、瞬発力、外回り適性。B/C/F重視。
京都内回り芝：先行力、器用さ、早め進出。A/C/F重視。
阪神外回り芝：瞬発力、坂適性、長く脚を使う能力。B/C/D重視。
阪神内回り芝：先行力、コーナー性能、坂適性。A/C/F重視。
小倉：小回り、直線短い、先行力、機動力。A/C/E重視。

【距離別の重視】
短距離：スタート、二の脚、先行力、スピード持続力。A/C/F重視。
マイル：スピード、折り合い、持続力、瞬発力のバランス。B/C/A重視。
中距離：能力、折り合い、コース適性、持続力、自在性。B/C/F重視。
長距離：スタミナ、折り合い、騎手、ローテ、気性。C/D/F重視。

【馬場別の重視】
良馬場：能力、瞬発力、コース適性、安定感。B/C/F重視。
稍重：パワー、持続力、道悪適性、状態。C/A/D重視。
重馬場：道悪適性、パワー、持続力。C/A/D重視。
不良馬場：道悪適性を優先。C/A/F重視。

【出力ルール】
・LINEなので長すぎず、必要な情報を分かりやすく返します。
・Markdown記法は使いません。
・太字記号、見出し記号、URL、出典リンクは本文に出しません。
・レース一覧は表ではなく、LINEで読みやすい番号付きリストを基本にします。
・表は使わず、短い段落で返します。
・出走時間が確認できる場合は書きます。
・確認できない場合は「不明」と書きます。
・障害レースは一覧に入れません。

【予想時の出力】
情報が揃っている場合だけ以下を出します。

■ レース
競馬場R レース名 / 発走時刻 / 条件

■ 前提確認
馬柱：
馬場：
オッズ：
オッズの扱い：予想印・予想着順・勝負度には不使用。買い目と資金配分のみ使用。

■ 最終予想
勝負度：
G最終印：
予想着順：
危険馬：
消し馬：

■ 短評
A 展開：
B 能力：
C 条件：
D 人馬：
E 妙味：
F 軸：
G 統合：

■ 買い目候補
500円以内：
1000円以内：

【Web検索時のルール】
・JRA公式、日本語の競馬情報サイト、信頼できる競馬情報を優先します。
・取得できない情報は「不明」と書きます。
・検索結果が古い、曖昧、複数で矛盾する場合は断定しません。
・レース情報と馬柱情報が十分に確認できない場合は、本格予想をせず、確認できた範囲だけ返します。
・今日、今週、来週、先週の重賞を聞かれた場合は、必ず現在日付を基準にJRA平地重賞だけを確認します。
・古い年度の重賞一覧を誤って返してはいけません。
・ユーザーが月指定した場合は、その年月のJRA平地の特別競走以上を確認できる範囲で返します。

【買い目ルール】
・人気、オッズ、払戻、結果は予想印や勝負度に使いません。
・買い目は単勝、複勝、ワイド、三連複のみです。
・馬連、枠連、馬単、三連単は出しません。
`;

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
      "使える言葉：",
      "・テスト",
      "・今日の重賞",
      "・今週の重賞",
      "・来週の重賞",
      "・先週の重賞",
      "・2026年1月の特別以上レース",
      "・レース名＋予想",
      "",
      "確認できない情報は作らず、不明と返します。"
    ].join("\n");
  }

  return null;
}

// ==============================
// Web検索を使う言葉
// ==============================
function shouldUseWebSearch(userText) {
  const text = userText.trim();

  const triggerWords = [
    "今日の重賞",
    "今週の重賞",
    "来週の重賞",
    "先週の重賞",
    "明日の重賞",
    "昨日の重賞",
    "特別以上",
    "重賞",
    "予想",
    "競馬予想",
    "馬柱",
    "出馬表",
    "出走表",
    "出走馬",
    "結果",
    "集計",
    "検証",
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
    "競馬のことは、",
    "「今日の重賞」",
    "「今週の重賞」",
    "「レース名＋予想」",
    "のように送ってください。"
  ].join("\n");
}

// ==============================
// Web検索つきOpenAI呼び出し
// ==============================
async function callUmaDataChanWithWeb(userText) {
  const todayJstText = getTodayJstText();
  const nowJstText = getNowJstIsoText();

  const aiUserInput = [
    `現在日付は日本時間で ${todayJstText} です。`,
    `現在時刻は日本時間で ${nowJstText} です。`,
    "",
    "ユーザーの「今日」「明日」「昨日」「今週」「来週」「先週」は、必ず上の日本時間を基準に判断してください。",
    "ユーザーが年を指定していない場合は、現在日付の年を基準にしてください。",
    "現在日付と無関係な古い年度の重賞一覧を返してはいけません。",
    "対象はJRA平地レースのみです。障害レース、地方、海外、新馬、未勝利、一般平場は対象外です。",
    "LINE返信なのでMarkdown記法、URL、出典リンクは使わないでください。",
    "確認できない情報は作らず、不明と書いてください。",
    "",
    "ユーザーのLINEメッセージ：",
    userText
  ].join("\n");

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    tools: [
      {
        type: "web_search"
      }
    ],
    input: [
      {
        role: "system",
        content: UMA_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: aiUserInput,
      },
    ],
    max_output_tokens: 1800,
  });

  return cleanLineReply(response.output_text || "返答を作れませんでした。");
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
      text: cleanLineReply(fixedReply),
    });
  }

  if (!shouldUseWebSearch(userText)) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: getNotTargetReply(),
    });
  }

  try {
    const aiReply = await callUmaDataChanWithWeb(userText);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: aiReply.slice(0, 4800),
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
      "確認すること：",
      "・OpenAI Platformの残高",
      "・APIキー",
      "・利用上限",
      "・Renderの環境変数 OPENAI_API_KEY",
      "",
      "※テスト返信が動くなら、LINEとRenderの接続は成功しています。"
    ].join("\n");

    if (err.code === "insufficient_quota") {
      errorMessage = [
        "OpenAI APIの利用枠が足りません🐴",
        "",
        "OpenAI Platformの残高・課金設定・利用上限を確認してください。",
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
      text: cleanLineReply(errorMessage),
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