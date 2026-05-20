async function saveToSheet(payload) {
  const url = process.env.SHEET_API_URL;

  if (!url) {
    return { ok: false, text: 'SHEET_API_URL未設定のため保存していません。' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        app: 'umapyon-ai',
        ...payload
      })
    });

    const text = await res.text();

    if (!res.ok) {
      return { ok: false, text, error: text };
    }

    try {
      return JSON.parse(text);
    } catch {
      return { ok: true, text };
    }
  } catch (error) {
    return { ok: false, error: error.message, text: error.message };
  }
}

async function getSheetSummary() {
  const url = process.env.SHEET_API_URL;

  if (!url) {
    return { ok: false, text: 'SHEET_API_URL未設定です。' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'summary', app: 'umapyon-ai' })
    });

    const text = await res.text();

    if (!res.ok) {
      return { ok: false, text };
    }

    try {
      return JSON.parse(text);
    } catch {
      return { ok: true, text };
    }
  } catch (error) {
    return { ok: false, text: error.message };
  }
}

module.exports = {
  saveToSheet,
  getSheetSummary
};