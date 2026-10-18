/* ═══════════════════════════════════════════════════════════
   LEGANO — نظام دعوات المحامين (لينك مخصص + جولة تعريفية + تجربتين مجانًا)
   الاستخدام: <script src="invite.js"></script> قبل </body> في أي صفحة.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyC6PRK7EECoPF3qDawVSRYmMg0uufTs6Xw",
    authDomain: "legista-o.firebaseapp.com",
    projectId: "legista-o",
    appId: "1:964258159036:web:a3a66d4f5ea38f9964f3b9"
  };
  var LS_CODE = 'legano_invite';          // كود الدعوة المحفوظ
  var LS_STATE = 'legano_invite_state';   // نسخة محلية سريعة من حالة الدعوة (للعرض فقط، مش للأمان)
  var WHATSAPP_NUMBER = '201021472439';

  var _fs = null, _db = null, _ready = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

  function initFirebase() {
    if (_ready) return _ready;
    _ready = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
    ]).then(function (m) {
      var app = m[0].initializeApp(FIREBASE_CONFIG, 'legano-invite');
      _db = m[1].getFirestore(app);
      _fs = m[1];
    });
    return _ready;
  }

  function normCode(c) { return String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }

  function evaluate(data) {
    if (!data) return { valid: false, reason: 'missing' };
    if (data.status === 'revoked') return { valid: false, reason: 'revoked' };
    if (data.expiresAt && Date.now() > data.expiresAt) return { valid: false, reason: 'expired' };
    var total = Number(data.trialsTotal) || 0;
    var used = Number(data.trialsUsed) || 0;
    return { valid: true, left: Math.max(0, total - used), total: total, used: used };
  }

  function saveState(code, data, ev) {
    lsSet(LS_STATE, JSON.stringify({ code: code, name: data.name || '', left: ev.left, total: ev.total, ts: Date.now() }));
  }

  /* ═══ API عامة ═══ */
  var API = {
    getCode: function () { return normCode(lsGet(LS_CODE)); },
    // هل في دعوة محفوظة وفيها تجارب لسه (قراءة محلية سريعة)
    hasActive: function () {
      var c = API.getCode(); if (!c) return false;
      try { var s = JSON.parse(lsGet(LS_STATE) || 'null'); return !!(s && s.code === c && s.left > 0); } catch (e) { return false; }
    },
    // يجيب الحالة الفعلية من السيرفر
    fetchStatus: function () {
      var code = API.getCode();
      if (!code) return Promise.resolve({ valid: false, reason: 'none' });
      return initFirebase().then(function () {
        return _fs.getDoc(_fs.doc(_db, 'invites', code));
      }).then(function (snap) {
        if (!snap.exists()) { lsDel(LS_CODE); lsDel(LS_STATE); return { valid: false, reason: 'missing' }; }
        var data = snap.data(); var ev = evaluate(data);
        if (ev.valid) saveState(code, data, ev);
        ev.data = data; ev.code = code;
        return ev;
      }).catch(function () { return { valid: false, reason: 'error' }; });
    },
    // يستهلك تجربة واحدة بأمان (Transaction). نادِ عليها لحظة التوليد الفعلي في صفحات الأدوات.
    // الاستخدام:  LeganoInvite.consumeTrial('inzarat').then(function(r){ if(r.ok){ ...ولّد... } else { ...اعرض رسالة الاشتراك... } })
    consumeTrial: function (toolName) {
      var code = API.getCode();
      if (!code) return Promise.resolve({ ok: false, reason: 'none' });
      return initFirebase().then(function () {
        var ref = _fs.doc(_db, 'invites', code);
        return _fs.runTransaction(_db, function (tx) {
          return tx.get(ref).then(function (snap) {
            if (!snap.exists()) return { ok: false, reason: 'missing' };
            var data = snap.data(); var ev = evaluate(data);
            if (!ev.valid) return { ok: false, reason: ev.reason };
            if (ev.left <= 0) return { ok: false, reason: 'exhausted' };
            var tools = data.toolsUsed || {};
            if (toolName) tools[toolName] = (tools[toolName] || 0) + 1;
            tx.update(ref, { trialsUsed: ev.used + 1, lastUsedAt: Date.now(), toolsUsed: tools });
            return { ok: true, left: ev.left - 1, total: ev.total, data: data };
          });
        });
      }).then(function (r) {
        if (r && r.ok) {
          lsSet(LS_STATE, JSON.stringify({ code: code, name: (r.data && r.data.name) || '', left: r.left, total: r.total, ts: Date.now() }));
          updateChip(r.left, r.total);
        } else if (r && r.reason === 'exhausted') {
          try { var s = JSON.parse(lsGet(LS_STATE) || '{}'); s.left = 0; lsSet(LS_STATE, JSON.stringify(s)); } catch (e) {}
          updateChip(0, 0);
        }
        return r;
      }).catch(function () { return { ok: false, reason: 'error' }; });
    },
    startTour: function () { startTour(true); },
    // رسالة جاهزة لما التجارب تخلص
    showUpgradePrompt: function () { showUpgrade(); }
  };
  window.LeganoInvite = API;

  /* ═══ الستايل ═══ */
  function injectCss() {
    if (document.getElementById('lgInviteCss')) return;
    var st = document.createElement('style');
    st.id = 'lgInviteCss';
    st.textContent = [
      '.lgi-ov{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);direction:rtl;font-family:Cairo,sans-serif;animation:lgiFade .35s both}',
      '@keyframes lgiFade{from{opacity:0}to{opacity:1}}',
      '@keyframes lgiPop{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}',
      '.lgi-card{width:100%;max-width:440px;background:#fff;border:1px solid #E2E8F0;border-radius:24px;padding:36px 30px 28px;text-align:center;box-shadow:0 30px 80px rgba(15,23,42,.35);animation:lgiPop .45s cubic-bezier(.22,1,.36,1) both}',
      '.lgi-badge{display:inline-block;font-size:11px;font-weight:800;padding:5px 14px;border-radius:20px;background:linear-gradient(90deg,#F97316,#DC2626);color:#fff;margin-bottom:16px;letter-spacing:.5px}',
      '.lgi-title{font-family:"Aref Ruqaa",Cairo,sans-serif;font-size:26px;font-weight:900;color:#1E293B;line-height:1.5;margin-bottom:10px}',
      '.lgi-sub{font-size:14px;color:#334155;line-height:1.9;margin-bottom:22px}',
      '.lgi-gift{display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,rgba(5,150,105,.09),rgba(16,185,129,.03));border:1px solid rgba(5,150,105,.28);border-radius:14px;padding:13px 16px;margin-bottom:22px;font-size:13.5px;font-weight:800;color:#059669}',
      '.lgi-gift b{font-family:Syne,sans-serif;font-size:22px}',
      '.lgi-btn{display:block;width:100%;padding:15px;border:none;border-radius:12px;background:#0F172A;color:#fff;font-family:Cairo,sans-serif;font-size:15px;font-weight:900;cursor:pointer;transition:transform .15s,box-shadow .2s;box-shadow:0 8px 24px rgba(15,23,42,.22)}',
      '.lgi-btn:hover{transform:scale(1.02)}',
      '.lgi-link{display:inline-block;margin-top:14px;background:none;border:none;color:#64748b;font-family:Cairo,sans-serif;font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:none}',
      '.lgi-link:hover{color:#1E293B}',
      /* الجولة */
      '.lgt-block{position:fixed;inset:0;z-index:100000;background:transparent}',
      '.lgt-spot{position:fixed;z-index:100001;border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.74),0 0 0 3px rgba(201,162,39,.95);pointer-events:none;transition:top .35s cubic-bezier(.22,1,.36,1),left .35s cubic-bezier(.22,1,.36,1),width .35s cubic-bezier(.22,1,.36,1),height .35s cubic-bezier(.22,1,.36,1)}',
      '.lgt-tip{position:fixed;z-index:100002;width:min(330px,calc(100vw - 24px));background:#fff;border-radius:18px;padding:20px 20px 16px;box-shadow:0 24px 60px rgba(0,0,0,.4);direction:rtl;font-family:Cairo,sans-serif;animation:lgiPop .35s both}',
      '.lgt-step{font-size:10.5px;letter-spacing:2px;font-weight:800;color:#92620C;margin-bottom:6px}',
      '.lgt-title{font-size:16px;font-weight:900;color:#1E293B;margin-bottom:6px}',
      '.lgt-text{font-size:13px;line-height:1.85;color:#334155;margin-bottom:14px}',
      '.lgt-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.lgt-prog{height:5px;border-radius:5px;background:#E2E8F0;overflow:hidden;margin-bottom:14px}',
      '.lgt-prog i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#0F172A,#92620C);transition:width .3s}',
      '.lgt-actions{display:flex;gap:6px}',
      '.lgt-b{border:none;border-radius:10px;padding:9px 16px;font-family:Cairo,sans-serif;font-size:12.5px;font-weight:800;cursor:pointer}',
      '.lgt-b.next{background:#0F172A;color:#fff}',
      '.lgt-b.prev{background:#F1F5F9;color:#334155}',
      '.lgt-skip{display:block;margin:10px auto 0;background:none;border:none;color:#94a3b8;font-family:Cairo,sans-serif;font-size:11.5px;font-weight:700;cursor:pointer}',
      /* شارة التجارب */
      '.lgi-chip{position:fixed;top:86px;right:18px;z-index:99990;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid rgba(5,150,105,.35);color:#059669;border-radius:30px;padding:8px 16px;font-family:Cairo,sans-serif;font-size:12.5px;font-weight:800;box-shadow:0 8px 24px rgba(15,23,42,.12);direction:rtl;cursor:pointer}',
      '.lgi-chip.zero{border-color:rgba(220,38,38,.35);color:#DC2626}',
      '@media(max-width:768px){.lgi-chip{top:80px;right:12px;font-size:11.5px;padding:7px 13px}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ═══ شارة "باقيلك N تجارب" ═══ */
  function updateChip(left, total) {
    var chip = document.getElementById('lgiChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'lgiChip'; chip.className = 'lgi-chip';
      chip.addEventListener('click', function () { if (chip.classList.contains('zero')) showUpgrade(); });
      document.body.appendChild(chip);
    }
    if (left > 0) { chip.classList.remove('zero'); chip.innerHTML = '🎁 باقيلك <b>' + left + '</b> ' + (left === 1 ? 'تجربة' : 'تجارب') + ' مجانية'; }
    else { chip.classList.add('zero'); chip.innerHTML = '⛔ خلصت التجارب — اضغط للاشتراك'; }
  }

  /* ═══ رسالة نهاية التجارب ═══ */
  function showUpgrade() {
    injectCss();
    if (document.getElementById('lgiUpgrade')) return;
    var ov = document.createElement('div');
    ov.className = 'lgi-ov'; ov.id = 'lgiUpgrade';
    ov.innerHTML = '<div class="lgi-card"><div style="font-size:42px;margin-bottom:10px">🎯</div>' +
      '<div class="lgi-title">جرّبت بنفسك — إيه رأيك؟</div>' +
      '<div class="lgi-sub">خلصت تجاربك المجانية. الاشتراك بيفتحلك كل الأقسام من غير حدود، والدعم معاك على واتساب.</div>' +
      '<button class="lgi-btn" id="lgiUpPricing">شوف الاشتراك ←</button>' +
      '<a class="lgi-link" target="_blank" rel="noopener" href="https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent('أهلاً، جربت ليجانو وعايز أشترك') + '">أو كلمنا على واتساب</a>' +
      '<br><button class="lgi-link" id="lgiUpClose">إغلاق</button></div>';
    document.body.appendChild(ov);
    document.getElementById('lgiUpClose').onclick = function () { ov.remove(); };
    document.getElementById('lgiUpPricing').onclick = function () {
      ov.remove();
      var p = document.getElementById('pricing');
      if (p) p.scrollIntoView({ behavior: 'smooth' }); else location.href = 'index.html#pricing';
    };
  }

  /* ═══ شاشة الترحيب ═══ */
  function showWelcome(info) {
    injectCss();
    var ov = document.createElement('div');
    ov.className = 'lgi-ov'; ov.id = 'lgiWelcome';
    var nm = info.name ? ('أستاذ ' + esc(info.name)) : 'بحضرتك';
    ov.innerHTML = '<div class="lgi-card">' +
      '<span class="lgi-badge">✨ دعوة خاصة</span>' +
      '<div class="lgi-title">أهلاً ' + nm + '</div>' +
      '<div class="lgi-sub">الدعوة دي مخصوصة ليك من فريق ليجانو. هنفرجك على الموقع في دقيقة، وبعدها جرّب بنفسك.</div>' +
      '<div class="lgi-gift">🎁 معاك <b>' + info.left + '</b> ' + (info.left === 1 ? 'تجربة' : 'تجارب') + ' توليد مجانية على كل الأقسام</div>' +
      '<button class="lgi-btn" id="lgiStart">ابدأ الجولة ←</button>' +
      '<button class="lgi-link" id="lgiSkip">تخطي الجولة</button></div>';
    document.body.appendChild(ov);
    document.getElementById('lgiStart').onclick = function () { ov.remove(); startTour(false); };
    document.getElementById('lgiSkip').onclick = function () { ov.remove(); finishTour(true); };
  }

  /* ═══ الجولة التعريفية ═══ */
  var STEPS = [
    { sel: '#quickNavGrid', title: 'كل أدواتك في مكان واحد', text: 'دي أزرار الأقسام. هنعدّي على كل واحد فيهم بسرعة، وتقدر تتخطى الجولة في أي وقت.' },
    { sel: '#quickNavGrid a[href="rol.html"]', title: 'رول الجلسات', text: 'استعلم عن رول جلستك في ثانية. روابط مباشرة لكل نيابات ومحاكم شرق وغرب الإسكندرية.' },
    { sel: '#quickNavGrid a[href="#qaat"]', title: 'أماكن القاعات', text: 'خريطة قاعات مجمع السيد كريم (المحكمة البحرية) ومجمع المحاكم الجديد. دوّر برقم الدائرة أو نوع القضية ولاقي القاعة والدور.' },
    { sel: '#quickNavGrid a[href="#tahlil"]', title: 'تحليل القضية', text: 'اكتب أو احكي وقايع القضية بصوتك، وهيطلعلك ملخص الموقف القانوني ونقاط القوة والضعف وأقوى الدفوع المناسبة.' },
    { sel: '#quickNavGrid a[href="#tibbshari"]', title: 'الطب الشرعي', text: 'مرجع سريع لأنواع الإصابات حسب الأداة ودلالاتها القانونية، تقارنه بالتقرير الطبي وأقوال الشهود وقت التحقيق.' },
    { sel: '#dafou', title: 'مكتبة الدفوع', text: 'دفوع جنائية ومدنية جاهزة للمعركة، ومعاها أحكام النقض بالبحث بالكلمة أو برقم الطعن.' },
    { sel: '#quickNavGrid a[href="#ahkam"]', title: 'أحكام محكمة النقض', text: 'مبادئ الدوائر الجنائية والمدنية، بحث بالكلمة أو برقم الطعن، ونص القاعدة كاملة.' },
    { sel: '#quickNavGrid a[href="#tashrieat"]', title: 'التشريعات القانونية', text: 'النصوص الكاملة والمحدّثة لأكتر من 15 قانون وكود مصري. دوّر بالكلمة أو برقم المادة ولاقي النص في ثانية.' },
    { sel: '#quickNavGrid a[href="#maktabak"]', title: 'إدارة مكتبك', text: 'ملفات قضاياك ومستنداتها، ولوحة بمواعيدك وجلساتك، وفريق المكتب من محاميين وموظفين في مكان واحد.' },
    { sel: '#quickNavGrid a[href="#mawareeth"]', title: 'حاسبة المواريث', text: 'بتطبق أحكام الفرائض (الحجب والفروض والتعصيب والعول والرد) وتشرحلك سبب كل نصيب بالتفصيل.' },
    { sel: '#quickNavGrid a[href="#mawaeed"]', title: 'المواعيد القانونية', text: 'أكتر من 48 ميعاد ومدة قانونية، وحاسبة بتطلّعلك تاريخ انتهاء الميعاد من أول يوم تختاره.' },
    { sel: '#quickNavGrid a[href="#esteshara"]', title: 'الاستشارات القانونية', text: 'اسأل أ. هدى خميس (محامية بالنقض) استشارة كتابية أو عاجلة أو مكالمة، ومعاها شروحات فيديو على الموقع.' },
    { sel: '.tool-tab-panel[data-panel="drafting"] a[href="3oqood.html"]', pre: showDraftingTab, title: 'العقود', text: 'أكتر من 40 نوع عقد جاهزة للتوليد في دقايق.' },
    { sel: '.tool-tab-panel[data-panel="drafting"] a[href="inzarat.html"]', pre: showDraftingTab, title: 'الإنذارات', text: '33 صيغة إنذار جاهزة للتوليد.' },
    { sel: '.tool-tab-panel[data-panel="drafting"] a[href="junah.html"]', pre: showDraftingTab, title: 'الجنح المباشرة', text: '20 صيغة جنحة مباشرة جاهزة للتوليد.' },
    { sel: '.tool-tab-panel[data-panel="drafting"] a[href="dawawi.html"]', pre: showDraftingTab, title: 'صيغ الدعاوى', text: '20 صيغة دعوى جاهزة للتوليد.' },
    { sel: '.tool-tab-panel[data-panel="drafting"] a[href="igraat-jnaeya.html"]', pre: showDraftingTab, title: 'الإجراءات الجنائية', text: '340 مادة من قانون الإجراءات الجنائية في مكان واحد.' },
    { sel: '.hero-ctas .btn-primary', pre: showHome, title: 'وقت التجربة 🎁', text: 'ابدأ من إدارة مكتبك، وجرّب أي قسم تحبه. تجاربك المجانية متاحة على كل الأقسام، ومش محتاج بطاقة.', last: true }
  ];
  // بيفتح تبويب الصياغة من غير ما يتشرح (مجرد تمهيد عشان الأزرار تبقى ظاهرة)
  function showDraftingTab() { var b = document.querySelector('.tool-tab-btn[data-tab="drafting"]'); if (b && !b.classList.contains('active')) b.click(); }
  function showOfficeTab() { var b = document.querySelector('.tool-tab-btn[data-tab="office"]'); if (b && !b.classList.contains('active')) b.click(); }
  function showHome() { /* الزرار الأخير في الهيرو، مفيش تمهيد مطلوب */ }
  var tourIdx = 0, tourEls = null, tourFromChip = false;

  function startTour(manual) {
    injectCss();
    tourFromChip = !!manual;
    tourIdx = 0;
    var block = document.createElement('div'); block.className = 'lgt-block'; block.id = 'lgtBlock';
    var spot = document.createElement('div'); spot.className = 'lgt-spot'; spot.id = 'lgtSpot';
    var tip = document.createElement('div'); tip.className = 'lgt-tip'; tip.id = 'lgtTip';
    document.body.appendChild(block); document.body.appendChild(spot); document.body.appendChild(tip);
    tourEls = { block: block, spot: spot, tip: tip };
    window.addEventListener('resize', repositionTour);
    window.addEventListener('scroll', repositionTour, { passive: true });
    showStep(0);
  }

  function findStepEl(i) {
    var el = null;
    while (i < STEPS.length) {
      if (STEPS[i].pre) { try { STEPS[i].pre(); } catch (e) {} }
      el = document.querySelector(STEPS[i].sel);
      if (el) break; i++;
    }
    return { el: el, idx: i };
  }

  function showStep(i) {
    var r = findStepEl(i);
    if (!r.el) { endTour(); return; }
    tourIdx = r.idx;
    var step = STEPS[tourIdx];
    var rect0 = r.el.getBoundingClientRect();
    var targetY = rect0.top + window.scrollY - Math.max(110, (window.innerHeight - rect0.height) / 3);
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'instant' in window ? 'instant' : 'auto' });
    try { window.scrollTo({ top: Math.max(0, targetY), left: 0, behavior: 'instant' }); } catch (e) {}
    renderTip(step);
    setTimeout(repositionTour, 60);
  }

  function renderTip(step) {
    var total = STEPS.length;
    var pct = Math.round(((tourIdx + 1) / total) * 100);
    tourEls.tip.innerHTML =
      '<div class="lgt-step">الخطوة ' + (tourIdx + 1) + ' من ' + total + '</div>' +
      '<div class="lgt-title">' + esc(step.title) + '</div>' +
      '<div class="lgt-text">' + esc(step.text) + '</div>' +
      '<div class="lgt-prog"><i style="width:' + pct + '%"></i></div>' +
      '<div class="lgt-row"><div></div><div class="lgt-actions">' +
      (tourIdx > 0 ? '<button class="lgt-b prev" id="lgtPrev">السابق</button>' : '') +
      '<button class="lgt-b next" id="lgtNext">' + (step.last ? 'يلا نجرّب ✓' : 'التالي ←') + '</button></div></div>' +
      (step.last ? '' : '<button class="lgt-skip" id="lgtSkip">تخطي الجولة</button>');
    var n = document.getElementById('lgtNext'), p = document.getElementById('lgtPrev'), s = document.getElementById('lgtSkip');
    n.onclick = function () { if (step.last) endTour(); else showStep(tourIdx + 1); };
    if (p) p.onclick = function () { showStep(tourIdx - 1); };
    if (s) s.onclick = function () { endTour(); };
  }

  function repositionTour() {
    if (!tourEls) return;
    var step = STEPS[tourIdx]; if (!step) return;
    var el = document.querySelector(step.sel); if (!el) return;
    var r = el.getBoundingClientRect();
    var pad = 8;
    var top = r.top - pad, left = r.left - pad, w = r.width + pad * 2, h = r.height + pad * 2;
    var s = tourEls.spot.style;
    s.top = top + 'px'; s.left = left + 'px'; s.width = w + 'px'; s.height = h + 'px';
    // موضع الصندوق: تحت العنصر لو فيه مساحة، وإلا فوقه
    var tip = tourEls.tip, tipH = tip.offsetHeight || 190, tipW = tip.offsetWidth || 330;
    var vw = window.innerWidth, vh = window.innerHeight;
    var below = top + h + 14;
    var ty = (below + tipH < vh - 8) ? below : Math.max(8, top - tipH - 14);
    if (ty + tipH > vh - 8) ty = Math.max(8, vh - tipH - 8);
    var tx = left + w / 2 - tipW / 2;
    tx = Math.min(Math.max(12, tx), vw - tipW - 12);
    tip.style.top = ty + 'px'; tip.style.left = tx + 'px';
  }

  function endTour() {
    if (tourEls) {
      tourEls.block.remove(); tourEls.spot.remove(); tourEls.tip.remove(); tourEls = null;
      window.removeEventListener('resize', repositionTour);
      window.removeEventListener('scroll', repositionTour);
    }
    showOfficeTab(); // نرجّع التبويب الأول زي ما كان
    window.scrollTo({ top: 0, behavior: 'auto' });
    finishTour(false);
  }

  function tourKey() { return 'legano_tour_done_' + API.getCode(); }

  function finishTour(skipped) {
    lsSet(tourKey(), '1');
    if (tourFromChip) return;
    var code = API.getCode(); if (!code) return;
    initFirebase().then(function () {
      var upd = { tourDone: true, tourDoneAt: Date.now() };
      if (skipped) upd.tourSkipped = true;
      return _fs.updateDoc(_fs.doc(_db, 'invites', code), upd);
    }).catch(function () {});
  }

  /* ═══ نقطة البداية ═══ */
  function waitForLoader(cb) {
    var tries = 0;
    (function check() {
      var l = document.getElementById('loader');
      var gone = !l || l.style.display === 'none' || getComputedStyle(l).display === 'none';
      if (gone || tries++ > 60) cb(); else setTimeout(check, 250);
    })();
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    var fromUrl = normCode(params.get('invite'));
    var forceTour = params.get('tour') === '1'; // لإعادة عرض الترحيب والجولة (للتجربة): أضف &tour=1 للينك
    var isNew = false;
    if (fromUrl) {
      lsSet(LS_CODE, fromUrl);
      isNew = true;
      try {
        params.delete('invite');
        params.delete('tour');
        var q = params.toString();
        history.replaceState({}, document.title, location.pathname + (q ? '?' + q : '') + location.hash);
      } catch (e) {}
    }
    var code = API.getCode();
    if (!code) return;

    API.fetchStatus().then(function (ev) {
      if (!ev.valid) {
        if (isNew) {
          injectCss();
          var ov = document.createElement('div'); ov.className = 'lgi-ov';
          var msg = ev.reason === 'expired' ? 'الدعوة دي انتهت صلاحيتها.' : ev.reason === 'revoked' ? 'الدعوة دي اتلغت.' : 'اللينك ده مش صحيح.';
          ov.innerHTML = '<div class="lgi-card"><div style="font-size:40px;margin-bottom:10px">🔗</div><div class="lgi-title">' + msg + '</div><div class="lgi-sub">كلمنا على واتساب ونبعتلك دعوة جديدة.</div><a class="lgi-btn" style="text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/' + WHATSAPP_NUMBER + '">تواصل على واتساب</a><button class="lgi-link" id="lgiX">إغلاق</button></div>';
          document.body.appendChild(ov);
          document.getElementById('lgiX').onclick = function () { ov.remove(); };
        }
        return;
      }

      updateChip(ev.left, ev.total);
      var chip = document.getElementById('lgiChip');
      if (chip && ev.left > 0) {
        chip.title = 'اضغط لإعادة الجولة التعريفية';
        chip.addEventListener('click', function () { if (!chip.classList.contains('zero') && document.getElementById('toolTabsNav')) startTour(true); });
      }

      // أول فتح: نسجّل وقت الفتح
      if (!ev.data.openedAt) {
        _fs.updateDoc(_fs.doc(_db, 'invites', code), { openedAt: Date.now() }).catch(function () {});
      }

      // لو سجّل بحساب جوجل بعد الدعوة، نسجّل إيميله على الدعوة (للمتابعة في لوحة التحكم). التجارب نفسها ما بتتأثرش بالتسجيل.
      var su = null; try { su = JSON.parse(lsGet('legista_user') || 'null'); } catch (e) {}
      if (su && su.email && !ev.data.registeredEmail) {
        _fs.updateDoc(_fs.doc(_db, 'invites', code), { registeredEmail: su.email, registeredAt: Date.now() }).catch(function () {});
      }

      // الترحيب + الجولة تظهر على الصفحة الرئيسية بس، ولمرة واحدة
      var onHome = !!document.getElementById('toolTabsNav');
      // القرار على مستوى المتصفح + الدعوة دي بس (دعوة جديدة = جولة جديدة، حتى في نفس المتصفح)
      var tourDone = !forceTour && lsGet(tourKey()) === '1';
      if (onHome && !tourDone && ev.left > 0) {
        waitForLoader(function () { setTimeout(function () { showWelcome({ name: ev.data.name, left: ev.left }); }, 400); });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
