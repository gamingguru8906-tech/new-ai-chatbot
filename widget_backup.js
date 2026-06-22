(function () {
  "use strict";

  if (window.__MAYA_WIDGET_READY__) return;
  window.__MAYA_WIDGET_READY__ = true;

  const state = {
    mode: "closed",
    chatSession: "maya-" + Date.now(),
    gemStep: 0,
    gemLoading: false,
    gemResult: null,
    gemData: {
      name: "",
      whatsapp: "",
      dob: "",
      tob: "",
      birth_city: "",
      latitude: null,
      longitude: null,
      timezone: "",
    },
  };

  const gemSteps = [
    ["name", "Name", "What should Maya call you?", "Enter your full name", "text"],
    ["whatsapp", "WhatsApp", "Where should Maya save your result?", "Enter WhatsApp number", "tel"],
    ["dob", "Date of birth", "What is your date of birth?", "", "date"],
    ["tob", "Birth time", "Do you know your birth time?", "", "time"],
    ["birth_city", "Birth city", "Which city were you born in?", "Search city, state, country", "text"],
  ];

  const fallbackMap = {
    1: ["citrine-tiger-eye", "Citrine + Tiger Eye Bracelet", "Sun support for confidence, vitality, and personal authority."],
    2: ["rose-quartz-moonstone", "Rose Quartz + Moonstone Bracelet", "Moon support for emotional calm, softness, and inner balance."],
    3: ["citrine-yellow-aventurine", "Citrine + Yellow Aventurine Bracelet", "Jupiter support for growth, wisdom, and positive expansion."],
    4: ["triple-protection-amethyst", "Triple Protection + Amethyst Bracelet", "Rahu-style protection for clarity, grounding, and aura cleansing."],
    5: ["green-aventurine-lapis-lazuli", "Green Aventurine + Lapis Lazuli Bracelet", "Mercury support for communication, decisions, and practical clarity."],
    6: ["rose-quartz-green-aventurine", "Rose Quartz + Green Aventurine Bracelet", "Venus support for love, harmony, and heart healing."],
    7: ["amethyst-clear-quartz", "Amethyst + Clear Quartz Bracelet", "Ketu-style support for spiritual clarity, release, and grounding."],
    8: ["black-tourmaline-blue-sapphire-substitute", "Black Tourmaline + Blue Sapphire Substitute Bracelet", "Saturn support for discipline, pressure protection, and karmic steadiness."],
    9: ["red-jasper-tiger-eye", "Red Jasper + Tiger Eye Bracelet", "Mars support for courage, stamina, and controlled action."],
  };

  function css() {
    const style = document.createElement("style");
    style.id = "maya-widget-stable-style";
    style.textContent = `
      .maya-launcher{position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:999px;padding:14px 18px;background:#211913;color:#fff8e9;box-shadow:0 18px 44px rgba(20,15,11,.28);font-weight:800;cursor:pointer}
      .maya-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(20,15,11,.46);backdrop-filter:blur(14px);z-index:2147483001}
      .maya-overlay.is-open{display:flex}
      .maya-box{width:min(760px,calc(100vw - 30px));max-height:calc(100svh - 34px);overflow:auto;background:#f8efe0;color:#241c15;border:1px solid rgba(185,142,61,.44);border-radius:24px;box-shadow:0 32px 100px rgba(18,13,9,.42)}
      .maya-head{min-height:88px;padding:18px 22px;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;background:linear-gradient(135deg,#241c15,#4a321e);border-bottom:1px solid rgba(231,194,105,.42)}
      .maya-brand{display:flex;gap:14px;align-items:center}.maya-orb{width:54px;height:54px;border-radius:999px;background:radial-gradient(circle at 35% 30%,#fff2ad,#d9ae3e 68%,#9f7425);box-shadow:0 12px 28px rgba(217,174,62,.26)}
      .maya-brand h3{margin:0;color:#f4d377;font:700 22px Georgia,serif;letter-spacing:.08em}.maya-brand p{margin:4px 0 0;color:rgba(255,248,233,.74);font-size:14px}
      .maya-close{width:48px;height:48px;border:0;border-radius:14px;background:#d9ae3e;color:#241c15;font-size:26px;font-weight:900;cursor:pointer}
      .maya-content{padding:22px}.maya-kicker{color:#956b24;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
      .maya-title{margin:7px 0 10px;color:#241c15;font:600 clamp(26px,3vw,38px)/1.07 Georgia,serif}.maya-copy{margin:0 0 18px;color:#614b35;font-size:14px;line-height:1.55}
      .maya-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.maya-choice-card{min-height:176px;padding:19px;display:grid;align-content:start;gap:10px;background:#fffaf1;color:#241c15;border:1px solid rgba(146,104,43,.26);border-radius:18px;box-shadow:0 18px 38px rgba(70,47,24,.1);text-align:left;cursor:pointer}
      .maya-choice-card strong{font:600 22px/1.13 Georgia,serif;color:#241c15}.maya-choice-card span{color:#614b35;font-size:14px;line-height:1.45}
      .maya-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483002;width:min(720px,calc(100vw - 30px));height:min(760px,calc(100svh - 34px));display:none;grid-template-rows:auto minmax(0,1fr) auto;background:#f8efe0;border:1px solid rgba(185,142,61,.44);border-radius:24px;box-shadow:0 32px 100px rgba(18,13,9,.42);overflow:hidden}
      .maya-panel.is-open{display:grid}.maya-body{padding:18px;overflow:auto;background:linear-gradient(#fffaf1,#f8efe0)}
      .maya-foot{display:flex;gap:10px;padding:14px;border-top:1px solid rgba(146,104,43,.22);background:#f8efe0}.maya-input{flex:1;min-height:48px;padding:0 14px;background:#fffdf7;color:#241c15;border:1px solid rgba(146,104,43,.32);border-radius:14px;font-size:15px}.maya-send,.maya-primary{min-height:46px;padding:0 18px;border:0;border-radius:999px;background:#251d16;color:#fff8e9;font-weight:900;cursor:pointer}
      .maya-secondary{min-height:46px;padding:0 16px;border:1px solid rgba(146,104,43,.24);border-radius:999px;background:#efe0c7;color:#3a2b1d;font-weight:900;cursor:pointer}
      .maya-msg{max-width:82%;margin:0 0 12px;padding:12px 14px;border-radius:14px;font-size:15px;line-height:1.5}.maya-bot{background:#fffdf7;color:#2a2119;border:1px solid rgba(146,104,43,.18)}.maya-user{margin-left:auto;background:#30251c;color:#fff8e9}
      .maya-progress{height:7px;margin:12px 0 18px;overflow:hidden;background:#eadcc5;border-radius:999px}.maya-progress span{display:block;height:100%;background:linear-gradient(90deg,#b78325,#efcc72);border-radius:999px}
      .maya-field{display:grid;gap:8px}.maya-field label{color:#4f3c2a;font-size:12px;font-weight:900;text-transform:uppercase}.maya-field input{min-height:52px;padding:0 14px;background:#fbf3e7;color:#211a14;border:1px solid rgba(146,104,43,.32);border-radius:14px;font-size:16px}
      .maya-report{display:grid;gap:14px}.maya-remedy{padding:15px;background:#fffdf7;border:1px solid rgba(146,104,43,.25);border-left:5px solid #d3a83d;border-radius:16px;box-shadow:0 16px 34px rgba(70,47,24,.1)}.maya-remedy h4{margin:0 0 8px;color:#211a14;font:600 20px Georgia,serif}.maya-remedy p{margin:0 0 9px;color:#5d4935;font-size:13px;line-height:1.5}.maya-remedy a{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;background:#251d16;color:#fff8e9;border-radius:999px;text-decoration:none;font-weight:900}
      .maya-disclaimer{padding:12px;background:#f7ead6;color:#5d4935;border-radius:14px;font-size:12px;line-height:1.5}.maya-whatsapp{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;background:#176f46;color:#fffaf0;border-radius:999px;text-decoration:none;font-weight:900}
      @media(max-width:720px){.maya-choice-grid{grid-template-columns:1fr}.maya-panel{width:100vw;height:100svh;border-radius:0}.maya-box{width:calc(100vw - 20px)}.maya-launcher{right:14px;bottom:14px}.maya-msg{max-width:92%}}
    `;
    document.head.appendChild(style);
  }

  function html(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  }

  function makeShell() {
    css();
    document.body.insertAdjacentHTML("beforeend", `
      <button class="maya-launcher" type="button">Talk to Maya</button>
      <div class="maya-overlay" id="mayaChoice">
        <div class="maya-box">
          <div class="maya-head">
            <div class="maya-brand"><div class="maya-orb"></div><div><h3>MAYA</h3><p>Veshannastro AI Guide</p></div></div>
            <button class="maya-close" type="button" data-close>×</button>
          </div>
          <div class="maya-content">
            <div class="maya-kicker">Choose your Maya path</div>
            <div class="maya-title">What would you like Maya to prepare?</div>
            <p class="maya-copy">Select one guidance path. The practical astrologer stays separate from the gemstone recommendation tool.</p>
            <div class="maya-choice-grid">
              <button class="maya-choice-card" type="button" data-mode="gemstone"><strong>Gemstone Bracelet Recommendation</strong><span>Free remedy-style bracelet suggestions using your birth details.</span></button>
              <button class="maya-choice-card" type="button" data-mode="astrologer"><strong>Practical AI Astrologer</strong><span>Ask Maya your astrology question and continue with the AI guide.</span></button>
            </div>
          </div>
        </div>
      </div>
      <section class="maya-panel" id="mayaPanel">
        <div class="maya-head">
          <div class="maya-brand"><div class="maya-orb"></div><div><h3>MAYA</h3><p>Veshannastro AI Guide</p></div></div>
          <button class="maya-close" type="button" data-close>×</button>
        </div>
        <div class="maya-body" id="mayaBody"></div>
        <form class="maya-foot" id="mayaChatFoot"><input class="maya-input" id="mayaChatInput" placeholder="Ask Maya..." autocomplete="off"><button class="maya-send" type="submit">Send</button></form>
      </section>
    `);
  }

  function openChoice() {
    closePanel();
    document.getElementById("mayaChoice").classList.add("is-open");
  }

  function closeChoice() {
    document.getElementById("mayaChoice").classList.remove("is-open");
  }

  function openPanel() {
    closeChoice();
    document.getElementById("mayaPanel").classList.add("is-open");
  }

  function closePanel() {
    document.getElementById("mayaPanel").classList.remove("is-open");
  }

  function closeAll() {
    closeChoice();
    closePanel();
  }

  function msg(text, who) {
    const body = document.getElementById("mayaBody");
    const div = document.createElement("div");
    div.className = "maya-msg " + (who === "user" ? "maya-user" : "maya-bot");
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  async function postJson(paths, payload) {
    let lastError = null;
    for (const path of paths) {
      try {
        const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (res.ok && data.ok !== false) return data;
        lastError = new Error(data.error || data.message || "Request failed");
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Connection issue");
  }

  function renderGemstone() {
    const foot = document.getElementById("mayaChatFoot");
    const body = document.getElementById("mayaBody");
    foot.style.display = "none";
    if (state.gemLoading) {
      body.innerHTML = `<div class="maya-kicker">Maya is preparing your report</div><div class="maya-title">Reading your remedy path...</div><p class="maya-copy">This usually takes a moment.</p><div class="maya-progress"><span style="width:82%"></span></div>`;
      return;
    }
    if (state.gemResult) {
      renderReport();
      return;
    }
    const [key, label, title, placeholder, type] = gemSteps[state.gemStep];
    const pct = Math.round(((state.gemStep + 1) / gemSteps.length) * 100);
    body.innerHTML = `
      <div class="maya-kicker">Step ${state.gemStep + 1} of 5</div>
      <div class="maya-title">${html(title)}</div>
      <p class="maya-copy">${key === "tob" ? "If you do not know it, use the button below. Maya will safely use noon fallback." : "This helps Maya prepare a more personal bracelet recommendation."}</p>
      <div class="maya-progress"><span style="width:${pct}%"></span></div>
      <div class="maya-field" style="position:relative">
        <label>${html(label)}</label>
        <input id="mayaGemInput" type="${key === "birth_city" ? "text" : type}" value="${html(state.gemData[key])}" placeholder="${html(placeholder)}" autocomplete="off">
        ${key === "birth_city" ? '<ul id="gemCityList" style="display:none;position:absolute;left:0;right:0;top:100%;margin:0;padding:0;list-style:none;background:#fffdf7;border:1px solid rgba(146,104,43,.32);border-radius:0 0 14px 14px;z-index:9999;max-height:220px;overflow-y:auto"></ul>' : ""}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">
        ${state.gemStep ? '<button class="maya-secondary" type="button" id="gemBack">Back</button>' : ""}
        ${key === "tob" ? '<button class="maya-secondary" type="button" id="gemUnknown">Time of birth unknown</button>' : ""}
        <button class="maya-primary" type="button" id="gemNext">${state.gemStep === gemSteps.length - 1 ? "Prepare my remedy report" : "Continue"}</button>
      </div>
    `;
    const input = document.getElementById("mayaGemInput");
    input.focus();
    input.oninput = () => (state.gemData[key] = input.value);

    // ── City autocomplete (Nominatim, free, no API key) ──────────────────
    if (key === "birth_city") {
      // Reset resolved coords whenever user edits the field
      state.gemData.latitude = null;
      state.gemData.longitude = null;
      state.gemData.timezone = "";

      let _cityTimer = null;
      const list = document.getElementById("gemCityList");

      function showCityList(items) {
        if (!items || !items.length) { list.style.display = "none"; return; }
        list.innerHTML = items.map((p, i) =>
          `<li data-i="${i}" style="padding:10px 14px;cursor:pointer;font-size:14px;color:#241c15;border-bottom:1px solid rgba(146,104,43,.12)">${html(p.display_name)}</li>`
        ).join("");
        list.style.display = "block";
        list.querySelectorAll("li").forEach((li, i) => {
          li.addEventListener("mouseenter", () => li.style.background = "#f5e8cd");
          li.addEventListener("mouseleave", () => li.style.background = "");
          li.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep focus on input
            const place = items[i];
            const lat = parseFloat(place.lat);
            const lon = parseFloat(place.lon);
            // Derive timezone offset string from lon (rough but sufficient fallback)
            const offsetHrs = Math.round(lon / 15);
            const sign = offsetHrs >= 0 ? "+" : "-";
            const absH = String(Math.abs(offsetHrs)).padStart(2, "0");
            const tzFallback = `Etc/GMT${sign}${Math.abs(offsetHrs)}`;
            input.value = place.display_name;
            state.gemData.birth_city = place.display_name;
            state.gemData.latitude = lat;
            state.gemData.longitude = lon;
            // Prefer named timezone from Nominatim extratags if available
            state.gemData.timezone = (place.extratags && place.extratags.timezone) || tzFallback;
            list.style.display = "none";
          });
        });
      }

      input.oninput = () => {
        state.gemData.birth_city = input.value;
        // Clear coords since user is typing again
        state.gemData.latitude = null;
        state.gemData.longitude = null;
        state.gemData.timezone = "";
        clearTimeout(_cityTimer);
        const q = input.value.trim();
        if (q.length < 2) { list.style.display = "none"; return; }
        _cityTimer = setTimeout(async () => {
          try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&extratags=1&limit=6&featuretype=city`;
            const r = await fetch(url, { headers: { "Accept-Language": "en" } });
            const data = await r.json();
            showCityList(data);
          } catch (_) { list.style.display = "none"; }
        }, 350);
      };

      // Close list on outside click
      document.addEventListener("click", function hideCityList(e) {
        if (!e.target.closest("#mayaGemInput") && !e.target.closest("#gemCityList")) {
          list.style.display = "none";
          document.removeEventListener("click", hideCityList);
        }
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    document.getElementById("gemBack")?.addEventListener("click", () => {
      state.gemStep = Math.max(0, state.gemStep - 1);
      renderGemstone();
    });
    document.getElementById("gemUnknown")?.addEventListener("click", () => {
      state.gemData.tob = "12:00";
      state.gemStep += 1;
      renderGemstone();
    });
    document.getElementById("gemNext").addEventListener("click", () => {
      state.gemData[key] = input.value;
      // For birth_city, warn if no place was selected from the list
      if (key === "birth_city") {
        if (!String(input.value || "").trim()) { input.focus(); return; }
        // If coords weren't resolved via the dropdown, do a best-effort lookup
        if (!state.gemData.latitude) {
          const q = input.value.trim();
          fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&extratags=1&limit=1`, { headers: { "Accept-Language": "en" } })
            .then(r => r.json())
            .then(data => {
              if (data && data[0]) {
                state.gemData.latitude = parseFloat(data[0].lat);
                state.gemData.longitude = parseFloat(data[0].lon);
                state.gemData.timezone = (data[0].extratags && data[0].extratags.timezone) || "";
              }
            })
            .catch(() => {})
            .finally(() => {
              state.gemStep += 1;
              renderGemstone();
            });
          return; // wait for fetch then advance
        }
      }
      if (key !== "tob" && key !== "birth_city" && !String(input.value || "").trim()) {
        input.focus();
        return;
      }
      if (state.gemStep === gemSteps.length - 1) submitGemstone();
      else {
        state.gemStep += 1;
        renderGemstone();
      }
    });
  }

  function dobRoot(dob) {
    let total = String(dob || "").replace(/\D/g, "").split("").reduce((sum, n) => sum + Number(n), 0);
    while (total > 9) total = String(total).split("").reduce((sum, n) => sum + Number(n), 0);
    return total || 4;
  }

  function fallbackResult(reason) {
    const primary = fallbackMap[dobRoot(state.gemData.dob)] || fallbackMap[4];
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 90);
    const period = start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " to " + end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const card = (p) => ({ product_id: p[0], name: p[1], why: p[2], dasha_gochar_reason: reason || "Exact chart service was unavailable, so Maya used safe DOB fallback.", best_period: period, wearing_instruction: "Wear on your receptive wrist after a short morning prayer or sankalp.", price: "Contact for price", product_url: "/bracelets?ref=maya&id=" + p[0] });
    return { message: "Maya prepared a safe DOB-based remedy report from the available bracelet mapping.", recommendations: [card(primary), card(["seven-chakra-black-tourmaline", "7 Chakra + Black Tourmaline Bracelet", "General protection support for grounding, cleansing, and aura balance."])], disclaimer: "Gemstone bracelets are spiritual/remedial support and are not a guaranteed replacement for medical, financial, legal, or professional advice." };
  }

  async function submitGemstone() {
    state.gemLoading = true;
    renderGemstone();
    try {
      state.gemResult = await postJson(["/api/gemstone/recommend"], { session_id: state.chatSession, ...state.gemData, tob: state.gemData.tob || "12:00" });
    } catch (err) {
      // Sanitize raw fetch/parse errors (e.g. HTML 404 page) so they never
      // bleed into the displayed card fields.
      const safeReason = (err && err.message && err.message.length < 120 && !/token|JSON|<!|<html/i.test(err.message))
        ? err.message
        : "Exact chart service was unavailable, so Maya used safe DOB fallback.";
      state.gemResult = fallbackResult(safeReason);
    }
    state.gemLoading = false;
    renderGemstone();
  }

  function renderReport() {
    const body = document.getElementById("mayaBody");
    const result = state.gemResult || {};
    const cards = result.cards || result.recommendations || [];
    const text = encodeURIComponent("Maya Remedy Report for " + state.gemData.name + "\n" + cards.map((c, i) => (i + 1) + ". " + c.name).join("\n"));
    const phone = String(state.gemData.whatsapp || "").replace(/\D/g, "");
    body.innerHTML = `
      <div class="maya-report">
        <div><div class="maya-kicker">Maya Remedy Report</div><div class="maya-title">${html(state.gemData.name)}, your bracelet path is ready.</div><p class="maya-copy">${html(result.message)}</p></div>
        ${cards.slice(0, 3).map((c) => `<article class="maya-remedy"><h4>${html(c.name)}</h4><p>${html(c.why || c.planetary_reason)}</p><p><strong>Dasha/Gochar:</strong> ${html(c.dasha_gochar_reason)}</p><p><strong>Best period:</strong> ${html(c.best_period)}</p><p><strong>Wearing:</strong> ${html(c.wearing_instruction)}</p><p><strong>${html(c.price)}</strong></p><a href="${html(c.product_url)}">Order Now</a></article>`).join("")}
        <a class="maya-whatsapp" target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${text}">Send result on WhatsApp</a>
        <button class="maya-secondary" type="button" id="gemRestart">Start again</button>
        <div class="maya-disclaimer">${html(result.disclaimer)}</div>
      </div>
    `;
    document.getElementById("gemRestart").onclick = () => {
      state.gemStep = 0;
      state.gemResult = null;
      state.gemData = { name: "", whatsapp: "", dob: "", tob: "", birth_city: "", latitude: null, longitude: null, timezone: "" };
      renderGemstone();
    };
  }

  function openGemstone() {
    state.mode = "gemstone";
    state.gemStep = 0;
    state.gemResult = null;
    openPanel();
    renderGemstone();
  }

  function openAstrologer() {
    state.mode = "astrologer";
    document.getElementById("mayaChatFoot").style.display = "flex";
    document.getElementById("mayaBody").innerHTML = "";
    openPanel();
    msg("Namaste, I am Maya. Ask me your practical astrology question.", "bot");
  }

  async function sendChat(text) {
    msg(text, "user");
    try {
      const data = await postJson(["/message", "/api/message", "/chat", "/api/chat"], { session_id: state.chatSession, message: text, text });
      msg(data.reply || data.message || data.response || "Maya is here with you. Please ask one clear question.", "bot");
    } catch (err) {
      msg("Connection issue with Maya right now. Please try again in a moment.", "bot");
    }
  }

  function bind() {
    document.addEventListener("click", (event) => {
      const target = event.target;
      const text = String(target.innerText || target.textContent || "").toLowerCase();
      if (target.closest(".maya-launcher") || text.includes("talk to maya") || text.includes("talk to maaya") || text.includes("ask ai")) {
        event.preventDefault();
        openChoice();
      }
    });
    document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", closeAll));
    document.querySelector('[data-mode="gemstone"]').addEventListener("click", openGemstone);
    document.querySelector('[data-mode="astrologer"]').addEventListener("click", openAstrologer);
    document.getElementById("mayaChatFoot").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("mayaChatInput");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendChat(text);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      makeShell();
      bind();
      closeAll();
    });
  } else {
    makeShell();
    bind();
    closeAll();
  }
})();
