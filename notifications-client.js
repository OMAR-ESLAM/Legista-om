// notifications-client.js
// ══════════════════════════════════════════════════════════════════════════
// وحدة مشتركة لتفعيل إشعارات الموبايل (FCM) وربطها بحساب المحامي.
// تُستخدم من dashboard.html (وممكن كمان من case-file.html).
//
// بنية البيانات الجديدة في Firestore:
//   users/{ownerEmail}
//     - fcmToken (آخر token مسجّل للجهاز)
//     - updatedAt
//
// عشان الإشعارات تشتغل، لازم:
//   1) firebase-messaging-sw.js يكون في جذر الموقع (بجوار index.html)
//   2) تحط الـ VAPID key بتاعك مكان VAPID_KEY_PLACEHOLDER تحت
//      (Firebase Console → Project settings → Cloud Messaging →
//       Web Push certificates → Generate key pair)
// ══════════════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyC6PRK7EECoPF3qDawVSRYmMg0uufTs6Xw",
  authDomain: "legista-o.firebaseapp.com",
  projectId: "legista-o",
  messagingSenderId: "964258159036",
  appId: "1:964258159036:web:a3a66d4f5ea38f9964f3b9"
};

// ⚠️ لازم تستبدل السطر ده بالـ VAPID key بتاعك من Firebase Console
const VAPID_KEY = "BHCAWaNf0A2_ZyqgIOq3uazes6foUBiw1vNwZRmOePBA6MSLp25CBpqetvI1HO7DQa_U6NjWOIiqv3zy8nLFQ6w";

const APP_NAME = "legista-notifications";
const app = getApps().find(a => a.name === APP_NAME) || initializeApp(firebaseConfig, APP_NAME);
const db = getFirestore(app);

// بيطلب إذن الإشعارات من المستخدم، وبيسجّل الـ Service Worker،
// وبيحفظ الـ FCM token بتاعه في Firestore عشان GitHub Actions تقدر تبعتله لاحقًا.
async function enableNotifications(ownerEmail) {
  if (!ownerEmail) return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.warn('المتصفح ده مش بيدعم إشعارات الويب');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      window.CaseWidget?.toast('لازم توافق على الإشعارات عشان توصلك تنبيهات المواعيد');
      return false;
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      window.CaseWidget?.toast('تعذّر تفعيل الإشعارات، جرب تاني');
      return false;
    }

    await setDoc(doc(db, 'users', ownerEmail), {
      fcmToken: token,
      updatedAt: Date.now(),
    }, { merge: true });

    window.CaseWidget?.toast('تم تفعيل الإشعارات ✓');
    return true;
  } catch (e) {
    console.error('enableNotifications error', e);
    window.CaseWidget?.toast('حصل خطأ أثناء تفعيل الإشعارات');
    return false;
  }
}

// إشعار داخل الصفحة نفسها لو المحامي فاتح الموقع فعليًا وقت وصول الإشعار
// (منفصل عن إشعار الموبايل اللي بيظهره الـ Service Worker وقت الموقع مقفول)
function listenForegroundMessages(onMessageReceived) {
  const messaging = getMessaging(app);
  onMessage(messaging, (payload) => {
    if (onMessageReceived) onMessageReceived(payload);
    else window.CaseWidget?.toast(payload.notification?.title || 'إشعار جديد');
  });
}

// بيرجع 'granted' | 'denied' | 'default' — تقدر تستخدمها عشان تعرض زرار
// "فعّل الإشعارات" بس لو لسه الإذن مش متاخد
function getNotificationPermissionState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

window.LegistaNotifications = {
  enableNotifications,
  listenForegroundMessages,
  getNotificationPermissionState,
};
