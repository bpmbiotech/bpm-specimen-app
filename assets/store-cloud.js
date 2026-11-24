/* 雲端版 Store：介面與 store.js 相同，但資料來自 Supabase、寫入走 RPC
 * 讀取全部同步（開站時已把快照放進記憶體），寫入是非同步（app.js 已 await）。 */
(function () {
  const C = window.Cloud;
  let S = null;                  // 真實的 seed 物件（app.js 持有同一參考）
  let META = { status: new Map(), ids: new Map(), byId: new Map(), bySid: new Map(), boxMeta: {} };
  let lists = [], movements = [];
  let role = "operator";
  let email = "";

  const KEYOF = (box, pos, sid) => box + "|" + pos + "|" + sid;
  const num = (v) => (v == null || v === "" ? "" : String(v));

  /* ---------- 快照 → seed ---------- */
  function build(snap) {
    const studies = [];
    const sidx = new Map();
    const ensureStudy = (name) => {
      if (!name) name = "（未分類）";
      if (!sidx.has(name)) { sidx.set(name, studies.length); studies.push(name); }
      return sidx.get(name);
    };

    const order = [], cab = {}, grid = {};
    snap.cabinets.forEach(([code, layers, drawers]) => {
      order.push(code);
      cab[code] = { layers, drawers };
      grid[code] = [layers, Math.max.apply(null, drawers), 5, 4];  // 後兩項稍後依盒資料修正
    });

    const boxMeta = {};
    const tiers = {};                       // "Q1" -> [5,2,2,2,2]
    const maxTier = {}, maxSeq = {}, maxDrawer = {};
    const boxes = {};
    snap.boxes.forEach(([code, cabCode, l, d, t, seq, rows, cols]) => {
      boxMeta[code] = { cab: cabCode, l, d, t, seq, rows, cols };
      if (!boxes[cabCode]) boxes[cabCode] = {};
      boxes[cabCode][code] = {};
      const k = cabCode + l;
      const arr = tiers[k] || (tiers[k] = []);
      arr[d - 1] = Math.max(arr[d - 1] || 0, t);
      maxTier[cabCode] = Math.max(maxTier[cabCode] || 0, t);
      maxSeq[cabCode] = Math.max(maxSeq[cabCode] || 0, seq);
      maxDrawer[cabCode] = Math.max(maxDrawer[cabCode] || 0, d);
    });
    order.forEach((c) => {
      const info = cab[c] || { layers: 2, drawers: [5, 5] };
      grid[c] = [
        info.layers,
        Math.max.apply(null, info.drawers),
        maxTier[c] || 5,
        maxSeq[c] || 4,
      ];
    });

    // 區域格（kind 3）
    snap.regions.forEach(([box, slot, label]) => {
      const c = box[0];
      if (!boxes[c] || !boxes[c][box]) return;
      (boxes[c][box][slot] || (boxes[c][box][slot] = [])).push([ensureStudy(label), "", "", "", 3]);
    });

    // 檢體
    const status = new Map(), ids = new Map(), byId = new Map(), bySid = new Map();
    const posRows = new Map();              // box|pos -> [{study,sid,date,conf}]
    snap.aliquots.forEach(([box, slot, study, sid, vol, indate, kind, pid, id, st, conf]) => {
      if (!box || !slot) return;            // 505 筆無位置：雲端有、地圖不顯示
      const s = sid || "";
      const key = KEYOF(box, slot, s);
      ids.set(key, id);
      byId.set(id, key);
      if (st && st !== "in_stock") status.set(key, st === "drawn" ? "out" : "out");
      const c = box[0];
      if (!boxes[c] || !boxes[c][box]) return;
      const arr = boxes[c][box][slot] || (boxes[c][box][slot] = []);
      arr.push([ensureStudy(study), s, num(vol), indate || "", kind || 0, pid || ""]);
      const pk = box + "|" + slot;
      const list = posRows.get(pk) || [];
      list.push({ study, sid: s, date: indate || "", conf: !!conf });
      posRows.set(pk, list);
      if (s) {
        const b = bySid.get(s) || [];
        b.push({ key, sid: s, study, box, pos: slot, vol: num(vol), date: indate || "", kind: kind || 0 });
        bySid.set(s, b);
      }
    });

    // 已知位置衝突（給交易紀錄頁）
    const conflicts = [];
    posRows.forEach((rows, pk) => {
      if (rows.length < 2) return;
      const [box, pos] = pk.split("|");
      const kept = rows.find((r) => !r.conf) || rows[0];
      const removed = rows.filter((r) => r !== kept);
      conflicts.push({ box, pos, kept: { study: kept.study, sid: kept.sid, date: kept.date }, removed });
    });

    const boxDims = {};
    Object.keys(boxMeta).forEach((code) => {
      const m = boxMeta[code];
      if (m.rows * m.cols !== 81) boxDims[code] = [m.rows, m.cols];
    });

    const drawerRows = {};
    Object.keys(tiers).forEach((k) => { drawerRows[k] = tiers[k].map((v) => v || 5); });

    const zoneAreas = snap.zones.map(([c, layer, drawers, boxesN, cells, mode, study]) => ({
      cab: c, layer, drawers: drawers || [], boxes: boxesN, cells, mode, study,
    }));

    const seed = {
      order, grid, studies, boxes, boxDims, drawerRows, zoneAreas, conflicts,
      tsghNoPid: {}, generated_at: snap.generated_at,
    };
    return { seed, meta: { status, ids, byId, bySid, boxMeta } };
  }

  /* ---------- 讀取 ---------- */
  function boxEntries(cabCode, code) {
    const out = [];
    const box = (S.boxes[cabCode] || {})[code] || {};
    for (const pos in box) for (const e of box[pos]) {
      const sid = e[1];
      out.push({
        key: KEYOF(code, pos, sid), box: code, pos, sid,
        study: S.studies[e[0]], vol: e[2], date: e[3], kind: e[4] || 0, pid: e[5] || "", seed: true,
      });
    }
    return out;
  }
  function allAliquots(cabCode) {
    const cabs = cabCode ? [cabCode] : S.order;
    const arr = [];
    for (const c of cabs) {
      const set = S.boxes[c] || {};
      for (const code in set) arr.push(...boxEntries(c, code));
    }
    return arr;
  }
  function status(key) { return META.status.get(key) || "in_stock"; }
  function setStatus(key, st) { if (st === "in_stock") META.status.delete(key); else META.status.set(key, st); }

  let idx = null;
  function byKey(key) {
    if (!idx) { idx = new Map(); for (const a of allAliquots()) idx.set(a.key, a); }
    return idx.get(key);
  }
  const find = (sid, study) => allAliquots().filter((a) => a.sid === sid && (!study || a.study === study));
  function getList(id) { return lists.find((l) => l.id === id); }

  /* ---------- 雲端讀取清單／紀錄 ---------- */
  async function fetchLists() {
    const rows = await C.call("/rest/v1/demand_list?select=id,list_no,name,list_type,status,created_at,demand_item(aliquot_id,status,qty,note)&order=created_at.desc");
    lists = rows.map((r) => ({
      id: r.id, no: r.list_no, name: r.name,
      type: r.list_type === "count" ? "count" : "request",
      createdAt: r.created_at, dbStatus: r.status,
      items: (r.demand_item || []).map((it) => {
        const key = META.byId.get(it.aliquot_id);
        const a = key ? byKey(key) : null;
        return {
          key, aliquotId: it.aliquot_id, qty: it.qty || 1,
          sid: a ? a.sid : "", study: a ? a.study : "", box: a ? a.box : "", pos: a ? a.pos : "",
          vol: a ? a.vol : "",
          status: it.status === "drawn" ? "picked" : it.status === "missing" ? "missing" : "pending",
          alts: a ? (META.bySid.get(a.sid) || []) : [],
        };
      }).filter((it) => it.key),
    }));
    return lists;
  }
  async function fetchMovements() {
    const rows = await C.call("/rest/v1/movement?select=id,move_type,at,sid,study,box_code,slot,operator,unit,purpose,note,draw_batch(batch_no),import_batch(batch_no)&order=at.desc&limit=500");
    movements = rows.map((m) => ({
      id: m.id, at: m.at,
      type: m.move_type === "out" ? "OUT" : "IN",
      batch: (m.draw_batch && m.draw_batch.batch_no) || (m.import_batch && m.import_batch.batch_no) || "",
      sid: m.sid, study: m.study, box: m.box_code, pos: m.slot,
      recipient: m.operator, operator: m.operator, unit: m.unit, purpose: m.purpose, note: m.note,
      pickupAt: m.at,
    }));
    return movements;
  }

  async function reloadSnapshot() {
    const snap = await C.snapshot();
    const next = build(snap);
    for (const k of Object.keys(S)) delete S[k];      // app.js 持有同一個 seed 物件
    Object.assign(S, next.seed);
    META = next.meta;
    idx = null;
    await fetchLists();
    await fetchMovements();
  }

  /* ---------- 寫入（非同步） ---------- */
  async function createList(name, type) {
    const row = await C.rpc("fn_create_list", {
      p_name: name, p_type: type === "count" ? "count" : "demand", p_by: role,
    });
    const l = {
      id: row.id, no: row.list_no, name: row.name, type: "request",
      createdAt: row.created_at, dbStatus: row.status, items: [],
    };
    lists.unshift(l);
    return l;
  }

  async function addItems(listId, items) {
    const l = getList(listId);
    if (!l) return 0;
    const ids = items.map((it) => META.ids.get(it.key)).filter(Boolean);
    if (ids.length) await C.rpc("fn_add_items", { p_list: listId, p_aliquot_ids: ids });
    items.forEach((it) => {
      if (l.items.some((x) => x.key === it.key)) { const d = l.items.find((x) => x.key === it.key); d.qty += it.qty || 1; return; }
      l.items.push({
        key: it.key, sid: it.sid, study: it.study, box: it.box, pos: it.pos,
        vol: it.vol || "", qty: it.qty || 1, status: "pending",
        alts: META.bySid.get(it.sid) || [],
      });
    });
    return ids.length;
  }

  async function deleteList(id) {
    await C.rpc("fn_delete_list", { p_list: id });
    lists = lists.filter((l) => l.id !== id);
  }

  /* 領出：一次 RPC，DB 產生 P 單 */
  async function drawOut(listId, items, meta) {
    meta = meta || {};
    const picked = [];
    const keyById = new Map();
    items.forEach((it) => {
      const id = META.ids.get(it.key);
      if (id) { picked.push(id); keyById.set(id, it.key); }
    });
    if (!picked.length) return { batch_no: null, drawn: [], missing: [], results: new Map() };

    const res = await C.rpc("fn_draw_out_selected", {
      p_list: listId,
      p_aliquot_ids: picked,
      p_operator: (meta.recipient || "").trim() || role,
      p_unit: meta.unit || null,
      p_purpose: (meta.purpose || "").trim() || "批次領出",
      p_note: meta.note || null,
    });

    const results = new Map();
    const drawn = (res.drawn || []).map((id) => keyById.get(id)).filter(Boolean);
    const missing = (res.missing || []).map((id) => keyById.get(id)).filter(Boolean);
    drawn.forEach((k) => { META.status.set(k, "out"); results.set(k, "ok"); });
    missing.forEach((k) => results.set(k, "miss"));

    const l = getList(listId);
    if (l) l.items.forEach((it) => {
      const r = results.get(it.key);
      if (r === "ok") it.status = "picked";
      else if (r === "miss" && it.status === "pending") it.status = "missing";
    });

    await fetchMovements();
    return { batch_no: res.batch_no, drawn, missing, results };
  }

  async function markMissing(listId, keys) {
    const ids = keys.map((k) => META.ids.get(k)).filter(Boolean);
    if (listId && ids.length) await C.rpc("fn_mark_missing_aliquots", { p_list: listId, p_aliquot_ids: ids, p_note: "標記缺" });
    const l = getList(listId);
    if (l) l.items.forEach((it) => { if (keys.indexOf(it.key) >= 0) it.status = "missing"; });
  }

  /* 新增檢體匯入：DB 驗證 + 發 I 單，成功後重抓快照讓地圖看得到 */
  async function importRows(rows) {
    const payload = rows.map((r) => ({
      study: r.study,
      sid: r.sid,
      volume: r.vol === "" || r.vol == null ? null : String(r.vol),
      indate_raw: r.date || null,
      box_code: String(r.alloc || "").slice(0, 5),
      slot: String(r.alloc || "").slice(5),
    }));
    const res = await C.rpc("fn_import_aliquots", {
      p_rows: payload, p_operator: role, p_file_name: "前端匯入", p_unit: null,
    });
    await reloadSnapshot();
    return { batch: res.batch_no, inserted: res.inserted, errors: res.detail || [] };
  }

  /* ---------- 安裝 ---------- */
  function install() {
    role = window.CLOUD_ROLE || "operator";
    email = window.CLOUD_EMAIL || "";
    window.Store = {
      cloud: true,
      get S() { return S; },
      KEYOF,
      get role() { return role; },
      get email() { return email; },
      setRole() { /* 雲端角色由 app_user 決定 */ },
      status, setStatus, boxEntries, allAliquots, find, byKey,
      get lists() { return lists; },
      get movements() { return movements; },
      createList, getList, deleteList, addItems,
      drawOut, markMissing, importRows,
      addExtra() { throw new Error("雲端模式不支援直接新增位置"); },
      addMovement() { /* 由 RPC 寫入 */ },
      nextNo() { throw new Error("雲端模式由資料庫發號"); },
      dayCode(d) {
        const p = (n) => String(n).padStart(2, "0");
        const t = d || new Date();
        return String(t.getFullYear() % 100) + p(t.getMonth() + 1) + p(t.getDate());
      },
      save() { /* 不需存檔，資料已即時寫回雲端 */ },
      reset() { throw new Error("雲端資料不可由前端清除"); },
      reloadSnapshot, fetchLists, fetchMovements,
    };
  }

  async function init(snap) {
    const built = build(snap);
    S = built.seed;
    META = built.meta;
    window.SEED = S;
    install();
    await fetchLists();
    await fetchMovements();
  }

  window.CloudStore = { init, build };
})();
