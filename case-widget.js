// case-widget.js
// ══════════════════════════════════════════════════════════════════════════
// وحدة مشتركة للتعامل مع Firestore الخاص بنظام "ملف القضية" الموحّد.
// تُستخدم من case-file.html، وكمان (لاحقًا) من الأربع صفحات:
// tahlil.html / 3oqood.html / junah.html / inzarat.html
// عشان تقدر تحفظ نتايجها داخل قضية بدل ما تكون معزولة.
//
// بنية البيانات في Firestore:
//   cases/{caseId}
//     - ownerEmail, title, caseType, status,
//       clientName, opponentName, courtName,
//       caseNumber (رقم الدعوى/القضية), policeStation (القسم/مركز الشرطة المحرر فيه المحضر — جنائي غالبًا),
//       tags (مصفوفة تصنيفات نصية), quickNotes (ملاحظات حرة سريعة),
//       feeAgreed (الأتعاب المتفق عليها), paymentsTotal (إجمالي المدفوع — متزامن من subcollection payments),
//       nextHearingDate (أقرب جلسة قادمة — متزامنة من subcollection hearings),
//       stageProgress ({done,total}), currentStageTitle,
//       deadlineStatus ('overdue'|'soon'|'ok'|null), deadlineDate, deadlineStageTitle (متزامنين من مرحلة "جارية" الحالية),
//       createdAt, updatedAt
//   cases/{caseId}/documents/{docId}
//     - sourceTool, templateName, content, createdAt
//   cases/{caseId}/analyses/{analysisId}
//     - summary, points, defenses[], scenarios, selectedDefenses[], createdAt
//   cases/{caseId}/stages/{stageId}
//     - title, order, status ('لسه'|'جارية'|'مكتملة'), isAuto, note,
//       isDecision (true لمرحلة قرار النيابة في القضايا الجنائية), branch,
//       deadlineDays (عدد أيام الميعاد القانوني من بداية المرحلة، اختياري), startedAt (وقت ما بقت "جارية"),
//       createdAt
//   cases/{caseId}/evidence/{evidenceId}
//     - kind ('محضر'|'حكم'|'عقد'|'أخرى'), name, mimeType, data (base64 مضغوط),
//       notes (ملاحظات المحامي), gapAnalysis (نتيجة تحليل الذكاء الاصطناعي للثغرات إن وُجدت), createdAt
//   cases/{caseId}/hearings/{hearingId}
//     - date (تاريخ الجلسة), notes (اللي حصل فيها), decision (القرار/التأجيل), nextHearingDate, createdAt
//   cases/{caseId}/payments/{paymentId}
//     - amount, date, note, createdAt
// ══════════════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc,
  deleteDoc, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC6PRK7EECoPF3qDawVSRYmMg0uufTs6Xw",
  authDomain: "legista-o.firebaseapp.com",
  projectId: "legista-o",
  appId: "1:964258159036:web:a3a66d4f5ea38f9964f3b9"
};

// اسم مخصص لتفادي أي تعارض لو الصفحة عندها فعلًا instance تاني باسم "legista-site"
const APP_NAME = "legista-case-widget";
const app = getApps().find(a => a.name === APP_NAME) || initializeApp(firebaseConfig, APP_NAME);
const db = getFirestore(app);

// ═══ ثوابت ═══
const CASE_TYPES = ['مدني', 'جنائي', 'تجاري', 'أحوال شخصية', 'عمالي', 'إداري', 'أخرى'];
const CASE_STATUSES = ['نشطة', 'معلّقة', 'مغلقة'];
const DEADLINE_SOON_DAYS = 3; // لو باقي على الميعاد ٣ أيام أو أقل بيتحول لتنبيه "قرب"

// ═══ مهن مكتب المحاماة — كل مهنة ليها تابات/أقسام خاصة بيها في بوابة الموظف ═══
const STAFF_ROLES = [
  { key: 'partner',          label: 'محامي شريك',            tabs: ['كل القضايا', 'التقارير المالية', 'إدارة الموظفين', 'الجلسات القادمة', 'المواعيد القانونية'] },
  { key: 'lawyer',           label: 'محامي',                  tabs: ['قضاياي', 'الجلسات القادمة', 'المستندات', 'بوابة العميل', 'مهامي اليوم'] },
  { key: 'trainee',          label: 'محامي تحت التمرين',       tabs: ['مهامي اليوم', 'الجلسات اللي هحضرها', 'تجهيز المستندات', 'مشاويري بالمحاكم'] },
  { key: 'secretary',        label: 'سكرتير / سكرتيرة المكتب', tabs: ['جدول المواعيد', 'رسائل العملاء', 'تنبيهات المواعيد', 'بيانات العملاء'] },
  { key: 'accountant',       label: 'محاسب المكتب',           tabs: ['الأتعاب والدفعات', 'المصروفات', 'الفواتير'] },
  { key: 'office_manager',   label: 'مدير المكتب',            tabs: ['نظرة عامة على القضايا', 'إدارة الموظفين', 'التقارير'] },
  { key: 'court_clerk',      label: 'مندوب محاكم',            tabs: ['مشاويري اليوم', 'مواعيد التسليم والاستلام', 'الجلسات القريبة'] },
  { key: 'legal_researcher', label: 'باحث قانوني',            tabs: ['التحليل والدفوع', 'المرفقات والأدلة', 'مهامي اليوم'] },
  { key: 'client_relations', label: 'مسؤول علاقات العملاء',   tabs: ['بوابة العميل', 'طلبات جديدة', 'رسائل العملاء'] },
  { key: 'reviewer',         label: 'مراجع مستندات',          tabs: ['مستندات للمراجعة', 'مهامي اليوم'] },
];
function getRoleDef(roleKey) {
  return STAFF_ROLES.find(r => r.key === roleKey) || null;
}

// ═══ أدوات مساعدة عامة ═══
function escapeHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureToastEl() {
  let t = document.getElementById('cwToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'cwToast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:#1A1A2E;color:#fff;padding:12px 22px;border-radius:10px;font-size:13px;' +
      'font-weight:700;font-family:Cairo,sans-serif;z-index:99999;opacity:0;pointer-events:none;' +
      'transition:opacity .25s, transform .25s;white-space:nowrap;max-width:90vw;text-align:center;';
    document.body.appendChild(t);
  }
  return t;
}
function toast(msg) {
  const t = ensureToastEl();
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(-6px)';
  clearTimeout(window._cwToastTimer);
  window._cwToastTimer = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(0)';
  }, 2600);
}

function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  return v;
}

// بتحسب حالة الميعاد القانوني لمرحلة معينة بناءً على تاريخ بداية المرحلة + عدد أيام الميعاد
// بترجع null لو مفيش ميعاد متحدد للمرحلة دي، أو { dueDate, daysLeft, status } لو موجود
// status: 'overdue' (فات) | 'soon' (قرب، DEADLINE_SOON_DAYS أيام أو أقل) | 'ok' (لسه في وقت)
function computeDeadlineInfo(stage) {
  if (!stage || !stage.deadlineDays || !stage.startedAt) return null;
  const start = toMillis(stage.startedAt);
  const dueDate = start + stage.deadlineDays * 86400000;
  const now = Date.now();
  const daysLeft = Math.ceil((dueDate - now) / 86400000);
  let status = 'ok';
  if (now > dueDate) status = 'overdue';
  else if (daysLeft <= DEADLINE_SOON_DAYS) status = 'soon';
  return { dueDate, daysLeft, status };
}

// ═══ CASES ═══

async function listCases(ownerEmail) {
  if (!ownerEmail) return [];
  try {
    const q = query(collection(db, 'cases'), where('ownerEmail', '==', ownerEmail));
    const snap = await getDocs(q);
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
    return rows;
  } catch (e) {
    console.error('CaseWidget.listCases error', e);
    toast('تعذّر تحميل القضايا');
    return [];
  }
}

async function getCase(caseId) {
  try {
    const snap = await getDoc(doc(db, 'cases', caseId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    console.error('CaseWidget.getCase error', e);
    return null;
  }
}

async function createCase({ ownerEmail, title, caseType, clientName, opponentName, courtName, caseNumber, policeStation, status, tags }) {
  const now = Date.now();
  const payload = {
    ownerEmail: ownerEmail || '',
    title: (title || 'قضية بدون عنوان').trim(),
    caseType: caseType || CASE_TYPES[0],
    status: status || 'نشطة',
    clientName: clientName || '',
    opponentName: opponentName || '',
    courtName: courtName || '',
    caseNumber: caseNumber || '',
    policeStation: policeStation || '',
    tags: tags || [],
    quickNotes: '',
    feeAgreed: 0,
    paymentsTotal: 0,
    nextHearingDate: '',
    createdAt: now,
    updatedAt: now,
  };
  const ref = await addDoc(collection(db, 'cases'), payload);
  toast('تم إنشاء القضية ✓');
  return { id: ref.id, ...payload };
}

async function updateCase(caseId, fields) {
  try {
    await updateDoc(doc(db, 'cases', caseId), { ...fields, updatedAt: Date.now() });
    return true;
  } catch (e) {
    console.error('CaseWidget.updateCase error', e);
    toast('حصل خطأ أثناء الحفظ');
    return false;
  }
}

// تثبيت/إلغاء تثبيت قضية فوق قايمة الداشبورد — من غير ما نلمس updatedAt
// (عشان تثبيت قضية ما يخليهاش تقفز فوق قسم "آخر تحديث" وهي مالهاش تحديث فعلي)
async function setCasePinned(caseId, pinned) {
  try {
    await updateDoc(doc(db, 'cases', caseId), { pinned: !!pinned });
    return true;
  } catch (e) {
    console.error('CaseWidget.setCasePinned error', e);
    toast('حصل خطأ أثناء التثبيت');
    return false;
  }
}

async function deleteCaseFully(caseId) {
  try {
    for (const sub of ['documents', 'analyses', 'stages', 'evidence', 'hearings', 'payments']) {
      const snap = await getDocs(collection(db, 'cases', caseId, sub));
      if (snap.docs.length) {
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(doc(db, 'cases', caseId));
    toast('تم حذف القضية ✓');
    return true;
  } catch (e) {
    console.error('CaseWidget.deleteCaseFully error', e);
    toast('حصل خطأ أثناء حذف القضية');
    return false;
  }
}

// ═══ SUBCOLLECTIONS: documents / analyses ═══

async function listSub(caseId, subName) {
  try {
    const snap = await getDocs(collection(db, 'cases', caseId, subName));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return rows;
  } catch (e) {
    console.error('CaseWidget.listSub error', e);
    return [];
  }
}

async function addSubDoc(caseId, subName, data) {
  const payload = { ...data, createdAt: Date.now() };
  const ref = await addDoc(collection(db, 'cases', caseId, subName), payload);
  updateDoc(doc(db, 'cases', caseId), { updatedAt: Date.now() }).catch(() => {});
  return { id: ref.id, ...payload };
}

async function updateSubDoc(caseId, subName, docId, fields) {
  try {
    await updateDoc(doc(db, 'cases', caseId, subName, docId), fields);
    return true;
  } catch (e) {
    console.error('CaseWidget.updateSubDoc error', e);
    return false;
  }
}

async function deleteSubDoc(caseId, subName, docId) {
  try {
    await deleteDoc(doc(db, 'cases', caseId, subName, docId));
    return true;
  } catch (e) {
    console.error('CaseWidget.deleteSubDoc error', e);
    return false;
  }
}

// ═══ مراحل القضية (workflow) ═══
// خطة افتراضية مقترحة لكل نوع قضية — المحامي يقدر يحمّلها كنقطة بداية،
// وبعدين يعدّل/يضيف/يحذف مراحله الخاصة بحرية كاملة.
// ملحوظة: القضايا الجنائية فيها نقطة تفرّع حقيقية (قرار النيابة: حفظ أم إحالة)،
// فمش كل القضايا بتكمل بنفس المسار بعدها — ده بيتحدد ديناميكيًا بعد قرار النيابة
// عن طريق branchStagesAfterDecision تحت، مش جزء ثابت من القالب.
const DECISION_STAGE_TITLE = 'قرار النيابة: حفظ التحقيق أم الإحالة إلى المحكمة؟';

const STAGE_TEMPLATES = {
  'مدني': [
    'فحص المستندات والوقائع وتحديد سند الدعوى',
    'تحرير وتقديم صحيفة الدعوى وقيدها بالمحكمة المختصة',
    'سداد الرسوم القضائية وإعلان الخصم بالصحيفة',
    'الجلسة الأولى ومتابعة الحضور والغياب',
    'تبادل المذكرات والمستندات بين الخصوم',
    'ندب خبير (إن لزم) ومتابعة تقرير الخبرة',
    'سماع الشهود (إن وجد)',
    'المرافعة الختامية وحجز القضية للحكم',
    'صدور الحكم',
    'التنفيذ الجبري أو الطعن بالاستئناف خلال المواعيد القانونية',
  ],
  'جنائي': [
    'تحرير المحضر بمعرفة الشرطة أو تقديم البلاغ للنيابة مباشرة',
    'عرض المحضر على النيابة العامة والتحقيق (استجواب، سماع شهود، معاينة)',
    DECISION_STAGE_TITLE,
    // الخطوات اللي بعد كده بتتحدد تلقائيًا حسب قرار النيابة (حفظ / إحالة) — شوف BRANCH_TEMPLATES
  ],
  'تجاري': [
    'فحص العقد والمستندات التجارية وتحديد سند المطالبة',
    'توجيه إنذار رسمي على يد محضر (إجراء غالبًا لازم قبل رفع الدعوى التجارية)',
    'تحرير وتقديم صحيفة الدعوى التجارية وقيدها',
    'إعلان الخصم ومتابعة الجلسة الأولى',
    'ندب خبير حسابي/فني (شائع جدًا في المنازعات التجارية)',
    'تبادل المذكرات والمرافعة',
    'صدور الحكم',
    'التنفيذ أو الطعن بالاستئناف',
  ],
  'أحوال شخصية': [
    'فحص وثائق الحالة (عقد الزواج، قسائم الطلاق، مستندات النسب أو النفقة)',
    'التوجه للجنة تسوية المنازعات الأسرية (إجراء إلزامي قبل رفع أغلب دعاوى الأسرة)',
    'محضر عدم التسوية (لو فشلت المحاولة) وتقديم الدعوى لمحكمة الأسرة',
    'الجلسة الأولى ومتابعة الإعلانات',
    'التحقيق ومحاضر الجلسات (سماع شهود، مأمورية إن لزم)',
    'صدور الحكم',
    'الطعن أمام محكمة استئناف الأسرة (إن لزم)',
  ],
  'عمالي': [
    'فحص عقد العمل والمستندات (تأمينات، مفردات مرتب، إنذارات)',
    'التقدم بشكوى لمكتب العمل المختص ومحاولة التسوية الودية',
    'محضر عدم التسوية (لو فشلت التسوية الودية) خلال المدة القانونية',
    'تقديم الدعوى العمالية للمحكمة العمالية المختصة',
    'الجلسة الأولى ومتابعة الحضور',
    'تبادل المذكرات والمرافعة',
    'صدور الحكم',
  ],
  'إداري': [
    'فحص القرار الإداري المطعون فيه وتاريخ العلم اليقيني به',
    'التظلم الإداري (اختياري، وبيوقف ميعاد الطعن القضائي مؤقتًا)',
    'تقديم دعوى الإلغاء أو التعويض أمام مجلس الدولة خلال المواعيد القانونية',
    'عرض الدعوى على هيئة مفوضي الدولة وإعداد التقرير',
    'الجلسة أمام المحكمة الإدارية المختصة',
    'صدور الحكم',
    'الطعن بالنقض أمام المحكمة الإدارية العليا (إن لزم)',
  ],
  'أخرى': ['فحص الموقف القانوني وتحديد الجهة المختصة', 'تحديد الإجراء المناسب واتخاذه', 'المتابعة حتى الحل'],
};

// خطط الفروع بعد قرار النيابة في القضايا الجنائية
const BRANCH_TEMPLATES = {
  // النيابة قررت إحالة القضية للمحكمة المختصة
  referral: [
    'الإحالة إلى المحكمة المختصة وقيد الجنحة/الجناية',
    'الجلسة الأولى ومتابعة الحضور',
    'تقديم مذكرة الدفاع والدفوع',
    'سماع الشهود والمرافعة',
    'صدور الحكم',
    'الطعن بالاستئناف خلال المواعيد القانونية (إن لزم)',
  ],
  // النيابة قررت حفظ التحقيق
  dismissal: [
    'كتابة وتقديم التظلم من قرار الحفظ لرئاسة النيابة المختصة',
    'متابعة الرد على التظلم',
    'تحريك الدعوى الجنائية بطريق الادعاء المباشر (لو استمر الحفظ ورأى المحامي أن الأدلة كافية)',
  ],
};

function getStageTemplate(caseType) {
  return STAGE_TEMPLATES[caseType] || STAGE_TEMPLATES['أخرى'];
}

// بيحمّل خطة المراحل الافتراضية جوه القضية (أول مرحلة "جارية"، والباقي "لسه ماجاش عليها")
async function seedStagesFromTemplate(caseId, caseType) {
  const titles = getStageTemplate(caseType);
  const now = Date.now();
  const created = [];
  for (let i = 0; i < titles.length; i++) {
    const row = await addSubDoc(caseId, 'stages', {
      title: titles[i], order: i,
      status: i === 0 ? 'جارية' : 'لسه',
      isAuto: false, note: '',
      isDecision: titles[i] === DECISION_STAGE_TITLE,
      deadlineDays: null,
      startedAt: i === 0 ? now : null,
    });
    created.push(row);
  }
  return created;
}

// بعد ما مرحلة تخلص، بيفعّل اللي بعدها تلقائيًا (لو كانت لسه معلّقة)
async function advanceAfterStage(caseId, finishedOrder) {
  const stages = await listSub(caseId, 'stages');
  stages.sort((a, b) => a.order - b.order);
  const next = stages.find(s => s.order > finishedOrder && s.status === 'لسه');
  if (next) await updateSubDoc(caseId, 'stages', next.id, { status: 'جارية', startedAt: Date.now() });
}

// بعد قرار النيابة (حفظ/إحالة)، بنمسح أي مراحل قديمة بعد نقطة القرار (لو اتغيّر القرار)
// ونضيف مسار الفرع الصحيح، أول مرحلة فيه بتبقى "جارية" تلقائيًا
async function branchStagesAfterDecision(caseId, decisionOrder, branchKey) {
  const titles = BRANCH_TEMPLATES[branchKey] || [];
  const existing = await listSub(caseId, 'stages');
  const stale = existing.filter(s => s.order > decisionOrder);
  for (const s of stale) await deleteSubDoc(caseId, 'stages', s.id);
  const now = Date.now();
  const created = [];
  for (let i = 0; i < titles.length; i++) {
    const row = await addSubDoc(caseId, 'stages', {
      title: titles[i], order: decisionOrder + i + 1,
      status: i === 0 ? 'جارية' : 'لسه',
      isAuto: false, note: '', branch: branchKey,
      deadlineDays: null,
      startedAt: i === 0 ? now : null,
    });
    created.push(row);
  }
  return created;
}

// ═══ لوحة التحكم (Dashboard) ═══
// بتجمّع من فوق بيانات القضايا المتزامنة (deadlineStatus / nextHearingDate / updatedAt...)
// من غير ما تعمل قراءة إضافية لكل subcollection — الاعتماد على إن case-file.html
// بيزامن الحقول دي كل ما تتغير مرحلة أو جلسة أو دفعة.
async function getDashboardSummary(ownerEmail) {
  const cases = await listCases(ownerEmail);
  const openCases = cases.filter(c => c.status !== 'مغلقة');

  const deadlines = openCases
    .filter(c => c.deadlineStatus === 'overdue' || c.deadlineStatus === 'soon')
    .map(c => ({
      caseId: c.id, caseTitle: c.title, stageTitle: c.deadlineStageTitle || c.currentStageTitle || '',
      dueDate: c.deadlineDate || null, status: c.deadlineStatus,
    }))
    .sort((a, b) => (a.status === b.status ? (a.dueDate || 0) - (b.dueDate || 0) : (a.status === 'overdue' ? -1 : 1)));

  const now = Date.now();
  const upcomingHearings = openCases
    .filter(c => c.nextHearingDate && new Date(c.nextHearingDate).getTime() >= now - 86400000)
    .map(c => ({ caseId: c.id, caseTitle: c.title, date: c.nextHearingDate }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const recentlyUpdated = [...cases].sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)).slice(0, 8);

  return {
    totalActive: cases.filter(c => c.status === 'نشطة').length,
    totalPending: cases.filter(c => c.status === 'معلّقة').length,
    deadlines, upcomingHearings, recentlyUpdated,
  };
}

// ═══ الموظفين (Staff) ═══
// staff/{staffId}: officeEmail (صاحب المكتب), name, role (مفتاح من STAFF_ROLES), phone, createdAt

async function createStaff(officeEmail, { name, role, phone }) {
  const payload = {
    officeEmail: officeEmail || '',
    name: (name || '').trim(),
    role: role || STAFF_ROLES[0].key,
    phone: (phone || '').trim(),
    createdAt: Date.now(),
  };
  const ref = await addDoc(collection(db, 'staff'), payload);
  toast('تم إضافة الموظف ✓');
  return { id: ref.id, ...payload };
}

async function listStaff(officeEmail) {
  if (!officeEmail) return [];
  try {
    const q = query(collection(db, 'staff'), where('officeEmail', '==', officeEmail));
    const snap = await getDocs(q);
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return rows;
  } catch (e) {
    console.error('CaseWidget.listStaff error', e);
    return [];
  }
}

async function getStaff(staffId) {
  try {
    const snap = await getDoc(doc(db, 'staff', staffId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    console.error('CaseWidget.getStaff error', e);
    return null;
  }
}

async function updateStaff(staffId, fields) {
  try {
    await updateDoc(doc(db, 'staff', staffId), fields);
    return true;
  } catch (e) {
    console.error('CaseWidget.updateStaff error', e);
    toast('حصل خطأ أثناء الحفظ');
    return false;
  }
}

async function deleteStaff(staffId) {
  try {
    await deleteDoc(doc(db, 'staff', staffId));
    toast('تم حذف الموظف ✓');
    return true;
  } catch (e) {
    console.error('CaseWidget.deleteStaff error', e);
    toast('حصل خطأ أثناء الحذف');
    return false;
  }
}

// ═══ مهام يومية شخصية (Personal Tasks) ═══
// بتستخدم لصاحب المكتب (ownerId = الإيميل) ولكل موظف (ownerId = staffId) بنفس الشكل.
// personalTasks/{taskId}: ownerId, text, done, createdAt

async function listTasks(ownerId) {
  if (!ownerId) return [];
  try {
    const q = query(collection(db, 'personalTasks'), where('ownerId', '==', ownerId));
    const snap = await getDocs(q);
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    return rows;
  } catch (e) {
    console.error('CaseWidget.listTasks error', e);
    return [];
  }
}

async function addTask(ownerId, text) {
  if (!text || !text.trim()) return null;
  const payload = { ownerId, text: text.trim(), done: false, createdAt: Date.now() };
  const ref = await addDoc(collection(db, 'personalTasks'), payload);
  return { id: ref.id, ...payload };
}

async function toggleTask(taskId, done) {
  try {
    await updateDoc(doc(db, 'personalTasks', taskId), { done: !!done });
    return true;
  } catch (e) {
    console.error('CaseWidget.toggleTask error', e);
    return false;
  }
}

async function deleteTask(taskId) {
  try {
    await deleteDoc(doc(db, 'personalTasks', taskId));
    return true;
  } catch (e) {
    console.error('CaseWidget.deleteTask error', e);
    return false;
  }
}

// ═══ اختصارات لصفحات الأدوات الأربعة (عقود / إنذارات / جنح / تحليل) ═══
// دي الدوال اللي زرار "حفظ في ملف قضية" في كل أداة هيناديها.

function saveDocumentToCase(caseId, { sourceTool, templateName, content }) {
  return addSubDoc(caseId, 'documents', {
    sourceTool: sourceTool || '',
    templateName: templateName || '',
    content: content || '',
  });
}

function saveAnalysisToCase(caseId, analysisData) {
  return addSubDoc(caseId, 'analyses', {
    ...analysisData,
    selectedDefenses: analysisData.selectedDefenses || [],
  });
}

// حفظ مستند/صورة دليل (زي صورة محضر، حكم، عقد) في القضية
function saveEvidenceToCase(caseId, { kind, name, mimeType, data, notes, gapAnalysis }) {
  return addSubDoc(caseId, 'evidence', {
    kind: kind || 'أخرى',
    name: name || '',
    mimeType: mimeType || '',
    data: data || '',
    notes: notes || '',
    gapAnalysis: gapAnalysis || null,
  });
}

// ═══ بوابة العميل (Client Portal) ═══
// cases/{caseId}/portalRequests/{id}: مستند مطلوب من العميل
//   - title, note, status ('pending'|'uploaded'), fileName, mimeType, data (base64), uploadedAt, createdAt
// cases/{caseId}/messages/{id}: رسائل بين المحامي والعميل
//   - sender ('lawyer'|'client'), text, createdAt

// المحامي بيطلب مستند من العميل (بيظهر في بوابة العميل كطلب "معلّق")
function requestDocumentFromClient(caseId, { title, note }) {
  return addSubDoc(caseId, 'portalRequests', {
    title: (title || '').trim(),
    note: (note || '').trim(),
    status: 'pending',
    fileName: '', mimeType: '', data: '', uploadedAt: null,
  });
}

// العميل بيرفع المستند اللي اتطلب منه
function uploadClientDocument(caseId, requestId, { fileName, mimeType, data }) {
  return updateSubDoc(caseId, 'portalRequests', requestId, {
    status: 'uploaded',
    fileName: fileName || '', mimeType: mimeType || '', data: data || '',
    uploadedAt: Date.now(),
  });
}

// إرسال رسالة في بوابة العميل — من المحامي أو من العميل
function sendPortalMessage(caseId, { sender, text }) {
  if (!text || !text.trim()) return null;
  return addSubDoc(caseId, 'messages', { sender: sender === 'client' ? 'client' : 'lawyer', text: text.trim() });
}

// واجهة بسيطة (prompt-based) لاختيار قضية موجودة أو إنشاء واحدة جديدة بسرعة،
// عشان الأربع أدوات تستخدمها من غير ما تبني UI منفصل لكل واحدة.
// onSave: async (caseId) => { ... } بتتنفذ بعد ما يتحدد caseId.
async function openSaveToCasePicker({ ownerEmail, onSave }) {
  if (!ownerEmail) {
    toast('سجّل الدخول أولاً عشان تقدر تحفظ في ملف قضية');
    return null;
  }
  const cases = await listCases(ownerEmail);
  const listText = cases.length
    ? 'قضاياك الحالية:\n' + cases.map((c, i) => `${i + 1}. ${c.title}`).join('\n') +
      '\n\nاكتب رقم القضية اللي هتحفظ فيها، أو اكتب اسم جديد عشان تتعمل قضية جديدة تلقائي:'
    : 'مفيش قضايا محفوظة لسه. اكتب اسم أول قضية عشان تتعمل تلقائي:';
  const choice = prompt(listText);
  if (!choice || !choice.trim()) return null;

  let caseId;
  const asIndex = parseInt(choice.trim(), 10);
  if (!isNaN(asIndex) && cases[asIndex - 1]) {
    caseId = cases[asIndex - 1].id;
  } else {
    const created = await createCase({ ownerEmail, title: choice.trim() });
    caseId = created.id;
  }

  if (onSave) await onSave(caseId);
  return caseId;
}

window.CaseWidget = {
  CASE_TYPES, CASE_STATUSES, STAGE_TEMPLATES, BRANCH_TEMPLATES, DECISION_STAGE_TITLE, DEADLINE_SOON_DAYS,
  STAFF_ROLES, getRoleDef,
  escapeHTML, toast, toMillis,
  listCases, getCase, createCase, updateCase, setCasePinned, deleteCaseFully,
  listSub, addSubDoc, updateSubDoc, deleteSubDoc,
  saveDocumentToCase, saveAnalysisToCase, saveEvidenceToCase, openSaveToCasePicker,
  getStageTemplate, seedStagesFromTemplate, advanceAfterStage, branchStagesAfterDecision,
  computeDeadlineInfo, getDashboardSummary,
  requestDocumentFromClient, uploadClientDocument, sendPortalMessage,
  createStaff, listStaff, getStaff, updateStaff, deleteStaff,
  listTasks, addTask, toggleTask, deleteTask,
};
