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

// قائمة موديلات نجرب بيها بالترتيب — لو الأول اتقفل أو اتلغى (بيحصل مع جوجل كتير)،
// بيتجرب اللي بعده تلقائيًا من غير ما نحتاج نرجع نعدّل الكود يدوي في كل مرة
const GEMINI_MODEL_CANDIDATES = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
];

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

  // محتوى الرسالة ممكن يكون نص عادي (string) أو مصفوفة أجزاء (نص + صور/PDF) لما فيه مستندات مرفقة
  function toGeminiParts(content) {
    if (typeof content === 'string') return [{ text: content }];
    if (Array.isArray(content)) {
      return content.map(part => {
        if (part && part.type === 'image' && part.data) {
          return { inlineData: { mimeType: part.mimeType || 'image/jpeg', data: part.data } };
        }
        return { text: String((part && part.text) || '') };
      });
    }
    return [{ text: String(content || '') }];
  }

  const contents = conversation.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toGeminiParts(m.content),
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
    let geminiRes = null;
    let rawText = '';
    let lastStatus = 500;

    for (const model of GEMINI_MODEL_CANDIDATES) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
      rawText = await geminiRes.text();
      lastStatus = geminiRes.status;

      if (geminiRes.ok) break; // نجح، بلاش نكمل نجرب موديلات تانية

      // لو المشكلة إن الموديل نفسه اتلغى/مش متاح (404)، جرب اللي بعده في القائمة
      const isModelUnavailable = geminiRes.status === 404;
      if (!isModelUnavailable) break; // أي خطأ تاني (429 rate limit، 400 بيانات غلط...) وقف على طول، معنى نجرب موديل تاني

      console.error(`Gemini model "${model}" unavailable (404), trying next candidate...`);
    }

    if (!geminiRes.ok) {
      console.error('Gemini API error:', lastStatus, rawText);
      res.status(lastStatus);
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
