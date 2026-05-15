async function saveToSheet(payload) {
  const url = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: true, reason: 'GOOGLE_SHEET_WEBHOOK_URL未設定' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function buildSheetPayload({ type, userText, aiReply, race }) {
  return {
    type: type || '',
    userText: userText || '',
    aiReply: aiReply || '',
    targetDate: race?.date || '',
    racecourse: race?.course || '',
    raceName: race?.name || '',
    marks: '',
    bets: '',
    result: '',
    hit: '',
    memo: race?.fetchError || ''
  };
}

module.exports = { saveToSheet, buildSheetPayload };
