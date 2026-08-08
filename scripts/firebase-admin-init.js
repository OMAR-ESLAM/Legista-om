// scripts/firebase-admin-init.js
// ══════════════════════════════════════════════════════════════════════════
// تهيئة Firebase Admin SDK. السكريبتات دي بتشتغل على سيرفرات GitHub Actions
// (مش على المتصفح)، فمحتاجة صلاحيات Admin (service account) بدل الـ apiKey
// العادي. المفتاح ده بييجي من GitHub Secret اسمه FIREBASE_SERVICE_ACCOUNT
// (شرح إزاي تجيبه وتحطه في الـ README.md).
// ══════════════════════════════════════════════════════════════════════════

import admin from 'firebase-admin';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('❌ متغيّر FIREBASE_SERVICE_ACCOUNT مش موجود. راجع README.md لإعداد الـ GitHub Secret.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(raw);
} catch (e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT مش JSON صحيح.');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const messaging = admin.messaging();

// بيبعت إشعار FCM لمستخدم معيّن عن طريق التوكن المحفوظ ليه في users/{email}
// بيرجع true/false على حسب نجح ولا لأ (وبيمسح التوكن لو بقى غير صالح)
export async function sendNotificationToUser(ownerEmail, { title, body, caseId }) {
  if (!ownerEmail) return false;
  const userSnap = await db.collection('users').doc(ownerEmail).get();
  const token = userSnap.exists ? userSnap.data().fcmToken : null;
  if (!token) return false;

  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: caseId ? { caseId: String(caseId) } : {},
      webpush: {
        fcmOptions: {
          link: caseId ? `/case-file.html?case=${caseId}` : '/dashboard.html',
        },
      },
    });
    return true;
  } catch (e) {
    // لو التوكن بقى غير صالح (المستخدم مسح البيانات أو غيّر الجهاز)، نمسحه
    if (e.code === 'messaging/registration-token-not-registered') {
      await db.collection('users').doc(ownerEmail).update({ fcmToken: admin.firestore.FieldValue.delete() });
    }
    console.error(`فشل إرسال إشعار لـ ${ownerEmail}:`, e.message);
    return false;
  }
}
