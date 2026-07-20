// /api/tahlil.js
// Vercel Serverless Function — تحليل القضية بالذكاء الاصطناعي (LEGISTA)
//
// ⚠️ مهم جدًا: مفتاح Groq بيتقرأ من Environment Variable على السيرفر فقط
// (process.env.GROQ_API_KEY). متكتبوش المفتاح هنا أبدًا كـ string صريح،
// وميتبعتش لأي كود بيشتغل في المتصفح (client-side).
//
// إزاي تظبط المتغير على Vercel:
//   Project Settings → Environment Variables → أضف:
//     Name:  GROQ_API_KEY
//     Value: gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   ثم اعمل Redeploy للمشروع.

// ---------- مكتبة الدفوع الحقيقية (نفس الـ keys الموجودة في dafou-detail.html) ----------
// لينك كل قسم عندك هيبقى: dafou-detail.html?section=KEY
const DEFENSE_LIBRARY = [
  { key: 'butlan',     type: 'criminal', title: 'الدفع بالبطلان والجنحة المباشرة' },
  { key: 'cheque',     type: 'criminal', title: 'الدفوع في الشيك' },
  { key: 'jnayat',     type: 'criminal', title: 'الدفوع في الجنايات' },
  { key: 'jonah',      type: 'criminal', title: 'الدفوع في الجنح' },
  { key: 'tashriaat',  type: 'criminal', title: 'الدفوع في التشريعات الجنائية الخاصة (قبض / تلبس / تفتيش)' },
  { key: 'taaan',      type: 'criminal', title: 'الدفوع في طرق الطعن في الأحكام' },
  { key: 'ettiraf',    type: 'criminal', title: 'الدفوع في الاعتراف' },
  { key: 'mabani',     type: 'criminal', title: 'الدفوع في جرائم المباني' },
  { key: 'katl',       type: 'criminal', title: 'دفوع القتل العمد' },
  { key: 'darb',       type: 'criminal', title: 'دفوع الضرب المفضي إلى الموت' },
  { key: 'aaha',       type: 'criminal', title: 'دفوع الضرب المفضي إلى عاهة مستديمة' },
  { key: 'masalha',    type: 'criminal', title: 'دفوع الجرائم المضرة بالمصلحة العامة' },
  { key: 'ikhtilas',   type: 'criminal', title: 'دفوع الاختلاس' },
  { key: 'erd',        type: 'criminal', title: 'دفوع الاعتداء على العرض' },
  { key: 'hatk',       type: 'criminal', title: 'دفوع هتك العرض' },
  { key: 'khatf',      type: 'criminal', title: 'دفوع خطف الإناث' },
  { key: 'ijhad',      type: 'criminal', title: 'دفوع جرائم الإجهاض' },
  { key: 'amwal',      type: 'criminal', title: 'دفوع جنايات الاعتداء على الأموال' },
  { key: 'sanadat',    type: 'criminal', title: 'دفوع اغتصاب السندات والتوقيعات' },
  { key: 'nasb',       type: 'criminal', title: 'الدفوع في النصب' },
  { key: 'ikhtisas',   type: 'civil',    title: 'الدفوع المتعلقة بعدم الاختصاص' },
  { key: 'qabool',     type: 'civil',    title: 'الدفوع المتعلقة بعدم القبول' },
  { key: 'motanawia',  type: 'civil',    title: 'الدفوع المدنية المتنوعة' },
];

const TYPE_LABELS = { criminal: 'جنائي', civil: 'مدني' };
const STAGE_LABELS = { investigation: 'تحقيق', trial: 'محاكمة', appeal: 'استئناف' };

function buildLibraryPrompt(caseType) {
  const relevant = DEFENSE_LIBRARY.filter(d => d.type === caseType);
  return relevant.map(d => `- key: "${d.key}" | ${d.title}`).join('\n');
}

function buildSystemPrompt(caseType) {
  const library = buildLibraryPrompt(caseType);
  return `أنت مساعد قانوني مصري متخصص، تابع لمنصة LEGISTA. مهمتك تحليل وقائع قضية وصفها محامٍ، وإخراج تحليل قانوني استرشادي أولي.

قواعد صارمة:
1. لازم ترجع الرد بصيغة JSON فقط بدون أي نص إضافي قبله أو بعده، وبدون علامات ```.
2. حقل "defenses" لازم يحتوي فقط على دفوع من القائمة دي (استخدم قيمة "key" بالظبط زي ما هي، من غير تعديل):
${library}
3. اختر أقرب 3 إلى 6 دفوع فعلاً مناسبة لوقائع القضية، مش كل القائمة.
4. لكل دفع حدد "priority" واحدة من: "قوي" أو "متوسط" أو "ضعيف" حسب مدى قوته بالنسبة لوقائع القضية تحديدًا.
5. الشكل المطلوب بالظبط:
{
  "summary": "نص تحليل الموقف القانوني العام (فقرة أو فقرتين)",
  "points": ["نقطة قوة أو ضعف 1", "نقطة قوة أو ضعف 2", "..."],
  "defenses": [
    { "key": "butlan", "title": "اسم الدفع بالتحديد", "reason": "سبب اقتراح هذا الدفع بناءً على وقائع القضية تحديدًا", "priority": "قوي" }
  ],
  "scenarios": ["سيناريو محتمل 1 لمسار القضية", "سيناريو محتمل 2", "..."]
}
6. اكتب كل المحتوى بالعربية الفصحى المبسطة المناسبة لمحامٍ محترف.
7. لا تفتِ بشكل قاطع؛ التحليل استرشادي أولي فقط ولا يغني عن تقدير المحامي المهني.`;
}

function buildUserPrompt({ type, stage, caseNumber, parties, facts }) {
  let out = `نوع القضية: ${TYPE_LABELS[type] || type}\n`;
  out += `مرحلة القضية: ${STAGE_LABELS[stage] || stage}\n`;
  if (caseNumber) out += `رقم القضية: ${caseNumber}\n`;
  if (parties) out += `الأطراف: ${parties}\n`;
  out += `\nوقائع القضية كما وصفها المحامي:\n${facts}`;
  return out;
}

// يحاول يستخرج JSON صالح حتى لو الموديل حط نص زيادة بالغلط
function extractJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw e;
  }
}

// تحقق بسيط من الـ keys اللي رجعها الموديل، وتجاهل أي key مش موجود عندنا فعلاً
function sanitizeDefenses(defenses, caseType) {
  if (!Array.isArray(defenses)) return [];
  const validKeys = new Set(DEFENSE_LIBRARY.filter(d => d.type === caseType).map(d => d.key));
  const validPriorities = new Set(['قوي', 'متوسط', 'ضعيف']);
  return defenses
    .filter(d => d && typeof d === 'object' && validKeys.has(d.key))
    .map(d => ({
      key: d.key,
      title: typeof d.title === 'string' ? d.title.slice(0, 200) : '',
      reason: typeof d.reason === 'string' ? d.reason.slice(0, 800) : '',
      priority: validPriorities.has(d.priority) ? d.priority : 'متوسط',
    }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    console.error('GROQ_API_KEY is missing from environment variables');
    return res.status(500).json({ error: 'Server misconfiguration: missing API key' });
  }

  try {
    const { type, stage, caseNumber, parties, facts } = req.body || {};

    if (!facts || typeof facts !== 'string' || !facts.trim()) {
      return res.status(400).json({ error: 'الوقائع مطلوبة' });
    }
    const caseType = type === 'civil' ? 'civil' : 'criminal';
    const caseStage = ['investigation', 'trial', 'appeal'].includes(stage) ? stage : 'investigation';

    const systemPrompt = buildSystemPrompt(caseType);
    const userPrompt = buildUserPrompt({
      type: caseType,
      stage: caseStage,
      caseNumber: (caseNumber || '').slice(0, 100),
      parties: (parties || '').slice(0, 200),
      facts: facts.slice(0, 6000),
    });

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.4,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('Groq API error:', groqRes.status, errText);
      return res.status(502).json({ error: 'فشل الاتصال بمحرك التحليل، حاول تاني' });
    }

    const groqData = await groqRes.json();
    const rawText = groqData?.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      parsed = extractJSON(rawText);
    } catch (e) {
      console.error('Failed to parse model JSON:', rawText);
      return res.status(502).json({ error: 'تعذر فهم رد نموذج التحليل، حاول تاني' });
    }

    const result = {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      points: Array.isArray(parsed.points) ? parsed.points.filter(p => typeof p === 'string').slice(0, 10) : [],
      defenses: sanitizeDefenses(parsed.defenses, caseType),
      scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios.filter(s => typeof s === 'string').slice(0, 6) : [],
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error('tahlil handler error:', err);
    return res.status(500).json({ error: 'حصل خطأ غير متوقع أثناء التحليل' });
  }
}
