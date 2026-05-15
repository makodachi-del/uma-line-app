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

function getJstWeekdayShort() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
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
// 重賞専用判定
// ==============================
function isHeavyRaceOnlyRequest(userText) {
  const text = String(userText || "");
  return (
    text.includes("重賞") &&
    !text.includes("特別以上") &&
    !text.includes("特別") &&
    !text.includes("未勝利")
  );
}

// ==============================
// 重賞JSON抽出
// ==============================
function extractJsonArray(text) {
  const raw = String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");

  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  try {
    const jsonText = raw.slice(start, end + 1);
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("JSON parse error:", err);
    return [];
  }
}

// ==============================
// 重賞一覧フォーマット
// ==============================
function formatHeavyRaceList(races, userText) {
  const today = getTodayJstText();

  const bannedWords = [
    "ジャンプ",
    "ハイジャンプ",
    "グランドジャンプ",
    "障害",
    "J-GI",
    "J-GII",
    "J-GIII",
    "J・GI",
    "J・GII",
    "J・GIII",
    "JGI",
    "JGII",
    "JGIII",
    "栗東ステークス",
    "弥彦ステークス",
    "六社ステークス"
  ];

  const allowedGrades = [
    "GI",
    "GII",
    "GIII",
    "G1",
    "G2",
    "G3",
    "ＧⅠ",
    "ＧⅡ",
    "ＧⅢ",
    "Ｇ１",
    "Ｇ２",
    "Ｇ３"
  ];

  const cleaned = [];

  for (const r of races) {
    const raceName = String(r.raceName || "").trim();
    const grade = String(r.grade || "").trim();
    const raceType = String(r.raceType || "").trim();

    const allText = [
      raceName,
      grade,
      raceType,
      r.racecourse,
      r.course,
      r.memo
    ].join(" ");

    const isBanned = bannedWords.some((word) => allText.includes(word));
    if (isBanned) continue;

    const hasAllowedGrade = allowedGrades.some((g) => grade.includes(g));
    if (!hasAllowedGrade) continue;

    if (grade.includes("J-") || grade.includes("J・") || grade.includes("JG")) {
      continue;
    }

    if (raceType && !raceType.includes("平地")) {
      continue;
    }

    if (!raceName) continue;

    cleaned.push({
      date: String(r.date || "日付不明").trim(),
      racecourse: String(r.racecourse || "競馬場不明").trim(),
      raceNo: String(r.raceNo || "R不明").trim(),
      raceName,
      grade,
      startTime: String(r.startTime || "不明").trim(),
      course: String(r.course || "条件不明").trim(),
    });
  }

  if (cleaned.length === 0) {
    return [
      "今週のJRA平地重賞🐴",
      `${today} 時点`,
      "",
      "確認できた範囲では、対象レースは不明です。",
      "",
      "除外済み：",
      "・障害重賞",
      "・特別競走",
      "・地方競馬",
      "・海外競馬",
      "",
      "対象はJRA平地のG1・G2・G3のみです。"
    ].join("\n");
  }

  const grouped = {};
  for (const r of cleaned) {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push(r);
  }

  const lines = [];
  lines.push("今週のJRA平地重賞🐴");
  lines.push(`${today} 時点`);
  lines.push("");

  let number = 1;

  for (const date of Object.keys(grouped)) {
    lines.push(`【${date}】`);
    lines.push("");

    for (const r of grouped[date]) {
      lines.push(`${number}. ${r.raceName}（${r.grade}）`);
      lines.push(`${r.racecourse}${r.raceNo}`);
      lines.push(`発走：${r.startTime}`);
      lines.push(`条件：${r.course}`);
      lines.push("");
      number++;
    }
  }

  lines.push("除外済み：");
  lines.push("・障害重賞");
  lines.push("・特別競走");
  lines.push("・地方競馬");
  lines.push("・海外競馬");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ==============================
// 保存タイプ判定
// ==============================
function getHistoryType(userText) {
  const text = String(userText || "");

  if (text.includes("保存テスト")) return "保存テスト";

  if (
    text.includes("結果") ||
    text.includes("払戻") ||
    text.includes("着順")
  ) {
    return "結果";
  }

  if (
    text.includes("検証") ||
    text.includes("集計") ||
    text.includes("成績") ||
    text.includes("反省")
  ) {
    return "検証";
  }

  if (
    text.includes("予想") ||
    text.includes("馬柱") ||
    text.includes("出馬表") ||
    text.includes("出走馬")
  ) {
    return "予想";
  }

  if (
    text.includes("重賞") ||
    text.includes("特別") ||
    text.includes("未勝利") ||
    text.includes("レース")
  ) {
    return "一覧";
  }

  return "その他";
}

// ==============================
// Googleスプレッドシート保存
// ==============================
async function saveUmaHistory({ type, userText, aiReply, memo }) {
  const url = process.env.GOOGLE_SHEET_WEBHOOK_URL;

  if (!url) {
    console.log("GOOGLE_SHEET_WEBHOOK_URL is not set.");
    return;
  }

  try {
    const payload = {
      type: type || "",
      userText: userText || "",
      aiReply: aiReply || "",
      targetDate: getTodayJstText(),
      racecourse: "",
      raceName: "",
      marks: "",
      bets: "",
      result: "",
      hit: "",
      memo: memo || ""
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log("Google Sheet save response:", text);
  } catch (err) {
    console.error("Google Sheet save error:", err);
  }
}

// ==============================
// JRA開催なし判定
// ==============================
function getNoJraTodayReplyIfNeeded(userText) {
  const text = String(userText || "").trim();

  const isTodayRequest =
    text.includes("今日") ||
    text.includes("本日");

  if (!isTodayRequest) return null;

  const isRaceQuestion = [
    "重賞",
    "特別",
    "未勝利",
    "予想",
    "レース",
    "馬柱",
    "出馬表",
    "出走表",
    "出走馬",
    "結果",
    "払戻"
  ].some((word) => text.includes(word));

  if (!isRaceQuestion) return null;

  const weekday = getJstWeekdayShort();
  const noJraWeekdays = ["火", "水", "木", "金"];

  if (!noJraWeekdays.includes(weekday)) return null;

  const today = getTodayJstText();

  return [
    `本日は ${today} です。`,
    "",
    "今日はJRAの中央競馬開催日ではありません🐴",
    "",
    "そのため、今日のJRA平地レースは対象なしです。",
    "",
    "対象なし：",
    "・今日の重賞",
    "・今日の特別",
    "・今日の未勝利",
    "・今日の予想",
    "",
    "地方競馬、海外、障害、新馬は、うまデータちゃんの対象外です。",
    "",
    "次に確認するなら、",
    "「今週の重賞」",
    "「今週の特別」",
    "「来週の重賞」",
    "のように送ってください。"
  ].join("\n");
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
・ユーザーの「今日」「明日」「昨日」「今週」「来週」「先週」は、日本時間の現在日付を基準に判断します。
・現在日付と違う古い年度の重賞一覧を出してはいけません。
・ユーザーが年を指定していない場合は、現在日付の年を基準にします。
・日付が確認できない場合は「不明」と書きます。
・JRA開催日でない場合は、地方競馬や海外競馬を代わりに出してはいけません。

【対象】
・対象はJRA平地レースのみです。
・障害、地方、海外、新馬は対象外です。
・地方競馬は絶対に表示しません。

【重賞】
・重賞はJRA平地重賞のみです。
・G1、G2、G3、GI、GII、GIIIのみです。
・J-GI、J-GII、J-GIIIは障害重賞なので除外します。
・特別競走、オープン特別、リステッド、未勝利は混ぜません。
・京都ハイジャンプ、中山グランドジャンプ、阪神ジャンプステークスなど障害レースは表示しません。
・栗東ステークス、弥彦ステークス、六社ステークスなどの特別競走を重賞一覧に入れてはいけません。
・ステークスという名前だけで重賞扱いしてはいけません。

【特別以上】
・特別以上は、JRA平地の特別競走、オープン特別、リステッド、重賞を対象にします。
・障害、新馬、未勝利、地方、海外は対象外です。

【特別】
・特別は、JRA平地の特別競走のみです。
・重賞を含めるのは「特別以上」と言われた時だけです。

【未勝利】
・未勝利は、JRA平地の未勝利戦のみです。
・過去走3走以上が確認できる馬がいる未勝利戦だけ対象です。
・新馬戦は対象外です。

【結果確認】
・結果は、着順、払戻、単勝、複勝、ワイド、三連複を確認できる範囲で返します。
・確認できない情報は「不明」と書きます。

【検証】
・保存データが確認できない場合は「保存された過去予想が確認できないため、完全な検証はできません」と返します。

【出力ルール】
・LINEなので長すぎず、読みやすく返します。
・Markdown記法、URL、出典リンクは出しません。
・確認できない情報は作らず「不明」と書きます。
・障害レース、地方競馬は一覧に入れません。

【買い目ルール】
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
      "・保存テスト",
      "・今日の重賞",
      "・今週の重賞",
      "・来週の重賞",
      "・先週の重賞",
      "・今日の特別",
      "・今週の特別",
      "・今日の未勝利",
      "・レース名＋予想",
      "・レース名＋結果",
      "・検証",
      "・集計",
      "",
      "対象：",
      "・JRA平地レースのみ",
      "・重賞はG1、G2、G3のみ",
      "・障害、地方、海外、新馬は対象外",
      "・未勝利は、過去走3走以上が確認できる場合だけ本格予想します。"
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
    "特別",
    "未勝利",
    "重賞",
    "予想",
    "競馬予想",
    "馬柱",
    "出馬表",
    "出走表",
    "出走馬",
    "結果",
    "払戻",
    "着順",
    "集計",
    "検証",
    "成績",
    "反省",
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
    "「今日の特別」",
    "「今日の未勝利」",
    "「レース名＋予想」",
    "「レース名＋結果」",
    "のように送ってください。"
  ].join("\n");
}

// ==============================
// 重賞一覧専用OpenAI呼び出し
// ==============================
async function callHeavyRaceListWithWeb(userText) {
  const todayJstText = getTodayJstText();
  const nowJstText = getNowJstIsoText();

  const prompt = [
    `現在日付は日本時間で ${todayJstText} です。`,
    `現在時刻は日本時間で ${nowJstText} です。`,
    "",
    "ユーザーの依頼：",
    userText,
    "",
    "JRA公式または信頼できる競馬情報で、対象期間のJRA平地重賞だけを確認してください。",
    "",
    "絶対条件：",
    "・JRA平地重賞のみ",
    "・G1、G2、G3、GI、GII、GIIIのみ",
    "・J-GI、J-GII、J-GIIIは障害重賞なので除外",
    "・京都ハイジャンプ、中山グランドジャンプ、阪神ジャンプステークスなど障害は除外",
    "・特別競走、オープン特別、リステッド、未勝利、新馬、地方、海外は除外",
    "・ステークスという名前だけで重賞扱いしない",
    "・グレードを確認できないレースは入れない",
    "",
    "返答は説明文なしで、必ずJSON配列だけにしてください。",
    "各要素は以下の形にしてください。",
    "",
    "[",
    "  {",
    '    "date": "5月16日（土）",',
    '    "racecourse": "東京",',
    '    "raceNo": "11R",',
    '    "raceName": "レース名",',
    '    "grade": "GIII",',
    '    "startTime": "15:30",',
    '    "course": "芝1600m",',
    '    "raceType": "JRA平地重賞",',
    '    "memo": ""',
    "  }",
    "]"
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
        content: "あなたはJRA平地重賞だけを確認する競馬データ整理AIです。障害、特別、地方、海外を絶対に混ぜません。返答は必ずJSON配列だけです。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    max_output_tokens: 1200,
  });

  const arr = extractJsonArray(response.output_text || "");
  return formatHeavyRaceList(arr, userText);
}

// ==============================
// 通常Web検索つきOpenAI呼び出し
// ==============================
async function callUmaDataChanWithWeb(userText) {
  if (isHeavyRaceOnlyRequest(userText)) {
    return callHeavyRaceListWithWeb(userText);
  }

  const todayJstText = getTodayJstText();
  const nowJstText = getNowJstIsoText();

  const aiUserInput = [
    `現在日付は日本時間で ${todayJstText} です。`,
    `現在時刻は日本時間で ${nowJstText} です。`,
    "",
    "ユーザーの「今日」「明日」「昨日」「今週」「来週」「先週」は、必ず上の日本時間を基準に判断してください。",
    "現在日付と無関係な古い年度の一覧を返してはいけません。",
    "",
    "対象判定ルール：",
    "・重賞はJRA平地のG1、G2、G3のみ。障害重賞、特別競走、未勝利は混ぜない。",
    "・特別以上は、JRA平地の特別競走、オープン特別、リステッド、重賞。",
    "・特別は、JRA平地の特別競走のみ。重賞は混ぜない。",
    "・未勝利は、JRA平地の未勝利戦のみ。過去走3走以上が確認できる場合だけ本格予想。",
    "・障害、地方、海外、新馬は常に対象外。",
    "",
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

  if (userText.trim() === "保存テスト") {
    const reply = [
      "保存テストを実行しました🐴",
      "Googleスプレッドシートに1行追加されていれば成功です。"
    ].join("\n");

    await saveUmaHistory({
      type: "保存テスト",
      userText,
      aiReply: reply,
      memo: "保存接続テスト"
    });

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: cleanLineReply(reply),
    });
  }

  const fixedReply = getFixedReply(userText);
  if (fixedReply) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: cleanLineReply(fixedReply),
    });
  }

  const noJraTodayReply = getNoJraTodayReplyIfNeeded(userText);
  if (noJraTodayReply) {
    const cleanedReply = cleanLineReply(noJraTodayReply);

    await saveUmaHistory({
      type: "対象なし",
      userText,
      aiReply: cleanedReply,
      memo: "JRA開催なし固定返信"
    });

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: cleanedReply,
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
    const historyType = getHistoryType(userText);

    await saveUmaHistory({
      type: historyType,
      userText,
      aiReply,
      memo: "LINE返信自動保存"
    });

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: cleanLineReply(aiReply).slice(0, 4800),
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