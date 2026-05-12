const express = require("express");
const line = require("@line/bot-sdk");
const OpenAI = require("openai");

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(lineConfig);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error("Webhook error:", err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text.trim();

  if (userMessage === "テスト") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "うまデータちゃん起動中です🐴\nLINEとRenderの接続は成功しています。",
    });
  }

  const allowedMessages = [
    "今日の重賞",
    "今週の重賞",
    "明日の重賞",
    "予想",
    "競馬予想",
  ];

  const shouldUseAI = allowedMessages.some((word) =>
    userMessage.includes(word)
  );

  if (!shouldUseAI) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "うまデータちゃんです🐴\n\n使える言葉はこちらです。\n・テスト\n・今日の重賞\n・今週の重賞\n・明日の重賞\n・予想\n\n※この返信ではAIを使っていないので、API料金はほぼ減りません。",
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "あなたはLINE競馬AI「うまデータちゃん」です。JRA平地レースを中心に、やさしく分かりやすく競馬予想を返答してください。的中や利益は保証せず、無理な購入はすすめないでください。返答は長くしすぎず、LINEで読みやすくしてください。",
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      max_tokens: 700,
      temperature: 0.7,
    });

    const aiText =
      completion.choices[0]?.message?.content ||
      "ごめんなさい。うまく返答を作れませんでした。";

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: aiText,
    });
  } catch (error) {
    console.error("OpenAI error:", error);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "ごめんなさい。今は予想AIの返答でエラーが出ています。\nOpenAI APIの課金・残高・利用上限を確認してください。",
    });
  }
}

app.get("/", (req, res) => {
  res.send("うまデータちゃん LINE bot is running.");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
