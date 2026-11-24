/* 啟動器：
 *   有 cloud.config.js → 登入 Supabase，抓快照後載入 app
 *   沒有設定或網址加 ?offline=1 → 原本的本機示範（seed.js + localStorage）
 */
(function () {
  const CFG = window.CLOUD_CONFIG;
  const qs = new URLSearchParams(location.search);
  const wantsOffline = qs.get("offline") === "1";
  const canOffline = !CFG || CFG.allowOffline !== false;   // 部署版會關掉離線模式
  const offline = !CFG || !CFG.url || !window.Cloud || (wantsOffline && canOffline);

  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement("script");
    // 部署版會由 build_site.ps1 寫入 CLOUD_ASSET_VER，避免 GitHub Pages 快取舊檔
    s.src = src + (window.CLOUD_ASSET_VER ? "?v=" + window.CLOUD_ASSET_VER : "");
    s.onload = () => res();
    s.onerror = () => rej(new Error("載入失敗：" + src));
    document.body.appendChild(s);
  });

  function badge(text) {
    const el = document.querySelector(".brand .badge");
    if (el) el.textContent = text;
  }

  async function loadApp() {
    await load("assets/xlsx.full.min.js");
    await load("assets/xlsxlib.js");
    await load("assets/mergeplan.js");
    await load("assets/xlsxform.js");
    await load("assets/app.js");
    addLogout();
  }

  function addLogout() {
    if (!window.Store || !window.Store.cloud) return;
    const box = document.querySelector(".role");
    if (!box) return;
    box.innerHTML = "";
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.gap = "8px";
    const who = document.createElement("span");
    who.className = "muted";
    who.style.fontSize = "12px";
    who.title = window.CLOUD_EMAIL || "";
    who.textContent = (window.CLOUD_EMAIL || "").split("@")[0];
    const b = document.createElement("button");
    b.className = "btn";
    b.style.padding = "3px 8px";
    b.style.fontSize = "12px";
    b.textContent = "登出";
    b.onclick = () => { window.Cloud.signOut(); location.reload(); };
    box.appendChild(who);
    box.appendChild(b);
  }

  async function bootOffline() {
    badge("原型 · 本機資料");
    await load("assets/seed.js");
    await load("assets/store.js");
    await loadApp();
  }

  /* ---------- 登入畫面 ---------- */
  function overlay(html) {
    let el = document.getElementById("bootmask");
    if (!el) {
      el = document.createElement("div");
      el.id = "bootmask";
      el.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#f2f4f8;font-family:inherit";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="width:340px;background:#fff;border:1px solid #dfe3ea;border-radius:12px;padding:24px;box-shadow:0 10px 30px rgba(20,40,80,.08)">
      ${html}</div>`;
    return el;
  }
  function closeOverlay() { const el = document.getElementById("bootmask"); if (el) el.remove(); }

  function loginForm(err) {
    overlay(`
      <h2 style="margin:0 0 4px;font-size:17px;color:#1F3864">BPM 檢體管理系統</h2>
      <div style="color:#6b7280;font-size:12px;margin-bottom:14px">雲端模式 · 請以公司帳號登入</div>
      ${err ? `<div style="background:#fdecea;color:#B03A2E;border-radius:6px;padding:8px 10px;font-size:12px;margin-bottom:10px">${err}</div>` : ""}
      <label style="display:block;font-size:12px;color:#374151;margin-bottom:4px">Email</label>
      <input id="ck_email" type="email" autocomplete="username" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #cfd6e4;border-radius:6px;margin-bottom:10px" value="${window.Cloud.sessionEmail() || ""}">
      <label style="display:block;font-size:12px;color:#374151;margin-bottom:4px">密碼</label>
      <input id="ck_pw" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #cfd6e4;border-radius:6px;margin-bottom:14px">
      <button id="ck_go" style="width:100%;padding:9px;border:0;border-radius:6px;background:#1F3864;color:#fff;font-size:13px;cursor:pointer">登入</button>
      <div style="font-size:11px;color:#9aa3b2;margin-top:12px;text-align:center">無帳號請洽系統管理員建立（app_user）</div>
    `);
    const go = () => submit(document.getElementById("ck_email").value.trim(), document.getElementById("ck_pw").value);
    document.getElementById("ck_go").onclick = go;
    document.getElementById("ck_pw").onkeydown = (e) => { if (e.key === "Enter") go(); };
  }

  function loading(msg) {
    overlay(`<div style="text-align:center;padding:10px 0">
      <div style="font-size:13px;color:#1F3864;font-weight:600;margin-bottom:6px">${msg}</div>
      <div style="font-size:12px;color:#6b7280">首次載入約 5–10 秒</div></div>`);
  }

  async function startApp(snap) {
    const me = await window.Cloud.myRole().catch(() => null);
    window.CLOUD_ROLE = (me && me.role) || "operator";
    window.CLOUD_EMAIL = (me && me.display_name) || window.Cloud.sessionEmail() || "";
    badge("雲端 · " + (window.Cloud.sessionEmail() || ""));
    await load("assets/store-cloud.js");
    await window.CloudStore.init(snap);
    closeOverlay();
    await loadApp();
  }

  async function submit(email, password) {
    try {
      loading("登入中…");
      await window.Cloud.signIn(email, password);
      loading("讀取雲端資料…");
      const snap = await window.Cloud.snapshot();
      await startApp(snap);
    } catch (e) {
      loginForm(e.message || "登入失敗");
    }
  }

  async function bootCloud() {
    loginForm("");
    if (!window.Cloud.hasSession()) return;
    try {
      loading("讀取雲端資料…");
      const snap = await window.Cloud.snapshot();
      await startApp(snap);
    } catch (e) {
      window.Cloud.signOut();
      loginForm("登入已過期，請重新登入");
    }
  }

  (offline ? bootOffline() : bootCloud()).catch((e) => {
    document.body.insertAdjacentHTML("afterbegin",
      `<pre style="background:#fdecea;color:#B03A2E;padding:12px;margin:0">啟動失敗：${e.message}</pre>`);
  });
})();
