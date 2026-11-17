import { COMMON_CLIENT_JS, SAAS_STYLES } from './styles.js';

export function renderJoinHTML(): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CARDOSO AI — Isku Diiwaangeli Bot-kaaga WhatsApp (Bisha 1aad Bilaash)</title>
  <style>${SAAS_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">🤖</div>
      <div>
        <h1>CARDOSO <span>AI</span> SaaS</h1>
        <p>Kaaliyahaaga WhatsApp ee Af-Soomaaliga &amp; Ganacsiga</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
      <a href="/portal" class="btn btn-ghost btn-sm">🔑 Horay Ma Isku Diiwaangelisay? Fur Dashboard</a>
      <span class="pill pill-green">🎁 Bisha 1aad Bilaash (Xilli Xaddidan)</span>
    </div>
  </header>

  <main class="container-narrow">
    <div style="text-align:center;margin-bottom:2rem;">
      <div class="pill pill-cyan" style="margin-bottom:0.85rem;">✨ Ku Xidh WhatsApp-kaaga 10 Ilbiriqsi Gudahood</div>
      <h2 style="font-size:2rem;font-weight:800;letter-spacing:-0.03em;margin-bottom:0.65rem;">
        Sameyso Bot kuu Shaqeeya 24/7 adigoo Hal Taleefan Haysta
      </h2>
      <p style="color:var(--text-muted);max-width:650px;margin:0 auto;font-size:0.95rem;">
        Guji mid ka mid ah saddexdan nooc si foomku isugu beddelo bot-ka kuugu habboon (Qof Caadi ah, Ganacsato, ama Waxbarasho).
      </p>
    </div>

    <section class="glass-card" id="signupCard">
      <div class="card-title">1️⃣ Dooro Sida Bot-kaagu U Dhaqmayo (Role)</div>
      <div class="card-sub">Markasta oo aad mid gujiso, foomka hoose wuxuu isu rogayaa qaabka adeeggaas u gaarka ah.</div>

      <div class="grid-3" style="margin-bottom:1.5rem;">
        <div class="role-card selected" data-cat="personal" onclick="selectCategory('personal', this)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <span style="font-size:1.5rem;">👤</span>
            <span class="pill pill-green">Ugu Caansan ⭐</span>
          </div>
          <h3 style="font-size:1rem;font-weight:800;margin-bottom:0.35rem;">Qof Caadi ah (Personal)</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);">
            Kuu qabta fariimaha markaad mashquul tahay (Away Mode), garta asxaabta &amp; ehelka, Status-yada si caqli ah uga falceliya, kuuna kaydiya fariimaha muhiimka ah.
          </p>
        </div>

        <div class="role-card" data-cat="business" onclick="selectCategory('business', this)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <span style="font-size:1.5rem;">🛍️</span>
            <span class="pill pill-amber">Ganacsi &amp; Dukaamo</span>
          </div>
          <h3 style="font-size:1rem;font-weight:800;margin-bottom:0.35rem;">Ganacsato (Business)</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);">
            Bixiya qiimaha alaabta, tilmaama lacag-bixinta Zaad/eDahab, si toos ah u diiwaangeliya dalabaadka &amp; macmiisha cusub (Orders Inbox).
          </p>
        </div>

        <div class="role-card" data-cat="education" onclick="selectCategory('education', this)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <span style="font-size:1.5rem;">🎓</span>
            <span class="pill pill-violet">Machadyo &amp; Dugsiyo</span>
          </div>
          <h3 style="font-size:1rem;font-weight:800;margin-bottom:0.35rem;">Waxbarasho (Education)</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);">
            Sharxa koorsooyinka, jadwalka, shuruudaha &amp; kharashka, kuna soo xareeya ardayda isdiiwaangelinaysa si nidaamsan.
          </p>
        </div>
      </div>

      <!-- Dynamic Active Role Form Banner -->
      <div id="activeFormBanner" style="padding:1rem 1.15rem;border-radius:12px;margin-bottom:1.25rem;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.35);transition:all 0.25s ease;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
          <strong id="bannerTitle" style="font-size:0.98rem;">👤 2️⃣ Foomka: Qof Caadi ah (Personal Assistant)</strong>
          <span id="bannerBadge" class="pill pill-cyan">Bisha 1aad Bilaash</span>
        </div>
        <p id="bannerDesc" style="font-size:0.82rem;color:var(--text-muted);margin-top:0.3rem;">
          Buuxi xogtaada si bot-ku uu asxaabtaada u garto, fariimaha muhiimka ahna kuugu qabto markaad mashquul tahay.
        </p>
      </div>

      <form id="joinForm" autocomplete="off" onsubmit="submitJoin(event)">
        <input type="hidden" id="selectedCategory" value="personal" />

        <div class="grid-2">
          <div class="form-group">
            <label class="field-label" id="nameLabel">Magacaaga oo buuxa (ama Naaneysta)</label>
            <input class="field" id="signupName" name="join_display_name" autocomplete="off" required placeholder="Tusaale: Axmed Cabdi" />
          </div>
          <div class="form-group">
            <label class="field-label" id="phoneLabel">Lambarkaaga WhatsApp (oo wata furaha dalka)</label>
            <input class="field" id="signupPhone" name="join_wa_phone" autocomplete="off" required placeholder="Tusaale: 252634xxxxxx ama 0634xxxxxx" />
          </div>
        </div>

        <!-- ROLE 1: PERSONAL FIELDS -->
        <div id="fields-personal">
          <div class="grid-2">
            <div class="form-group">
              <label class="field-label">Goorma ayuu Bot-ku Kuu Jawaabaa?</label>
              <select class="field" id="persSchedule">
                <option value="24/7 Had iyo jeer">24/7 — Had iyo jeer</option>
                <option value="Markaan mashquul / Away ahay">Markaan mashquul / Away Mode shido</option>
                <option value="Wakhtiga shaqada & habeenkii">Wakhtiga shaqada &amp; habeenkii</option>
              </select>
            </div>
            <div class="form-group">
              <label class="field-label">Shaqadaada / Xirfaddaada (Ikhtiyaari)</label>
              <input class="field" id="persJob" name="join_occupation" autocomplete="off" placeholder="Tusaale: Arday / Software Developer / Ganacsade" />
            </div>
          </div>
          <div class="form-group">
            <label class="field-label">Fariinta Dadka Loo Sheegayo Markaad Mashquul Tahay (Ikhtiyaari)</label>
            <input class="field" id="persAwayNote" name="join_away_note" autocomplete="off" data-lpignore="true" readonly onfocus="this.removeAttribute('readonly');" oninput="this.dataset.edited='1';" value="" placeholder="Tusaale: Hadda shaqo ayaan ku jiraa, farriintaada ii reeb dib ayaan kuugu soo laabanayaa..." />
          </div>
        </div>

        <!-- ROLE 2: BUSINESS FIELDS -->
        <div id="fields-business" style="display:none;">
          <div class="grid-2">
            <div class="form-group">
              <label class="field-label">Nooca Ganacsiga / Dukaanka</label>
              <input class="field" id="bizType" placeholder="Tusaale: Dukaan Dhar, Electronics, Restaurant, Pharmacy" />
            </div>
            <div class="form-group">
              <label class="field-label">Lambarada Lacag-Bixinta (Zaad / eDahab / Sahal)</label>
              <input class="field" id="bizPayment" placeholder="Tusaale: Zaad 063xxxxxxx / eDahab 065xxxxxxx" />
            </div>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="field-label">Magaalada, Xaafadda/Suuqa &amp; Saacadaha Furitaanka</label>
              <input class="field" id="bizLocation" placeholder="Tusaale: Hargeysa (26 June / Gobonimo), 8:00 AM - 9:00 PM" />
            </div>
            <div class="form-group">
              <label class="field-label">Adeegga Delivery-ga</label>
              <select class="field" id="bizDeliveryScope">
                <option value="Labadaba: Magaalada gudaheeda &amp; Magaalooyinka kale" selected>🚚 Labadaba — Magaalada Gudaheeda &amp; Magaalooyinka Kale</option>
                <option value="Magaalada gudaheeda kaliya">🛵 Magaalada Gudaheeda Kaliya (Xaafadaha oo dhan)</option>
                <option value="Magaalooyinka kale &amp; Gobollada kaliya">📦 Magaalooyinka Kale &amp; Gobollada Kaliya</option>
                <option value="Pick-up kaliya (Dukaanka lagala baxo)">🏬 Pick-up Kaliya (Dukaanka lagala baxo)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="field-label">Khidmadda &amp; Faahfaahinta Delivery-ga (Ikhtiyaari)</label>
            <input class="field" id="bizDelivery" placeholder="Tusaale: Magaalada gudaheeda $2 (xaafadaha oo dhan), Magaalooyinka kale $5 (24 saac)" />
          </div>
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.35rem;">
              <label class="field-label" style="margin:0;">Alaabta &amp; Qiimaha Ugu Muhiimsan (Ikhtiyaari — si bot-ku isla markiiba u barto)</label>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <input type="file" id="bizCatalogFile" accept=".csv,.tsv,.txt,.json,.md,text/csv,text/plain,application/json" style="display:none;" onchange="importCatalogFile(this, 'bizCatalog', false)" />
                <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('bizCatalogFile').click()">📥 Import Fayl (CSV / TXT / JSON)</button>
                <button type="button" class="btn btn-ghost btn-sm" onclick="downloadCatalogCsvTemplate('business')">📄 Template CSV</button>
              </div>
            </div>
            <textarea class="field" id="bizCatalog" style="min-height:95px;" placeholder="Gacanta ku qor ama kor ka guji 'Import Fayl' si aad u soo geliso liis CSV / TXT / JSON ah:&#10;- Shaadh Casri ah: $15&#10;- Kabo Sport: $28"></textarea>
          </div>
        </div>

        <!-- ROLE 3: EDUCATION FIELDS -->
        <div id="fields-education" style="display:none;">
          <div class="grid-2">
            <div class="form-group">
              <label class="field-label">Habka Waxbarashada</label>
              <select class="field" id="eduMode">
                <option value="Toos (On-Campus) & Online">Toos (Fasallo) &amp; Online Labadaba</option>
                <option value="Online Kaliya">Online Kaliya (Zoom / WhatsApp)</option>
                <option value="Toos (Xarun / Dugsiga)">Toos (Xarunta / Dugsiga gudaheeda)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="field-label">Magaalada, Goobta &amp; Waqtiga Xafiiska</label>
              <input class="field" id="eduLocation" placeholder="Tusaale: Jigjiga Yar, Hargeysa (8:00 AM - 8:00 PM)" />
            </div>
          </div>
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.35rem;">
              <label class="field-label" style="margin:0;">Koorsooyinka, Muddada &amp; Qiimaha / Shuruudaha (Ikhtiyaari)</label>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <input type="file" id="eduCoursesFile" accept=".csv,.tsv,.txt,.json,.md,text/csv,text/plain,application/json" style="display:none;" onchange="importCatalogFile(this, 'eduCourses', false)" />
                <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('eduCoursesFile').click()">📥 Import Fayl (CSV / TXT / JSON)</button>
                <button type="button" class="btn btn-ghost btn-sm" onclick="downloadCatalogCsvTemplate('education')">📄 Template CSV</button>
              </div>
            </div>
            <textarea class="field" id="eduCourses" style="min-height:95px;" placeholder="Gacanta ku qor ama kor ka guji 'Import Fayl' si aad u soo geliso liis CSV / TXT / JSON ah:&#10;- Graphic Design: $30/bil (3 bilood)&#10;- English Fluency: $20/bil"></textarea>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="field-label">🔑 PIN / Password (si aad mar kasta Dashboard-kaaga ugu soo noqoto)</label>
            <input class="field" id="signupPin" name="join_new_portal_pin" type="password" autocomplete="new-password" data-lpignore="true" readonly onfocus="this.removeAttribute('readonly');" oninput="this.dataset.edited='1';" value="" minlength="4" placeholder="Ugu yaraan 4 xaraf ama lambar (tusaale: 2025)" />
          </div>
          <div class="form-group">
            <label class="field-label">Promo Code (Haddii aad haysato — Ikhtiyaari)</label>
            <input class="field" id="signupPromo" name="join_promo_code" autocomplete="off" placeholder="Haddii maamulku ku siiyay code gaar ah" />
          </div>
        </div>

        <button type="submit" id="submitBtn" class="btn btn-primary" style="width:100%;padding:0.9rem;font-size:0.96rem;">
          🚀 Dir Codsiga Bot-ka Shakhsiga ah
        </button>
      </form>
    </section>

    <section class="glass-card" id="resultCard" style="display:none;margin-top:1.5rem;border-color:rgba(16,185,129,0.45);">
      <div style="text-align:center;">
        <div style="font-size:2.4rem;margin-bottom:0.5rem;" id="resIcon">🎉</div>
        <h3 style="font-size:1.35rem;font-weight:800;margin-bottom:0.5rem;" id="resTitle">Codsigaaga waa la diiwaangeliyay!</h3>
        <p style="color:var(--text-muted);max-width:560px;margin:0 auto 1.25rem;" id="resMessage"></p>

        <div style="background:rgba(8,13,25,0.8);border:1px solid var(--card-border);border-radius:12px;padding:1rem;margin-bottom:1.25rem;">
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.35rem;">Link-gaaga Gaarka ah ee Dashboard-ka (Kaydso):</div>
          <div id="portalUrlDisplay" style="font-family:monospace;font-size:0.86rem;color:#22d3ee;word-break:break-all;margin-bottom:0.75rem;"></div>
          <div style="display:flex;justify-content:center;gap:0.75rem;flex-wrap:wrap;">
            <a id="openPortalBtn" href="#" class="btn btn-emerald">🔗 Fur Dashboard-kayga Hadda</a>
            <button type="button" class="btn btn-ghost" onclick="copyText(window.createdPortalUrl, 'Link-ga Dashboard-ka waa la koobiyey')">📋 Copy Link</button>
          </div>
        </div>
      </div>
    </section>
  </main>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}
    window.createdPortalUrl = "";

    const ROLE_UI_META = {
      personal: {
        bannerBg: "rgba(6,182,212,0.1)",
        bannerBorder: "rgba(6,182,212,0.38)",
        title: "👤 2️⃣ Foomka: Qof Caadi ah (Personal Assistant)",
        badgeText: "Bisha 1aad Bilaash",
        badgeClass: "pill pill-green",
        desc: "Buuxi xogtaada si bot-ku uu asxaabtaada u garto, fariimaha muhiimka ahna kuugu qabto markaad mashquul tahay.",
        nameLabel: "Magacaaga oo buuxa (ama Naaneysta)",
        namePlaceholder: "Tusaale: Axmed Cabdi",
        phoneLabel: "Lambarkaaga WhatsApp (oo wata furaha dalka)",
        submitText: "🚀 Dir Codsiga Bot-ka Shakhsiga ah"
      },
      business: {
        bannerBg: "rgba(245,158,11,0.1)",
        bannerBorder: "rgba(245,158,11,0.42)",
        title: "🛍️ 2️⃣ Foomka: Ganacsato & Dukaamo (Business Bot)",
        badgeText: "Iibka & Orders Inbox",
        badgeClass: "pill pill-amber",
        desc: "Geli xogta dukaankaaga, Zaad/eDahab, iyo alaabta si bot-ku macaamiisha toos ugu qabto dalabaadka 24/7.",
        nameLabel: "Magaca Ganacsiga / Dukaanka / Shirkadda",
        namePlaceholder: "Tusaale: Hargeysa Fashion / Barwaaqo Electronics",
        phoneLabel: "Lambarka WhatsApp ee Ganacsiga",
        submitText: "🛍️ Dir Codsiga Bot-ka Ganacsiga"
      },
      education: {
        bannerBg: "rgba(139,92,246,0.12)",
        bannerBorder: "rgba(139,92,246,0.42)",
        title: "🎓 2️⃣ Foomka: Waxbarasho & Machadyo (Education Bot)",
        badgeText: "Ardayda & Koorsooyinka",
        badgeClass: "pill pill-violet",
        desc: "Geli xogta machadka/dugsiga iyo koorsooyinka si bot-ku ardayda & waalidiinta uga jawaabo uguna diiwaangeliyo.",
        nameLabel: "Magaca Machadka / Dugsiga / Macalinka",
        namePlaceholder: "Tusaale: Somaliland Tech Academy / Xarunta Luqadaha",
        phoneLabel: "Lambarka WhatsApp ee Xafiiska / Diiwaangelinta",
        submitText: "🎓 Dir Codsiga Bot-ka Waxbarashada"
      }
    };

    function selectCategory(cat, el) {
      document.getElementById("selectedCategory").value = cat;
      document.querySelectorAll(".role-card").forEach(function(c) { c.classList.remove("selected"); });
      if (el) el.classList.add("selected");

      ["personal", "business", "education"].forEach(function(key) {
        var box = document.getElementById("fields-" + key);
        if (box) box.style.display = (key === cat) ? "block" : "none";
      });

      var meta = ROLE_UI_META[cat] || ROLE_UI_META.personal;
      var banner = document.getElementById("activeFormBanner");
      banner.style.background = meta.bannerBg;
      banner.style.borderColor = meta.bannerBorder;
      document.getElementById("bannerTitle").textContent = meta.title;
      var badgeEl = document.getElementById("bannerBadge");
      badgeEl.className = meta.badgeClass;
      badgeEl.textContent = meta.badgeText;
      document.getElementById("bannerDesc").textContent = meta.desc;
      document.getElementById("nameLabel").textContent = meta.nameLabel;
      document.getElementById("signupName").placeholder = meta.namePlaceholder;
      document.getElementById("phoneLabel").textContent = meta.phoneLabel;
      document.getElementById("submitBtn").textContent = meta.submitText;
    }

    function buildRoleNotes(cat) {
      var lines = [];
      if (cat === "business") {
        var bizType = document.getElementById("bizType").value.trim();
        var bizPayment = document.getElementById("bizPayment").value.trim();
        var bizLocation = document.getElementById("bizLocation").value.trim();
        var bizDeliveryScope = document.getElementById("bizDeliveryScope").value.trim();
        var bizDelivery = document.getElementById("bizDelivery").value.trim();
        var bizCatalog = document.getElementById("bizCatalog").value.trim();
        if (bizType) lines.push("Nooca Ganacsiga: " + bizType);
        if (bizPayment) lines.push("Lacag Bixinta: " + bizPayment);
        if (bizLocation) lines.push("Goobta & Saacadaha: " + bizLocation);
        var fullDelivery = bizDelivery ? (bizDeliveryScope + " — " + bizDelivery) : bizDeliveryScope;
        if (fullDelivery) lines.push("Adeegga Delivery-ga: " + fullDelivery);
        if (bizCatalog) lines.push("Alaabta & Qiimaha:\\n" + bizCatalog);
      } else if (cat === "education") {
        var eduMode = document.getElementById("eduMode").value;
        var eduLocation = document.getElementById("eduLocation").value.trim();
        var eduCourses = document.getElementById("eduCourses").value.trim();
        if (eduMode) lines.push("Habka Waxbarashada: " + eduMode);
        if (eduLocation) lines.push("Goobta & Waqtiga: " + eduLocation);
        if (eduCourses) lines.push("Koorsooyinka & Qiimaha:\\n" + eduCourses);
      } else {
        var persSchedule = document.getElementById("persSchedule").value;
        var persJob = document.getElementById("persJob").value.trim();
        var persAway = document.getElementById("persAwayNote").value.trim();
        if (persSchedule) lines.push("Wakhtiga Shaqada Bot-ka: " + persSchedule);
        if (persJob) lines.push("Xirfadda: " + persJob);
        if (persAway) lines.push("Fariinta Maqnaanshaha: " + persAway);
      }
      return lines.join("\\n");
    }

    async function submitJoin(e) {
      e.preventDefault();
      var cat = document.getElementById("selectedCategory").value || "personal";
      var meta = ROLE_UI_META[cat] || ROLE_UI_META.personal;
      var btn = document.getElementById("submitBtn");
      btn.disabled = true;
      btn.textContent = "⏳ Waa la dirayaa...";

      try {
        var res = await fetch("/api/public/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: document.getElementById("signupName").value.trim(),
            phone: document.getElementById("signupPhone").value.trim(),
            category: cat,
            notes: buildRoleNotes(cat),
            pin: document.getElementById("signupPin").value.trim(),
            promoCode: document.getElementById("signupPromo").value.trim()
          })
        });
        var data = await res.json();
        if (!res.ok || data.status !== "ok") {
          showToast("❌ " + (data.message || "Khalad ayaa dhacay"), true);
          return;
        }

        var fullUrl = window.location.origin + data.portalUrl;
        window.createdPortalUrl = fullUrl;
        document.getElementById("signupCard").style.display = "none";
        document.getElementById("resultCard").style.display = "block";
        document.getElementById("portalUrlDisplay").textContent = fullUrl;
        document.getElementById("openPortalBtn").href = data.portalUrl;

        if (data.autoApproved) {
          document.getElementById("resIcon").textContent = "🚀";
          document.getElementById("resTitle").textContent = "Hambalyo! Akoonkaagu Isla Markiiba Waa Furan Yahay";
          document.getElementById("resMessage").textContent = "Promo code-kaagii waa shaqeeyay. Hadda waxaad toos u geli kartaa Dashboard-kaaga si aad WhatsApp-ka ugu xidho.";
        } else {
          document.getElementById("resIcon").textContent = "✅";
          document.getElementById("resTitle").textContent = "Codsigaaga Waa La Gudbiyay (Pending)";
          document.getElementById("resMessage").textContent = "Fariin ogeysiin ah ayaa u tagtay maamulka. Markii lagu oggolaado (ama lacagta / trial-ka la xaqiijiyo), boggan Dashboard-kaaga toos ayuu kuugu furi doonaa xidhiidhka WhatsApp!";
        }
      } catch (err) {
        showToast("❌ Xidhiidhka server-ka ayaa go'an", true);
      } finally {
        btn.disabled = false;
        btn.textContent = meta.submitText;
      }
    }

    function clearAutofillFields() {
      ["persAwayNote", "signupPin"].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && el.dataset.edited !== "1") el.value = "";
      });
    }
    window.addEventListener("DOMContentLoaded", clearAutofillFields);
    window.addEventListener("pageshow", clearAutofillFields);
    setTimeout(clearAutofillFields, 150);
  </script>
</body>
</html>`;
}
