// office-gate.js — قفل باصورد على أدوات المكتب (welcome.html / dashboard.html / case-file.html / staff.html)
// يتحقق بعد تسجيل الدخول بجوجل (legista_user). أول مرة يخليك تعمل باصورد لحسابك، وبعد كده
// يطلبه في كل زيارة. على الموبايل، بعد أول فتح ناجح، بيعرض تفعيل بصمة الجهاز عشان الزيارات الجاية
// تتفتح بالبصمة بدل الباصورد على نفس التليفون بس (ده قفل جهاز، مش تحقق سيرفر حقيقي بالبصمة).

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyC6PRK7EECoPF3qDawVSRYmMg0uufTs6Xw",
  authDomain: "legista-o.firebaseapp.com",
  projectId: "legista-o",
  appId: "1:964258159036:web:a3a66d4f5ea38f9964f3b9"
};
const app = getApps().find(a => a.name === 'legista-gate') || initializeApp(firebaseConfig, 'legista-gate');
const db = getFirestore(app);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function unlockKey(email) { return 'legista_office_unlocked_' + email; }
function credKey(email) { return 'legista_office_cred_' + email; }

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function biometricAvailable() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) {
    return false;
  }
}

function injectStyles() {
  if (document.getElementById('officeGateStyles')) return;
  const s = document.createElement('style');
  s.id = 'officeGateStyles';
  s.textContent = `
  #officeGateOverlay{position:fixed;inset:0;background:#0A0A0D;display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;}
  .og-card{max-width:360px;width:100%;background:#121217;border:1px solid rgba(212,175,55,0.18);border-radius:18px;padding:32px 26px;text-align:center;font-family:'Cairo',sans-serif;color:#fff;}
  .og-icon{font-size:34px;margin-bottom:10px;}
  .og-title{font-size:16px;font-weight:900;margin-bottom:6px;}
  .og-sub{font-size:12px;color:#8A8A8F;margin-bottom:18px;line-height:1.7;}
  .og-input{width:100%;background:#1A1A22;border:1px solid rgba(212,175,55,0.15);border-radius:10px;padding:12px 14px;color:#fff;font-family:'Cairo',sans-serif;font-size:14px;text-align:center;outline:none;margin-bottom:10px;direction:ltr;}
  .og-input:focus{border-color:#00E5FF;}
  .og-btn{width:100%;background:linear-gradient(90deg,#D4AF37,#F4E5A6);color:#0A0A0D;border:none;padding:12px;border-radius:10px;font-weight:800;font-size:13.5px;cursor:pointer;font-family:'Cairo',sans-serif;margin-bottom:8px;}
  .og-btn.secondary{background:transparent;border:1px solid rgba(0,229,255,0.25);color:#00E5FF;}
  .og-err{font-size:11.5px;color:#ff6b6b;margin-bottom:8px;min-height:14px;}
  .og-divider{font-size:10.5px;color:#8A8A8F;margin:10px 0;}
  `;
  document.head.appendChild(s);
}

/**
 * initOfficeGate(user, onUnlocked)
 * user: { email, ... } من legista_user
 * onUnlocked: تُستدعى لما يعدي القفل (أو لو كان متفتوح بالفعل على الجهاز/الجلسة ده)
 */
export async function initOfficeGate(user, onUnlocked) {
  const email = user.email;

  if (sessionStorage.getItem(unlockKey(email)) === '1') {
    onUnlocked();
    return;
  }

  injectStyles();
  const userRef = doc(db, 'users', email);
  const snap = await getDoc(userRef);
  const data = snap.exists() ? snap.data() : {};
  const hasPassword = !!data.officePasswordHash;

  const overlay = document.createElement('div');
  overlay.id = 'officeGateOverlay';
  document.body.appendChild(overlay);

  const canUseBiometric = hasPassword && !!localStorage.getItem(credKey(email));

  function render(mode, errMsg) {
    if (mode === 'biometric') {
      overlay.innerHTML = `
        <div class="og-card">
          <div class="og-icon">👆</div>
          <div class="og-title">قفل أدوات المكتب</div>
          <p class="og-sub">استخدم بصمتك لفتح إدارة قضاياك وموظفيك على الجهاز ده.</p>
          <div class="og-err">${errMsg || ''}</div>
          <button class="og-btn" id="ogBio">👆 دخول بالبصمة</button>
          <button class="og-btn secondary" id="ogUsePass">استخدم الباصورد بدلاً منها</button>
        </div>`;
      document.getElementById('ogBio').addEventListener('click', handleBiometric);
      document.getElementById('ogUsePass').addEventListener('click', () => render('password'));
      handleBiometric(true);
      return;
    }

    overlay.innerHTML = `
      <div class="og-card">
        <div class="og-icon">🔒</div>
        <div class="og-title">${hasPassword ? 'قفل أدوات المكتب' : 'إنشاء باصورد لأدوات المكتب'}</div>
        <p class="og-sub">${hasPassword ? 'دخّل باصورد المكتب عشان تفتح إدارة قضاياك وموظفيك.' : 'أول مرة تدخل أدوات المكتب — اعمل باصورد خاص بيك تستخدمه بعد كده.'}</p>
        <div class="og-err">${errMsg || ''}</div>
        <input type="password" id="ogPass" class="og-input" placeholder="${hasPassword ? 'الباصورد' : 'اختار باصورد (4 حروف/أرقام فأكتر)'}">
        ${!hasPassword ? `<input type="password" id="ogPass2" class="og-input" placeholder="أكد الباصورد">` : ''}
        <button class="og-btn" id="ogSubmit">${hasPassword ? 'دخول' : 'حفظ وفتح'}</button>
        ${canUseBiometric ? `<div class="og-divider">أو</div><button class="og-btn secondary" id="ogGoBio">👆 دخول بالبصمة</button>` : ''}
      </div>`;

    document.getElementById('ogSubmit').addEventListener('click', handleSubmit);
    document.getElementById('ogPass').addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
    document.getElementById('ogGoBio')?.addEventListener('click', () => render('biometric'));
  }

  async function handleSubmit() {
    const pass = document.getElementById('ogPass').value;
    if (!pass || pass.length < 4) { render(hasPassword ? 'password' : 'setup', 'الباصورد لازم يكون 4 حروف/أرقام على الأقل'); return; }

    if (!hasPassword) {
      const pass2 = document.getElementById('ogPass2').value;
      if (pass !== pass2) { render('setup', 'الباصوردين مش متطابقين'); return; }
      const hash = await sha256(email + ':' + pass);
      await setDoc(userRef, { officePasswordHash: hash }, { merge: true });
      afterUnlock();
      return;
    }

    const hash = await sha256(email + ':' + pass);
    const freshSnap = await getDoc(userRef);
    if (freshSnap.exists() && freshSnap.data().officePasswordHash === hash) {
      afterUnlock();
    } else {
      render('password', 'الباصورد غلط، حاول تاني');
    }
  }

  async function afterUnlock() {
    sessionStorage.setItem(unlockKey(email), '1');
    if (isMobile() && !localStorage.getItem(credKey(email)) && await biometricAvailable()) {
      renderBiometricOffer();
    } else {
      finish();
    }
  }

  function renderBiometricOffer() {
    overlay.innerHTML = `
      <div class="og-card">
        <div class="og-icon">👆</div>
        <div class="og-title">تفعيل الدخول بالبصمة؟</div>
        <p class="og-sub">تقدر تخلي الدخول الجاي على التليفون ده ببصمتك بدل ما تكتب الباصورد تاني.</p>
        <button class="og-btn" id="ogEnableBio">فعّل البصمة على الجهاز ده</button>
        <button class="og-btn secondary" id="ogSkipBio">لأ، شكراً</button>
      </div>`;
    document.getElementById('ogSkipBio').addEventListener('click', finish);
    document.getElementById('ogEnableBio').addEventListener('click', async () => {
      try {
        const cred = await navigator.credentials.create({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: 'LEGISTA' },
            user: { id: new TextEncoder().encode(email), name: email, displayName: email },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
            timeout: 60000
          }
        });
        localStorage.setItem(credKey(email), btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
      } catch (e) { /* لو المستخدم رفض أو الجهاز مش بيدعم، نتجاهل ونكمل بالباصورد بس */ }
      finish();
    });
  }

  async function handleBiometric(silentFail) {
    try {
      const credIdB64 = localStorage.getItem(credKey(email));
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ id: Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0)), type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      sessionStorage.setItem(unlockKey(email), '1');
      finish();
    } catch (e) {
      if (!silentFail) render('biometric', 'مقدرنا نتحقق من البصمة، جرّب تاني أو استخدم الباصورد');
    }
  }

  function finish() {
    overlay.remove();
    onUnlocked();
  }

  render(canUseBiometric ? 'biometric' : (hasPassword ? 'password' : 'setup'));
}
