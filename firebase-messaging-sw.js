// firebase-messaging-sw.js
// ══════════════════════════════════════════════════════════════════════════
// Service Worker مسؤوليته الوحيدة: استقبال إشعارات FCM وعرضها على الجهاز،
// حتى لو المتصفح/الموقع مقفول تمامًا. لازم يكون في جذر الموقع
// (نفس مكان index.html) عشان يقدر يسجّل نفسه لكل صفحات الموقع.
//
// ملحوظة: الملف ده لازم يفضل بنفس الاسم "firebase-messaging-sw.js"
// وفي جذر الدومين — مينفعش تحطه في مجلد فرعي أو تغيّر اسمه.
// ══════════════════════════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC6PRK7EECoPF3qDawVSRYmMg0uufTs6Xw",
  authDomain: "legista-o.firebaseapp.com",
  projectId: "legista-o",
  messagingSenderId: "964258159036",
  appId: "1:964258159036:web:a3a66d4f5ea38f9964f3b9"
});

const messaging = firebase.messaging();

// بيتنفذ لما يوصل إشعار والموقع/المتصفح مقفول (أو التبويب في الخلفية)
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'LEGISTA';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/icon-192.png', // غيّرها لمسار أيقونة موقعك لو مختلف
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    data: (payload.data) || {},
  };
  self.registration.showNotification(title, options);
});

// لما المستخدم يدوس على الإشعار، نوديه مباشرة لملف القضية المعنية
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const caseId = event.notification.data && event.notification.data.caseId;
  const url = caseId ? `/case-file.html?case=${caseId}` : '/dashboard.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url.split('?')[0]) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
