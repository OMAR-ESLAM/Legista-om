// api/analyze.js
// Vercel Serverless Function — بروكسي لنداءات الذكاء الاصطناعي.
// دلوقتي بيستخدم Gemini API (مجاني من Google AI Studio) بدل Groq.
// المفتاح بيتقرأ من Environment Variable في إعدادات Vercel (GEMINI_API_KEY)
// ومبيبقاش ظاهر في أي كود بيتبعت للمتصفح أو بيترفع على GitHub.
//
// إزاي تجيب مفتاح مجاني:
//   1) روح على aistudio.google.com/apikey وسجل دخول بحساب جوجل
//   2) دوس "Create API key" — مفيش أي بطاقة ائتمان مطلوبة
//   3) انسخ المفتاح وحطه في: Vercel Project → Settings → Environment Variables
//      باسم GEMINI_API_KEY بالظبط
//
// ملحوظة: التير المجاني ليه حد أقصى للطلبات في الدقيقة/اليوم (rate limit)،
// لو حصل تجاوز هيرجع خطأ 429 وده هيتظهر للمستخدم كرسالة "حصل خطأ، جرب تاني".

const GEMINI_MODEL = 'gemini-2.5-flash'; // موديل سريع ومتاح على التير المجاني
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

module.exports = async (req, res) => {
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
  // بعض بيئات Vercel بتوصل الـ body كـ string لو الـ content-type مش JSON بشكل صريح
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const messages = body && body.messages;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: { message: 'messages array is required' } });
    return;
  }

  const maxTokens = Number(body.max_completion_tokens) || 1800;

  // Gemini بيفصل رسالة النظام (system) عن باقي المحادثة (contents)
  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const conversation = messages.filter(m => m.role !== 'system');

  const contents = conversation.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));

  const geminiBody = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json', // بيرجع JSON خام زي ما الواجهة محتاجة
    },
  };
  if (systemText) {
    geminiBody.systemInstruction = { parts: [{ text: systemText }] };
  }

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    const rawText = await geminiRes.text();

    if (!geminiRes.ok) {
      console.error('Gemini API error:', geminiRes.status, rawText);
      res.status(geminiRes.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(rawText);
      return;
    }

    let geminiData;
    try { geminiData = JSON.parse(rawText); } catch (e) { geminiData = null; }

    const candidateText =
      (geminiData?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');

    // بنرجّع نفس شكل رد Groq/OpenAI (choices[0].message.content) عشان كود
    // الواجهة (tahlil.html) يفضل شغال بالظبط زي ما هو من غير أي تعديل تاني
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
};
