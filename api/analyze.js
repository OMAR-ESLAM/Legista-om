// api/analyze.js
// Vercel Serverless Function — بروكسي لنداءات الذكاء الاصطناعي (Gemini API).
// المفتاح بيتقرأ من Environment Variable في Vercel باسم GEMINI_API_KEY
// ومبيبقاش ظاهر في أي كود بيتبعت للمتصفح.
//
// ملحوظة: الملف ده مكتوب بصيغة ES Module (export default) عشان يشتغل مع
// "type": "module" في package.json.

// موديلات بنجربها بالترتيب — لو الأول مش متاح (404) أو الكوتا بتاعته خلصت (429) أو الخدمة مشغولة (503)
// بيجرب اللي بعده تلقائيًا
const GEMINI_MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
];

const RETRYABLE_STATUSES = new Set([404, 429, 503]);

// محتوى الرسالة ممكن يكون نص (string) أو مصفوفة أجزاء (نص + صور/PDF)
function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part && part.type === 'image' && part.data) {
        return { inlineData: { mimeType: part.mimeType || 'image/jpeg', data: part.data } };
      }
      return { text: String((part && part.text) || '') };
    });
  }
  return [{ text: String(content || '') }];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is missing on the server.');
    res.status(500).json({ error: { message: 'Server misconfiguration: missing GEMINI_API_KEY' } });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const messages = body && body.messages;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: { message: 'messages array is required' } });
    return;
  }

  // موديلات Gemini 2.5 بتحسب "التفكير" ضمن حد التوكنز، فبنرفع الحد الأدنى عشان الرد ما يتقطعش
  const requestedTokens = Number(body.max_completion_tokens) || 1800;
  const maxTokens = Math.max(requestedTokens, 4096);

  // Gemini بيفصل رسالة النظام عن باقي المحادثة
  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const conversation = messages.filter((m) => m.role !== 'system');

  const contents = conversation.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toGeminiParts(m.content),
  }));

  const geminiBody = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
  };
  if (systemText) {
    geminiBody.systemInstruction = { parts: [{ text: systemText }] };
  }

  try {
    let geminiRes = null;
    let rawText = '';
    let lastStatus = 500;

    for (const model of GEMINI_MODEL_CANDIDATES) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(geminiBody),
      });
      rawText = await geminiRes.text();
      lastStatus = geminiRes.status;

      if (geminiRes.ok) break;

      if (!RETRYABLE_STATUSES.has(geminiRes.status)) break; // خطأ تاني (مثلًا 400 أو 403) — مفيش فايدة نجرب موديل تاني

      console.error(`Gemini model "${model}" failed with ${geminiRes.status}, trying next candidate...`);
    }

    if (!geminiRes || !geminiRes.ok) {
      console.error('Gemini API error:', lastStatus, rawText);
      res.status(lastStatus || 500);
      res.setHeader('Content-Type', 'application/json');
      res.send(rawText || JSON.stringify({ error: { message: 'Gemini request failed' } }));
      return;
    }

    let geminiData;
    try { geminiData = JSON.parse(rawText); } catch (e) { geminiData = null; }

    const candidateText =
      (geminiData?.candidates?.[0]?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || '')
        .join('');

    if (!candidateText) {
      console.error('Gemini returned empty text:', rawText.slice(0, 500));
    }

    // نفس شكل رد OpenAI/Groq عشان tahlil.html يشتغل من غير أي تعديل
    const compatible = {
      choices: [{ message: { role: 'assistant', content: candidateText } }],
    };

    res.status(200);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(compatible));
  } catch (err) {
    console.error('analyze proxy error:', err);
    res.status(500).json({ error: { message: 'proxy_error: ' + (err && err.message ? err.message : String(err)) } });
  }
}
