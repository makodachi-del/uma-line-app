 const express = require("express");
const line = require("@line/bot-sdk");
const OpenAI = require("openai");

const app = express();

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.Client(config);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("うまデータちゃん LINE AI is running!");
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userMessage = event.message.text;

  const aiReply = await getUmaDataReply(userMessage);

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: aiReply,
  });
}

async function getUmaDataReply(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "あなたはLINE競馬AI『うまデータちゃん』です。JRA平地レースを中心に、ユーザーの質問に日本語でわかりやすく答えてください。馬券の購入を強く勧めず、予想は参考情報として扱ってください。今日の重賞、今週の重賞、レース予想、印、買い目候補などを聞かれたら、分かる範囲で丁寧に回答してください。確認できない情報は不明と書いてください。",
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      max_tokens: 800,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error(error);
    return "ごめんなさい。今は予想AIの返答でエラーが出ています。少し待ってからもう一度送ってください。";
  }
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
