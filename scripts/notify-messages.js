// scripts/notify-messages.js
// ══════════════════════════════════════════════════════════════════════════
// بيشتغل كل ٣٠ دقيقة تقريبًا (عن طريق GitHub Actions). بيفحص رسائل
// cases/{caseId}/messages اللي بعتها العميل (sender === 'client') ولسه ما
// اتبعتش عنها إشعار للمحامي، ويبعتله إشعار، ويعلّم الرسالة إنها اتبعت
// عنها إشعار (notifiedToLawyer) عشان متتكررش.
//
// ملحوظة: لو المحامي فاتح dashboard.html فعليًا وقت وصول الرسالة، هو أصلاً
// هياخد إشعار فوري جوه الصفحة (listenForegroundMessages في notifications-client.js)
// — السكريبت ده بس شبكة أمان لو هو مقفول الموقع.
// ══════════════════════════════════════════════════════════════════════════

import { db, sendNotificationToUser } from './firebase-admin-init.js';

async function run() {
  const casesSnap = await db.collection('cases').where('status', '!=', 'مغلقة').get();
  let sent = 0;

  for (const caseDoc of casesSnap.docs) {
    const c = caseDoc.data();
    const messagesSnap = await caseDoc.ref
      .collection('messages')
      .where('sender', '==', 'client')
      .get();

    const unnotified = messagesSnap.docs.filter(m => !m.data().notifiedToLawyer);
    if (unnotified.length === 0) continue;

    // لو فيه أكتر من رسالة جديدة، نبعت إشعار واحد مجمّع بدل ما نفجّر الموبايل برسايل كتير
    const title = unnotified.length === 1
      ? `💬 رسالة جديدة من موكل — ${c.title}`
      : `💬 ${unnotified.length} رسايل جديدة — ${c.title}`;
    const lastMsg = unnotified[unnotified.length - 1].data();
    const body = lastMsg.text?.slice(0, 120) || 'افتح القضية لمتابعة المحادثة';

    const ok = await sendNotificationToUser(c.ownerEmail, { title, body, caseId: caseDoc.id });
    if (ok) {
      const batch = db.batch();
      unnotified.forEach(m => batch.update(m.ref, { notifiedToLawyer: true }));
      await batch.commit();
      sent++;
    }
  }

  console.log(`✓ notify-messages: تم فحص ${casesSnap.size} قضية، اتبعت ${sent} إشعار.`);
}

run().catch((e) => {
  console.error('notify-messages فشل:', e);
  process.exit(1);
});
