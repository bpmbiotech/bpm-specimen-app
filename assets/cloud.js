/* 雲端存取層：登入、分頁查詢、RPC
 * 只用 fetch，沒有外部套件；金鑰是 publishable（前端專用）。 */
(function () {
  const CFG = window.CLOUD_CONFIG;
  if (!CFG || !CFG.url) { window.Cloud = null; return; }
  const BASE = String(CFG.url).replace(/\/+$/, "");
  const SKEY = "bpm_cloud_session";

  const loadSession = () => { try { return JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { return null; } };
  const saveSession = (s) => { try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) {} };

  async function raw(path, { method = "GET", body, headers = {}, token } = {}) {
    const h = { apikey: CFG.key, ...headers };
    if (token) h.Authorization = "Bearer " + token;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error_description || data.msg || data.error)) || ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  async function signIn(email, password) {
    const d = await raw("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    const s = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      email: (d.user && d.user.email) || email,
      uid: (d.user && d.user.id) || null,
      expires_at: Date.now() + ((d.expires_in || 3600) - 60) * 1000,
    };
    saveSession(s);
    return s;
  }

  async function refresh() {
    const s = loadSession();
    if (!s || !s.refresh_token) return null;
    try {
      const d = await raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refresh_token } });
      const n = {
        access_token: d.access_token,
        refresh_token: d.refresh_token || s.refresh_token,
        email: s.email,
        uid: s.uid,
        expires_at: Date.now() + ((d.expires_in || 3600) - 60) * 1000,
      };
      saveSession(n);
      return n;
    } catch (e) { saveSession(null); return null; }
  }

  async function token() {
    const s = loadSession();
    if (!s) return null;
    if (Date.now() < s.expires_at) return s.access_token;
    const n = await refresh();
    return n ? n.access_token : null;
  }

  async function call(path, opts = {}) {
    const t = await token();
    if (!t) throw new Error("未登入或登入已過期");
    return raw(path, { ...opts, token: t, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  }

  const rpc = (fn, body = {}) => call("/rest/v1/rpc/" + fn, { method: "POST", body });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* 一次抓完整快照（1 個請求取代 113 次分頁）
   * 冷啟動或資料量大時偶爾會出現 statement timeout／閘道逾時，這裡自動重試。 */
  async function snapshot(opts = {}) {
    const tries = opts.tries || 4;
    const onRetry = opts.onRetry || (() => {});
    let last = null;
    for (let i = 0; i < tries; i++) {
      try {
        return await rpc("fn_snapshot", {});
      } catch (e) {
        last = e;
        const msg = String((e && e.message) || "");
        const retryable = (e && [502, 503, 504].includes(e.status)) ||
          /timeout|timed out|upstream|ECONNRESET|Failed to fetch|NetworkError|fetch failed/i.test(msg);
        if (!retryable || i === tries - 1) break;
        await sleep(1200 * (i + 1));
        try { onRetry(i + 2, msg); } catch (x) { /* ignore */ }
      }
    }
    throw last;
  }

  async function myRole() {
    const r = await call("/rest/v1/app_user?select=id,role,display_name&limit=1");
    return (r && r[0]) || null;
  }

  const signOut = () => saveSession(null);
  const sessionEmail = () => { const s = loadSession(); return s && s.email; };
  const sessionUid = () => { const s = loadSession(); return s && s.uid; };
  const hasSession = () => !!loadSession();

  window.Cloud = { CFG, signIn, signOut, token, call, rpc, snapshot, myRole, sessionEmail, sessionUid, hasSession };
})();
