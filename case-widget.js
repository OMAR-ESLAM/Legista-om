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
//       createdAt, updatedAt
//   cases/{caseId}/documents/{docId}
//     - sourceTool, templateName, content, createdAt
//   cases/{caseId}/analyses/{analysisId}
//     - summary, points, defenses[], scenarios, selectedDefenses[], createdAt
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

async function createCase({ ownerEmail, title, caseType, clientName, opponentName, courtName, status }) {
  const now = Date.now();
  const payload = {
    ownerEmail: ownerEmail || '',
    title: (title || 'قضية بدون عنوان').trim(),
    caseType: caseType || CASE_TYPES[0],
    status: status || 'نشطة',
    clientName: clientName || '',
    opponentName: opponentName || '',
    courtName: courtName || '',
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

async function deleteCaseFully(caseId) {
  try {
    for (const sub of ['documents', 'analyses', 'stages']) {
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
const STAGE_TEMPLATES = {
  'مدني': ['فحص المستندات والوقائع', 'تحرير وتقديم صحيفة الدعوى', 'إعلان الخصم', 'الجلسة الأولى ومتابعة الحضور', 'تبادل المذكرات', 'سماع الشهود (إن وجد)', 'حجز القضية للحكم', 'صدور الحكم', 'التنفيذ أو الاستئناف'],
  'جنائي': ['تحرير المحضر / البلاغ', 'التحقيق في النيابة العامة', 'الإحالة إلى المحكمة المختصة', 'الجلسة الأولى', 'تقديم مذكرة الدفاع والدفوع', 'المرافعة الختامية', 'صدور الحكم', 'الطعن بالاستئناف (إن لزم)'],
  'تجاري': ['فحص العقد والمستندات التجارية', 'الإنذار الرسمي (إن لزم)', 'تقديم صحيفة الدعوى التجارية', 'إعلان الخصم', 'الجلسة الأولى', 'ندب خبير (إن لزم)', 'المرافعة', 'صدور الحكم'],
  'أحوال شخصية': ['فحص وثائق الحالة', 'محاولة الصلح (لجنة التوفيق الأسري)', 'تقديم الدعوى لمحكمة الأسرة', 'الجلسة الأولى', 'التحقيق ومحاضر الجلسات', 'صدور الحكم'],
  'عمالي': ['فحص عقد العمل والمستندات', 'التقدم بشكوى لمكتب العمل', 'محاولة التسوية', 'تقديم الدعوى العمالية', 'الجلسة الأولى', 'صدور الحكم'],
  'إداري': ['فحص القرار الإداري المطعون فيه', 'التظلم الإداري (إن لزم)', 'تقديم دعوى الإلغاء / التعويض', 'هيئة مفوضي الدولة', 'الجلسة أمام المحكمة', 'صدور الحكم'],
  'أخرى': ['فحص الموقف القانوني', 'تحديد الإجراء المناسب', 'المتابعة حتى الحل'],
};

function getStageTemplate(caseType) {
  return STAGE_TEMPLATES[caseType] || STAGE_TEMPLATES['أخرى'];
}

// بيحمّل خطة المراحل الافتراضية جوه القضية (أول مرحلة "جارية"، والباقي "لسه ماجاش عليها")
async function seedStagesFromTemplate(caseId, caseType) {
  const titles = getStageTemplate(caseType);
  const created = [];
  for (let i = 0; i < titles.length; i++) {
    const row = await addSubDoc(caseId, 'stages', {
      title: titles[i], order: i,
      status: i === 0 ? 'جارية' : 'لسه',
      isAuto: false, note: '',
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
  if (next) await updateSubDoc(caseId, 'stages', next.id, { status: 'جارية' });
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
  CASE_TYPES, CASE_STATUSES, STAGE_TEMPLATES,
  escapeHTML, toast,
  listCases, getCase, createCase, updateCase, deleteCaseFully,
  listSub, addSubDoc, updateSubDoc, deleteSubDoc,
  saveDocumentToCase, saveAnalysisToCase, openSaveToCasePicker,
  getStageTemplate, seedStagesFromTemplate, advanceAfterStage,
};
