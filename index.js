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
// 日付処理
// ==============================
function getJstParts() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());

  const obj = {};
  for (const p of parts) obj[p.type] = p.value;

  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    weekday: obj.weekday,
  };
}

function getJstDateObject() {
  const p = getJstParts();
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatJpDate(date) {
  const w = ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()];
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${w}）`;
}

function getTodayJstText() {
  const p = getJstParts();
  return `${p.year}年${p.month}月${p.day}日（${p.weekday}）`;
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
  return getJstParts().weekday;
}

function getTargetDates(userText) {
  const text = String(userText || "");
  const today = getJstDateObject();
  const day = today.getUTCDay();

  if (text.includes("今日") || text.includes("本日")) {
    return [today];
  }

  if (text.includes("明日")) {
    return [addDays(today, 1)];
  }

  if (text.includes("昨日")) {
    return [addDays(today, -1)];
  }

  const daysToSat = (6 - day + 7) % 7;

  if (text.includes("先週")) {
    const sat = addDays(today, daysToSat - 7);
    return [sat, addDays(sat, 1)];
  }

  if (text.includes("来週")) {
    const sat = addDays(today, daysToSat + 7);
    return [sat, addDays(sat, 1)];
  }

  if (text.includes("今週")) {
    if (day === 6) return [today, addDays(today, 1)];
    if (day === 0) return [today];

    const sat = addDays(today, daysToSat);
    return [sat, addDays(sat, 1)];
  }

  return [today];
}

function getPeriodLabel(userText) {
  const text = String(userText || "");
  if (text.includes("今日") || text.includes("本日")) return "今日";
  if (text.includes("明日")) return "明日";
  if (text.includes("昨日")) return "昨日";
  if (text.includes("先週")) return "先週";
  if (text.includes("来週")) return "来週";
  if (text.includes("今週")) return "今週";
  return "対象日の";
}

// ==============================
// 返信整形
// ==============================
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
// 種類判定
// ==============================
function getListCategory(userText) {
  const text = String(userText || "");

  if (text.includes("特別以上")) return "特別以上";
  if (text.includes("未勝利")) return "未勝利";
  if (text.includes("特別")) return "特別";
  if (text.includes("重賞")) return "重賞";

  return null;
}

function isListRequest(userText) {
  const text = String(userText || "");
  const category = getListCategory(text);

  if (!category) return false;

  const notListWords = [
    "予想",
    "結果",
    "払戻",
    "着順",
    "検証",
    "集計",
    "成績",
    "反省"
  ];

  return !notListWords.some((word) => text.includes(word));
}

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
// 今日のJRA開催なし固定判定
// ==============================
function getNoJraTodayReplyIfNeeded(userText) {
  const text = String(userText || "").trim();

  const isTodayRequest =
    text.includes("今日") ||
    text.includes("本日");

  if (!isTodayRequest) return null;

  const isWeekRequest =
    text.includes("今週") ||
    text.includes("来週") ||
    text.includes("先週");

  if (isWeekRequest) return null;

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
    "・今日の特別以上",
    "・今日の特別",
    "・今日の未勝利",
    "・今日の予想",
    "",
    "地方競馬、海外、障害、新馬は対象外です。",
    "",
    "次に確認するなら、",
    "「今週の重賞」",
    "「今週の特別以上」",
    "「今週の特別」",
    "「来週の重賞」",
    "のように送ってください。"
  ].join("\n");
}

// ==============================
// JSON処理
// ==============================
function extractJsonArray(text) {
  const raw = String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");

  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const jsonText = raw.slice(start, end + 1);
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("JSON parse error:", err);
    return [];
  }
}

function normalizeGrade(grade) {
  return String(grade || "")
    .replace(/Ｇ/g, "G")
    .replace(/Ⅰ/g, "I")
    .replace(/Ⅱ/g, "II")
    .replace(/Ⅲ/g, "III")
    .replace(/１/g, "1")
    .replace(/２/g, "2")
    .replace(/３/g, "3")
    .trim();
}

function normalizeText(text) {
  return String(text || "").trim();
}

// ==============================
// 一覧フィルター
// ==============================
function filterRaceList(races, category, targetDates) {
  const targetYmds = targetDates.map(formatYmd);

  const allowedRacecourses = [
    "札幌",
    "函館",
    "福島",
    "新潟",
    "東京",
    "中山",
    "中京",
    "京都",
    "阪神",
    "小倉"
  ];

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
    "新馬",
    "川崎",
    "浦和",
    "大井",
    "船橋",
    "園田",
    "高知",
    "佐賀",
    "名古屋",
    "笠松",
    "門別",
    "金沢",
    "水沢",
    "盛岡"
  ];

  const cleaned = [];

  for (const r of races || []) {
    const dateYmd = normalizeText(r.dateYmd);
    const racecourse = normalizeText(r.racecourse);
    const raceNo = normalizeText(r.raceNo) || "R不明";
    const raceName = normalizeText(r.raceName);
    const grade = normalizeGrade(r.grade);
    const raceClass = normalizeText(r.raceClass);
    const raceType = normalizeText(r.raceType);
    const course = normalizeText(r.course) || "条件不明";
    const startTime = normalizeText(r.startTime) || "不明";
    const hasThreePastRuns = r.hasThreePastRuns === true;

    const allText = [
      dateYmd,
      racecourse,
      raceNo,
      raceName,
      grade,
      raceClass,
      raceType,
      course,
      r.memo
    ].join(" ");

    if (!targetYmds.includes(dateYmd)) continue;
    if (!raceName) continue;
    if (!allowedRacecourses.includes(racecourse)) continue;
    if (bannedWords.some((w) => allText.includes(w))) continue;
    if (raceType && !raceType.includes("平地")) continue;

    const isGradeHeavy =
      grade === "GI" ||
      grade === "GII" ||
      grade === "GIII" ||
      grade === "G1" ||
      grade === "G2" ||
      grade === "G3";

    const isJumpGrade =
      grade.includes("J-") ||
      grade.includes("J・") ||
      grade.includes("JG");

    if (isJumpGrade) continue;

    if (category === "重賞") {
      if (!isGradeHeavy) continue;
      if (!raceClass.includes("重賞")) continue;
    }

    if (category === "特別以上") {
      if (raceClass.includes("未勝利")) continue;
      if (raceClass.includes("新馬")) continue;

      const ok =
        raceClass.includes("重賞") ||
        raceClass.includes("リステッド") ||
        raceClass.includes("L") ||
        raceClass.includes("オープン") ||
        raceClass.includes("特別") ||
        isGradeHeavy;

      if (!ok) continue;
    }

    if (category === "特別") {
      if (isGradeHeavy) continue;
      if (raceClass.includes("重賞")) continue;
      if (raceClass.includes("未勝利")) continue;
      if (raceClass.includes("新馬")) continue;

      const ok =
        raceClass.includes("特別") ||
        raceClass.includes("リステッド") ||
        raceClass.includes("L") ||
        raceClass.includes("オープン");

      if (!ok) continue;
    }

    if (category === "未勝利") {
      if (!raceClass.includes("未勝利")) continue;
      if (!hasThreePastRuns) continue;
    }

    cleaned.push({
      dateYmd,
      date: normalizeText(r.date) || formatJpDate(new Date(dateYmd + "T00:00:00Z")),
      racecourse,
      raceNo,
      raceName,
      grade,
      raceClass,
      startTime,
      course,
      hasThreePastRuns,
    });
  }

  cleaned.sort((a, b) => {
    if (a.dateYmd !== b.dateYmd) return a.dateYmd.localeCompare(b.dateYmd);
    return String(a.startTime).localeCompare(String(b.startTime));
  });

  return cleaned;
}

// ==============================
// 一覧フォーマット
// ==============================
function formatRaceList(races, category, userText, targetDates) {
  const today = getTodayJstText();
  const period = getPeriodLabel(userText);
  const targetLabel = targetDates.map(formatJpDate).join("・");

  const titleMap = {
    "重賞": `${period}のJRA平地重賞🐴`,
    "特別以上": `${period}のJRA平地 特別以上🐴`,
    "特別": `${period}のJRA平地 特別競走🐴`,
    "未勝利": `${period}のJRA平地 未勝利🐴`,
  };

  const title = titleMap[category] || `${period}のJRA平地レース🐴`;

  if (!races || races.length === 0) {
    const extra =
      category === "未勝利"
        ? "未勝利は、過去走3走以上が確認できる馬がいるレースだけ対象です。"
        : "確認できた範囲では、対象レースは不明です。";

    return [
      title,
      `${today} 時点`,
      "",
      `対象日：${targetLabel}`,
      "",
      extra,
      "",
      "除外済み：",
      "・障害",
      "・地方競馬",
      "・海外競馬",
      "・新馬",
      category === "重賞" ? "・特別競走" : "",
      "",
      "確認できない情報は不明として扱います。"
    ].filter(Boolean).join("\n");
  }

  const grouped = {};
  for (const r of races) {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push(r);
  }

  const lines = [];
  lines.push(title);
  lines.push(`${today} 時点`);
  lines.push("");
  lines.push(`対象日：${targetLabel}`);
  lines.push("");

  let number = 1;

  for (const date of Object.keys(grouped)) {
    lines.push(`【${date}】`);
    lines.push("");

    for (const r of grouped[date]) {
      const gradeText = r.grade ? `（${r.grade}）` : "";
      lines.push(`${number}. ${r.raceName}${gradeText}`);
      lines.push(`${r.racecourse}${r.raceNo}`);
      lines.push(`発走：${r.startTime}`);
      lines.push(`条件：${r.course}`);

      if (category !== "重賞") {
        lines.push(`区分：${r.raceClass || "不明"}`);
      }

      if (category === "未勝利") {
        lines.push("判定：過去走3走以上確認対象");
      }

      lines.push("");
      number++;
    }
  }

  lines.push("除外済み：");
  lines.push("・障害");
  lines.push("・地方競馬");
  lines.push("・海外競馬");
  lines.push("・新馬");

  if (category === "重賞") {
    lines.push("・特別競走");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ==============================
// 一覧専用OpenAI
// ==============================
async function callRaceListWithWeb(userText) {
  const category = getListCategory(userText);
  const targetDates = getTargetDates(userText);
  const targetYmds = targetDates.map(formatYmd);
  const targetLabel = targetDates.map(formatJpDate).join("・");
  const todayJstText = getTodayJstText();
  const nowJstText = getNowJstIsoText();

  const categoryRuleMap = {
    "重賞": [
      "JRA平地重賞のみ。",
      "G1、G2、G3、GI、GII、GIIIのみ。",
      "J-GI、J-GII、J-GIIIは障害なので除外。",
      "特別競走、オープン特別、リステッド、未勝利、新馬は除外。",
      "raceClassは必ず「重賞」にする。"
    ].join("\n"),
    "特別以上": [
      "JRA平地の特別競走、オープン特別、リステッド、重賞を対象。",
      "障害、新馬、未勝利、地方、海外は除外。",
      "raceClassは「重賞」「リステッド」「オープン特別」「特別」のいずれかにする。"
    ].join("\n"),
    "特別": [
      "JRA平地の特別競走のみ。",
      "重賞は含めない。",
      "障害、新馬、未勝利、地方、海外は除外。",
      "raceClassは「特別」「オープン特別」「リステッド」のいずれかにする。"
    ].join("\n"),
    "未勝利": [
      "JRA平地の未勝利戦のみ。",
      "新馬、障害、地方、海外は除外。",
      "過去走3走以上が確認できる馬がいる未勝利戦だけ出す。",
      "hasThreePastRunsは確認できた場合だけtrueにする。",
      "確認できない場合は出さない。"
    ].join("\n"),
  };

  const prompt = [
    `現在日付は日本時間で ${todayJstText} です。`,
    `現在時刻は日本時間で ${nowJstText} です。`,
    "",
    `ユーザーの依頼：${userText}`,
    `対象カテゴリ：${category}`,
    `対象日：${targetLabel}`,
    `対象dateYmd：${targetYmds.join(", ")}`,
    "",
    "以下の対象日だけを調べてください。",
    "対象dateYmd以外の日付のレースは絶対に入れないでください。",
    "",
    "カテゴリ別ルール：",
    categoryRuleMap[category] || "",
    "",
    "共通除外：",
    "・障害",
    "・地方競馬",
    "・海外競馬",
    "・新馬",
    "・確認できない情報の創作",
    "・古い年度や対象日以外のレース",
    "",
    "返答は説明文なしで、必ずJSON配列だけにしてください。",
    "各要素は必ず以下の形にしてください。",
    "",
    "[",
    "  {",
    '    "dateYmd": "2026-05-17",',
    '    "date": "5月17日（日）",',
    '    "racecourse": "東京",',
    '    "raceNo": "11R",',
    '    "raceName": "レース名",',
    '    "grade": "GI",',
    '    "startTime": "15:40",',
    '    "course": "芝1600m",',
    '    "raceClass": "重賞",',
    '    "raceType": "JRA平地",',
    '    "hasThreePastRuns": false,',
    '    "memo": ""',
    "  }",
    "]"
  ].join("\n");

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    tools: [{ type: "web_search" }],
    input: [
      {
        role: "system",
        content: "あなたはJRA平地レースだけをJSONで整理するAIです。対象日以外、障害、地方、海外、新馬、創作情報を絶対に混ぜません。返答はJSON配列だけです。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    max_output_tokens: 1600,
  });

  const arr = extractJsonArray(response.output_text || "");
  const filtered = filterRaceList(arr, category, targetDates);

  return formatRaceList(filtered, category, userText, targetDates);
}

// ==============================
// うまデータちゃん基本プロンプト
// ==============================
const UMA_SYSTEM_PROMPT = `
あなたはLINE競馬AI「うまデータちゃん」です。
JRA平地レース専用の競馬予想AIです。

最重要ルール：
・ユーザーの要求範囲だけ実行します。
・確認していない情報を確認済みとして扱ってはいけません。
・不明情報は創作せず「不明」と書きます。
・対象はJRA平地レースのみです。
・障害、地方、海外、新馬は対象外です。
・重賞はJRA平地のG1、G2、G3のみです。
・J-GI、J-GII、J-GIIIは障害なので除外します。
・特別競走、オープン特別、リステッド、未勝利を重賞に混ぜません。
・特別はJRA平地の特別競走のみです。
・特別以上はJRA平地の特別競走、オープン特別、リステッド、重賞です。
・未勝利はJRA平地の未勝利戦のみです。
・未勝利の本格予想は過去走3走以上が確認できる馬がいる場合だけです。
・馬柱、出馬表、枠順、馬番、騎手、斤量、調教師、近走3走以上が確認できない場合、本格予想はしません。
・人気、オッズ、払戻、結果は予想印や勝負度に使いません。
・買い目は単勝、複勝、ワイド、三連複のみです。
・馬連、枠連、馬単、三連単は出しません。
・Markdown記法、URL、出典リンクは出しません。
・LINEで読みやすく短く返します。
`;

// ==============================
// 固定返信
// ==============================
function getFixedReply(userText) {
  const text = String(userText || "").trim();

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
      "・今日の特別以上",
      "・今週の特別以上",
      "・今日の特別",
      "・今週の特別",
      "・今日の未勝利",
      "・今週の未勝利",
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
  const text = String(userText || "").trim();

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
    "「今日の特別以上」",
    "「今日の特別」",
    "「今日の未勝利」",
    "「レース名＋予想」",
    "「レース名＋結果」",
    "のように送ってください。"
  ].join("\n");
}

// ==============================
// 通常OpenAI呼び出し
// ==============================
async function callUmaDataChanWithWeb(userText) {
  if (isListRequest(userText)) {
    return callRaceListWithWeb(userText);
  }

  const todayJstText = getTodayJstText();
  const nowJstText = getNowJstIsoText();

  const aiUserInput = [
    `現在日付は日本時間で ${todayJstText} です。`,
    `現在時刻は日本時間で ${nowJstText} です。`,
    "",
    "ユーザーの「今日」「明日」「昨日」「今週」「来週」「先週」は、必ず上の日本時間を基準に判断してください。",
    "現在日付と無関係な古い年度の情報を返してはいけません。",
    "",
    "対象判定：",
    "・JRA平地レースのみ。",
    "・障害、地方、海外、新馬は対象外。",
    "・重賞はJRA平地のG1、G2、G3のみ。",
    "・特別以上はJRA平地の特別競走、オープン特別、リステッド、重賞。",
    "・特別はJRA平地の特別競走のみ。",
    "・未勝利はJRA平地の未勝利戦のみ。",
    "・未勝利の本格予想は過去走3走以上が確認できる場合だけ。",
    "",
    "予想時：",
    "・馬柱、出馬表、枠順、馬番、騎手、斤量、調教師、近走3走以上が確認できない場合は本格予想不可。",
    "・人気、オッズ、払戻、結果を予想印や勝負度に使わない。",
    "・買い目は単勝、複勝、ワイド、三連複のみ。",
    "",
    "結果時：",
    "・結果確認は着順、払戻、単勝、複勝、ワイド、三連複を確認できる範囲で返す。",
    "",
    "LINE返信なのでMarkdown記法、URL、出典リンクは使わないでください。",
    "確認できない情報は作らず、不明と書いてください。",
    "",
    "ユーザーのLINEメッセージ：",
    userText
  ].join("\n");

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    tools: [{ type: "web_search" }],
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
    const cleanedReply = cleanLineReply(aiReply);
    const historyType = getHistoryType(userText);

    await saveUmaHistory({
      type: historyType,
      userText,
      aiReply: cleanedReply,
      memo: "LINE返信自動保存"
    });

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: cleanedReply.slice(0, 4800),
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
// 起動確認
// ==============================
app.get("/", (req, res) => {
  res.send("uma-line-app is running 🐴");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});