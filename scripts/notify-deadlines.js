// scripts/notify-deadlines.js
// ══════════════════════════════════════════════════════════════════════════
// بيشتغل مرة واحدة يوميًا (عن طريق GitHub Actions). بيقرأ نفس الحقل
// deadlineStatus اللي أصلاً بيتزامن جوه case-file.html — من غير ما يعيد
// حساب أي حاجة تانية — ويبعت إشعار FCM للمحامي صاحب كل قضية فيها ميعاد
// "قرب" أو "فات".
//
// عشان محدش ياخد نفس الإشعار كل يوم من غير داعي، بنسجّل آخر حالة
// اتبعتلها إشعار (lastDeadlineNotifiedStatus) وبنبعت بس لو الحالة اتغيّرت.
// ══════════════════════════════════════════════════════════════════════════

import { db, sendNotificationToUser } from './firebase-admin-init.js';

async function run() {
  const snap = await db.collection('cases').where('status', '!=', 'مغلقة').get();
  let sent = 0;

  for (const docSnap of snap.docs) {
    const c = docSnap.data();
    const status = c.deadlineStatus; // 'overdue' | 'soon' | 'ok' | null

    if (status !== 'overdue' && status !== 'soon') continue;
    if (c.lastDeadlineNotifiedStatus === status) continue; // اتبعت قبل كده لنفس الحالة، متبعتش تاني

    const title = status === 'overdue'
      ? `⏰ فات ميعاد قانوني — ${c.title}`
      : `⏰ ميعاد قانوني قرب — ${c.title}`;
    const body = c.deadlineStageTitle || c.currentStageTitle || 'راجع القضية لمعرفة التفاصيل';

    const ok = await sendNotificationToUser(c.ownerEmail, { title, body, caseId: docSnap.id });
    if (ok) {
      await docSnap.ref.update({ lastDeadlineNotifiedStatus: status });
      sent++;
    }
  }

  console.log(`✓ notify-deadlines: تم فحص ${snap.size} قضية، اتبعت ${sent} إشعار.`);
}

run().catch((e) => {
  console.error('notify-deadlines فشل:', e);
  process.exit(1);
});
