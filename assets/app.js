/* BPM檢體管理系統 — 本機原型 */
(function () {
  const S = window.SEED, St = window.Store;
  const COLOR = {
    NTUH: "#1F3864", NTUH_old: "#6B8FC9", NTUH_Serum: "#2E7D32", NTUH_old_Serum: "#81C784",
    TSGH: "#C0392B", BC1: "#8E44AD", DIALECT: "#E67E22", RD: "#16A085", ELSE: "#D4AC0D",
    BI: "#7F8C8D", need_check: "#BDC3C7", empty: "#E5E7EB",
  };
  const FALLBACK = ["#A04000", "#1ABC9C", "#884EA0", "#2C3E50", "#E74C3C", "#5499C7", "#AF7AC5"];
  const cmap = {};
  const studyHash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  S.studies.forEach((s, i) => { cmap[s] = COLOR[s] || FALLBACK[i % FALLBACK.length]; });
  /* 匯入新增的 Study 沒有預設色 → 用名稱雜湊取固定色（重開瀏覽器也一樣） */
  function color(s) {
    if (!cmap[s]) cmap[s] = COLOR[s] || FALLBACK[studyHash(s) % FALLBACK.length];
    return cmap[s];
  }

  const POS = [];
  for (const r of "ABCDEFGHI") for (let k = 1; k <= 9; k++) POS.push(r + k);

  let view = "map";
  let cab = "H";
  let filter = null;
  let currentListId = null;

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).replace("T", " ").slice(0, 16);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /* ---------------- 路由 ---------------- */
  function route() {
    const v = (location.hash || "#map").slice(1);
    view = ["map", "lists", "merge", "import", "recommend", "ledger", "dist", "users"].includes(v) ? v : "map";
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.v === view));
    render();
  }
  window.addEventListener("hashchange", route);

  function render() {
    const main = document.querySelector("main");
    if (main) main.classList.toggle("wide", view === "merge" || view === "recommend");
    const navUsers = document.querySelector('a[data-v="users"]');
    if (navUsers) navUsers.style.display = St.role === "admin" ? "" : "none";
    if (view === "map") renderMap();
    else if (view === "lists") renderLists();
    else if (view === "import") renderImport();
    else if (view === "recommend") renderRecommend();
    else if (view === "merge") renderMerge();
    else if (view === "dist") renderStudyDist();
    else if (view === "users") renderUsers();
    else renderLedger();
  }

  /* ---------------- 地圖 ---------------- */
  function boxStats(cab_, code) {
    const all = St.boxEntries(cab_, code);
    const live = all.filter(a => St.status(a.key) === "in_stock");
    const specs = live.filter(a => (a.kind || 0) !== 3);
    const zones = live.filter(a => (a.kind || 0) === 3);
    const blanks = live.filter(a => (a.kind || 0) === 2);
    const keys = new Set(live.map(a => a.pos));
    const counts = {};
    specs.forEach(a => { counts[a.study] = (counts[a.study] || 0) + 1; });
    const dom = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
    const specKeys = new Set(specs.map(a => a.pos));
    return { list: live, specs, zones, blanks, all, posCount: keys.size, specPos: specKeys.size, total: specs.length, out: all.length - live.length, dom };
  }

  const KIND_LABEL = { 0: "", 1: "待確認", 2: "無 SID", 3: "區域" };

  /* 整區（無抽屜架構）的區域設定，來自 seed.zoneAreas */
  const ZA = S.zoneAreas || [];
  /* 盒型：seed.boxDims 沒列出的盒一律 9×9；seed.drawerRows 沒列出的抽屜用 grid 階數 */
  const BOX_DIMS = S.boxDims || {};
  const DRAWER_ROWS = S.drawerRows || {};
  function boxDim(code) { const d = BOX_DIMS[code]; return d ? { rows: d[0], cols: d[1] } : { rows: 9, cols: 9 }; }
  function boxCapacity(code) { const d = boxDim(code); return d.rows * d.cols; }
  function drawerRows(c, l, d) { const a = DRAWER_ROWS[c + l]; return (a && a[d - 1]) || S.grid[c][2]; }
  function zonesOfLayer(l) { return ZA.filter(z => z.cab === cab && z.layer === l); }
  function zoneFrameHTML(z, span) {
    const cls = (filter === null || filter === z.study) ? "" : " dim";
    const meta = z.mode === "label" ? "整區（未建格位）" : `${z.boxes} 盒・${z.cells.toLocaleString()} 格`;
    return `<div class="zoneframe${cls}" style="flex:${span}"
      onclick="App.setFilter('${esc(z.study)}')" title="${esc(z.study)}｜${meta}（點選篩選）">
      <div class="zf-name">${esc(z.study)}</div>
      <div class="zf-meta">${meta}</div></div>`;
  }

  function renderMap() {
    const g = S.grid[cab];
    let tabs = S.order.map(c => `<button class="${c === cab ? "on" : ""}" onclick="App.selCab('${c}')">${c}</button>`).join("");
    let html = `<h1 class="page">冰箱地圖</h1>
      <div class="fbtabs">${tabs}</div>
      <div class="mapwrap"><div id="layers"></div><aside class="legend" id="legend"></aside></div>`;
    $("#view").innerHTML = html;
    renderLegend();
    let layers = "";
    for (let l = 1; l <= g[0]; l++) {
      const zs = zonesOfLayer(l);
      const whole = zs.find(z => z.drawers.length >= g[1]);   /* 整層都是一個區 */
      const llabel = `<div class="llabel">${l} 層${l === 1 ? "上" : "下"}</div>`;
      if (whole) {
        layers += `<section class="layer"><div class="matrix">${llabel}${zoneFrameHTML(whole, 1)}</div></section>`;
        continue;
      }
      layers += `<section class="layer"><div class="matrix">${llabel}`;
      const rowCounts = [];
      for (let dd = 1; dd <= g[1]; dd++) rowCounts.push(drawerRows(cab, l, dd));
      const uniform = rowCounts.every(x => x === rowCounts[0]);
      if (uniform) {
        layers += `<div class="ylabels"><div class="yh"></div>`;
        for (let t = 1; t <= rowCounts[0]; t++) layers += `<div class="y">階 ${t}</div>`;
        layers += `</div>`;
      }
      for (let d = 1; d <= g[1]; d++) {
        const z = zs.find(x => x.drawers[0] === d);
        if (z) {                                  /* 這個抽屜位置是一整區 */
          layers += `<div class="col zonecol" style="flex:${z.drawers.length}">
            <div class="ch">${esc(z.study)}</div>${zoneFrameHTML(z, 1)}</div>`;
          d += z.drawers.length - 1;
          continue;
        }
        layers += `<div class="col"><div class="ch">抽屜 ${d}</div>`;
        for (let t = 1; t <= rowCounts[d - 1]; t++) {
          layers += uniform ? cellHTML(l, d, t)
            : `<div class="cellwrap"><div class="ylab">${t}</div>${cellHTML(l, d, t)}</div>`;
        }
        layers += `</div>`;
      }
      layers += `</div></section>`;
    }
    $("#layers").innerHTML = layers;
  }

  function cellHTML(l, d, t) {
    const g = S.grid[cab];
    let bars = "";
    for (let s = 1; s <= g[3]; s++) bars += squareHTML(cab + l + d + t + s);
    return `<div class="cell" onclick="App.openBoxes(${l},${d},${t})"><div class="bars">${bars}</div></div>`;
  }

  function squareHTML(code) {
    const st = boxStats(cab, code);
    const cap = boxCapacity(code);
    const pct = Math.min(100, st.specPos / cap * 100);
    const bg = st.dom ? color(st.dom) : (st.zones.length || st.blanks.length ? "#c9d1de" : "#dfe3ea");
    const on = filter === null ? "" : ((st.specs.some(a => a.study === filter) || st.zones.some(a => a.study === filter)) ? "hl" : "dim");
    const nNo = st.specs.filter(a => (a.kind || 0) === 1).length;
    const bits = [`在庫 ${st.total} 管`];
    if (nNo) bits.push(`未編號 ${nNo}`);
    if (st.blanks.length) bits.push(`無 SID ${st.blanks.length}`);
    if (st.zones.length) bits.push(`區域 ${st.zones.length}`);
    if (st.out) bits.push(`已領出 ${st.out}`);
    return `<div class="b ${on}" title="${code}｜${st.specPos}/${cap} 支（${Math.round(pct)}%）｜${bits.join("・")}">
      <span class="k">${code.slice(-1)}</span>
      <div class="sq"${st.zones.length ? ' style="background:#e3e6ec"' : ''}><div class="fill" style="height:${pct}%;background:${bg}"></div></div></div>`;
  }

  function renderLegend() {
    const boxes = {}, tubes = {}, seen = new Set();
    const zBoxes = {}, zCells = {}, zSeen = new Set();
    for (const a of St.allAliquots(cab)) {
      if (St.status(a.key) !== "in_stock") continue;
      if ((a.kind || 0) === 3) {                    /* 區域：另列一群，不計入檢體合計 */
        zCells[a.study] = (zCells[a.study] || 0) + 1;
        const zk = a.study + "|" + a.box;
        if (!zSeen.has(zk)) { zSeen.add(zk); zBoxes[a.study] = (zBoxes[a.study] || 0) + 1; }
        continue;
      }
      tubes[a.study] = (tubes[a.study] || 0) + 1;
      const k = a.study + "|" + a.box;
      if (!seen.has(k)) { seen.add(k); boxes[a.study] = (boxes[a.study] || 0) + 1; }
    }
    const list = Object.keys(tubes).sort((a, b) => tubes[b] - tubes[a] || boxes[b] - boxes[a]);
    const zList = Object.keys(zCells).sort((a, b) => zCells[b] - zCells[a]);
    const allBoxes = new Set([...seen].map(k => k.split("|")[1])).size;
    const allTubes = Object.keys(tubes).reduce((n, s) => n + tubes[s], 0);
    let h = `<h3>Study（點選篩選）</h3>
      <div class="muted" style="font-size:11px;margin:-4px 0 8px">盒數・在庫檢體數</div>`;
    list.forEach(s => {
      h += `<div class="lg ${filter === s ? "on" : ""}" onclick="App.setFilter('${esc(s)}')">
        <i style="background:${color(s)}"></i>${esc(s)}<span class="c">${boxes[s]} 盒・${tubes[s].toLocaleString()} 支</span></div>`;
    });
    const labelZones = ZA.filter(z => z.cab === cab && z.mode === "label").map(z => z.study);
    if (zList.length || labelZones.length) {
      const zAllBox = new Set([...zSeen].map(k => k.split("|")[1])).size;
      const zAllCell = zList.reduce((n, s) => n + zCells[s], 0);
      h += `<div class="muted" style="font-size:11px;margin:10px 0 4px;padding-top:8px;border-top:1px solid var(--line)">區域（非檢體，只佔位）</div>`;
      zList.forEach(s => {
        h += `<div class="lg ${filter === s ? "on" : ""}" onclick="App.setFilter('${esc(s)}')">
          <i style="background:#c9d1de"></i>${esc(s)}<span class="c">${zBoxes[s]} 盒・${zCells[s].toLocaleString()} 格</span></div>`;
      });
      labelZones.forEach(s => {
        h += `<div class="lg ${filter === s ? "on" : ""}" onclick="App.setFilter('${esc(s)}')">
          <i style="background:#c9d1de"></i>${esc(s)}<span class="c">整區</span></div>`;
      });
      h += `<div class="lg all" style="border-top:none;margin-top:0;padding-top:2px">區域合計<span class="c">${zAllCell ? `${zAllBox} 盒・${zAllCell.toLocaleString()} 格` : "整區"}</span></div>`;
    }
    h += `<div class="lg all" onclick="App.setFilter(null)">顯示全部<span class="c">${allBoxes} 盒・${allTubes.toLocaleString()} 支</span></div>`;
    $("#legend").innerHTML = h;
  }

  function openBoxes(l, d, t) {
    const g = S.grid[cab];
    const codes = [];
    for (let s = 1; s <= g[3]; s++) codes.push(cab + l + d + t + s);
    let html = "";
    for (const code of codes) {
      const dim = boxDim(code);
      const list = St.boxEntries(cab, code);
      const byPos = {};
      list.forEach(a => (byPos[a.pos] = byPos[a.pos] || []).push(a));
      let wells = `<div class="wh"></div>`;
      for (let k = 1; k <= dim.cols; k++) wells += `<div class="wh">${k}</div>`;
      for (let ri = 0; ri < dim.rows; ri++) {
        const r = String.fromCharCode(65 + ri);
        wells += `<div class="wr">${r}</div>`;
        for (let k = 1; k <= dim.cols; k++) {
          const p = r + k;
          const arr = byPos[p] || [];
          if (!arr.length) { wells += `<div class="w"></div>`; continue; }
          const live = arr.find(x => St.status(x.key) === "in_stock");
          const a = live || arr[0];
          const st = St.status(a.key);
          const cls = st === "out" || st === "moved" ? "w out" : "w";
          const multi = arr.length > 1;
          const zone = (a.kind || 0) === 3;
          const bg = zone ? "#c9d1de" : color(a.study);
          const tip = arr.map(x => ((x.kind || 0) === 1 ? `${x.study} 待確認`
            : (x.kind || 0) === 2 ? `${x.study}（無 SID）`
              : (x.kind || 0) === 3 ? `${x.study}（區域）`
                : `${x.study} ${x.sid}${x.pid ? `（${x.pid}）` : ""}`)).join(" / ");
          wells += `<div class="${cls}" style="background:${bg};${multi ? "outline:2px solid #c0392b;outline-offset:-2px;" : ""}"
            title="${p} ${tip}"></div>`;
        }
      }
      const total = list.filter(a => (a.kind || 0) <= 2).length;
      const pos = new Set(list.map(a => a.pos)).size;
      const nNo = list.filter(a => (a.kind || 0) === 1).length;
      const nBlank = list.filter(a => (a.kind || 0) === 2).length;
      const nZone = list.filter(a => (a.kind || 0) === 3).length;
      const extra = [nNo ? `未編號 ${nNo} 管` : "", nBlank ? `無 SID ${nBlank} 格` : "", nZone ? `區域 ${nZone} 格` : ""].filter(Boolean).join("・");
      html += `<div class="box"><h5>${code}
        <button class="add" onclick="App.addBox('${code}')">加入清單</button></h5>
        <div class="muted" style="margin-bottom:6px">${pos}/${dim.rows * dim.cols} 格・${total} 管${extra ? `（${extra}）` : ""}</div>
        <div class="wgrid" style="--cols:${dim.cols}">${wells}</div></div>`;
    }
    $("#mt").textContent = `${cab} 冰箱　第 ${l} 層 ｜ 抽屜 ${d} ・ 階 ${t}`;
    $("#ms").textContent = `盒子 ${codes[0]} ～ ${codes[codes.length - 1]}（斜線＝已領出／已移出；紅框＝同位置多支）`;
    $("#mb").innerHTML = html;
    $("#modal").classList.add("on");
  }

  async function addBox(code) {
    const list = St.boxEntries(cab, code).filter(a => St.status(a.key) === "in_stock" && (a.kind || 0) === 0);
    if (!list.length) { alert("這個盒子沒有在庫檢體（未編號或區域不可加入）"); return; }
    const l = await ensureAutoList();
    await St.addItems(l.id, list.map(a => ({ key: a.key, sid: a.sid, study: a.study, box: a.box, pos: a.pos, qty: 1 })));
    alert(`已加入 ${list.length} 支到「${l.no ? l.no + "｜" : ""}${l.name}」`);
  }

  async function ensureAutoList() {
    let l = St.lists.find(x => x.name === "需求清單（自動）" && !listLocked(x));
    if (!l) l = await St.createList("需求清單（自動）", "request");
    return l;
  }

  /* 清單一旦有項目被領出／標記缺（非 pending）就鎖定：不能再增列，要加就開新清單 */
  function listLocked(l) {
    return !!l && (l.items || []).some(i => i.status !== "pending");
  }

  /* ---------------- 清單工作台（含檢體選取） ---------------- */
  let pickQ = "", pickCab = "", pickStudy = "", pickRows = [], pickTotal = 0;
  let pickSel = new Set();
  /* 分頁顯示：掃描仍掃全部（筆數不截斷、可翻到最後一頁），只渲染當頁 200 列 */
  let pickPage = 1, pickSize = 200;
  const PICK_SIZES = [100, 200, 500, 1000];
  let pendingStudy = null;            /* 從「Study 分布」點過來時要自動帶入的 Study */

  /* 快取 allAliquots（每次重建約 13ms）與 SID 索引；匯入新增檢體後要 pickInvalidate() */
  const pickCache = new Map();
  function pickData(cab) {
    const k = cab || "";
    let d = pickCache.get(k);
    if (!d) {
      const all = St.allAliquots(cab || undefined);
      const bySid = new Map();
      for (const a of all) {
        let v = bySid.get(a.sid);
        if (!v) bySid.set(a.sid, v = []);
        v.push(a);
      }
      pickCache.set(k, d = { all, bySid });
    }
    return d;
  }
  function pickInvalidate() { pickCache.clear(); studyUnion = null; }

  /* 目前實際存在的 Study（含匯入新增的）；S.studies 只是初始清單 */
  let studyUnion = null;
  function allStudies() {
    if (!studyUnion) {
      const set = new Set();
      for (const a of pickData("").all) if (a.study && (a.kind || 0) <= 1) set.add(a.study);
      studyUnion = [...set];
    }
    return studyUnion;
  }

  function renderLists() {
    const lists = St.lists;
    if (!currentListId && lists.length) currentListId = lists[0].id;
    const cur = St.getList(currentListId);
    const opts = lists.map(l =>
      `<option value="${l.id}" ${l.id === currentListId ? "selected" : ""}>${l.no ? esc(l.no) + "｜" : ""}${esc(l.name)}（${l.items.length} 支／${fmtVol(volOf(l.items))}）${listLocked(l) ? "・已領出" : ""}</option>`).join("");
    const cabs = ["", ...S.order];
    const studies = ["", ...allStudies().slice().sort()];

    let html = `<h1 class="page">清單工作台</h1><div class="wb2">
      <div class="card">
        <div class="toolbar">
          <b>檢體選取</b>
          <select id="pcab" onchange="App.searchPick()">${cabs.map(c => `<option value="${c}" ${c === pickCab ? "selected" : ""}>${c || "全部冰箱"}</option>`).join("")}</select>
          <select id="pstudy" onchange="App.searchPick()">${studies.map(c => `<option value="${esc(c)}" ${c === pickStudy ? "selected" : ""}>${esc(c) || "全部 Study"}</option>`).join("")}</select>
        </div>
        <div class="pickbar">
          <input type="text" id="pq" placeholder="搜尋 SID（可部分比對）" value="${esc(pickQ)}"
            onkeydown="if(event.key==='Enter')App.searchPick()">
          <button class="btn primary" onclick="App.searchPick()">搜尋</button>
          <span class="muted" id="pinfo"></span>
          <span style="flex:1"></span>
          <span class="muted">已選 <b id="psel">${pickSel.size}</b></span>
          <label class="muted" style="display:flex;align-items:center;gap:4px">
            <input type="checkbox" id="onlynew" onchange="App.searchPick()"> 只看本次新增</label>
          <button class="btn" onclick="App.clearPick()">清除</button>
          <button class="btn primary" onclick="App.addPicked()" title="目前清單若已執行領出，會自動建立新清單">加入清單 →</button>
        </div>
        <div id="presults"></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <b>需求清單</b>
          <select id="lsel" onchange="App.selList(this.value)" style="min-width:240px">
            ${opts || '<option value="">（尚無清單）</option>'}
          </select>
          <button class="btn" onclick="App.newList()">＋ 新增</button>
          <button class="btn danger" onclick="App.delList()">刪除</button>
        </div>`;
    if (!cur) {
      html += `<div class="muted" style="padding:16px">尚無清單，按「＋ 新增」建立，或直接在左側選取檢體後按「加入清單」。</div>`;
    } else {
      html += `<div class="toolbar">
        <span class="muted">共 ${cur.items.length} 支／總量 ${fmtVol(volOf(cur.items))}（待領 ${cur.items.filter(i => i.status === "pending").length}）</span>
        ${listLocked(cur) ? '<span class="tag warn" title="已有項目被領出／標記缺，清單鎖定不再增列；要加新檢體會自動建立新清單">已執行領出・不再增列</span>' : ""}
        <span style="flex:1"></span>
        <button class="btn primary" onclick="App.checkout()">選出領取</button>
        <button class="btn" onclick="App.markMissing()">標記缺</button>
        <button class="btn" onclick="App.exportList()">匯出 CSV</button>
      </div>
      <div class="scroll"><table class="tb"><thead><tr>
        <th style="width:34px"><input type="checkbox" onchange="App.toggleAll(this)"></th>
        <th>SID</th><th>Study</th><th>盒</th><th>位置</th><th>容量(mL)</th><th>選管</th><th>狀態</th></tr></thead><tbody>`;
      cur.items.forEach((it, idx) => {
        const st = St.status(it.key);
        let tag = it.status === "picked" ? '<span class="tag ok">已領</span>'
          : it.status === "missing" ? '<span class="tag err">缺</span>'
            : st !== "in_stock" ? '<span class="tag warn">已被領出</span>' : '<span class="tag">待領</span>';
        const alts = it.alts || [];
        const canSwap = alts.length > 1 && it.status === "pending";
        let swap = '<span class="muted">—</span>';
        if (canSwap) {
          const opts = alts.map(a => `<option value="${esc(a.key)}" ${a.key === it.key ? "selected" : ""}
            title="${esc(a.box)} ${esc(a.pos)}｜容量 ${esc(a.vol || "未填")} mL｜入庫 ${esc(a.date || "-")}"
            >${esc(a.box)} ${esc(a.pos)}｜${esc(a.vol || "—")}</option>`).join("");
          swap = `<select class="tubsel" title="同一 SID 有 ${alts.length} 管可選，選你要領的那一管" onchange="App.swapTube(${idx}, this.value)">${opts}</select>`;
        } else if (alts.length === 1) {
          swap = '<span class="muted">僅 1 管</span>';
        }
        html += `<tr>
          <td><input type="checkbox" class="pickbox" data-idx="${idx}" ${it.status !== "pending" ? "disabled" : ""}></td>
          <td>${esc(it.sid)}</td><td>${esc(it.study)}</td><td>${esc(it.box)}</td><td>${esc(it.pos)}</td>
          <td>${esc(itemVol(it))}</td><td>${swap}</td><td>${tag}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
    html += `</div></div>`;
    $("#view").innerHTML = html;
    renderPickResults();
    applyPendingStudy();
  }

  function inCurrentList(key) {
    const cur = St.getList(currentListId);
    return !!cur && cur.items.some(i => i.key === key);
  }

  function pickPages() { return Math.max(1, Math.ceil(pickRows.length / pickSize)); }

  function renderPickResults() {
    const el = document.getElementById("presults");
    if (!el) return;
    const selInfo = document.getElementById("psel");
    if (!pickRows.length) {
      el.innerHTML = `<div class="muted" style="padding:16px">輸入 SID 或選擇條件後按「搜尋」。已加入右側清單的檢體會自動從這裡移除。</div>`;
      if (selInfo) selInfo.textContent = pickSel.size;
      return;
    }
    const curList = St.getList(currentListId);
    const curKeys = new Set((curList ? curList.items : []).map(i => i.key));
    const pages = pickPages();
    if (pickPage > pages) pickPage = pages;
    if (pickPage < 1) pickPage = 1;
    const from = (pickPage - 1) * pickSize;
    const shown = pickRows.slice(from, from + pickSize);
    let avail = 0;
    for (const a of pickRows) if (!curKeys.has(a.key) && St.status(a.key) === "in_stock") avail++;
    const selectable = shown.filter(a => !curKeys.has(a.key) && St.status(a.key) === "in_stock");
    const allOnPageOn = selectable.length > 0 && selectable.every(a => pickSel.has(a.key));

    const nav = `<div style="display:flex;align-items:center;gap:6px;margin:0 0 8px;flex-wrap:wrap">
      <button class="btn" ${pickPage <= 1 ? "disabled" : ""} onclick="App.pickGo(1)" title="第一頁">«</button>
      <button class="btn" ${pickPage <= 1 ? "disabled" : ""} onclick="App.pickGo(${pickPage - 1})">‹ 上一頁</button>
      <span class="muted">第 <b>${pickPage}</b>／${pages} 頁</span>
      <button class="btn" ${pickPage >= pages ? "disabled" : ""} onclick="App.pickGo(${pickPage + 1})">下一頁 ›</button>
      <button class="btn" ${pickPage >= pages ? "disabled" : ""} onclick="App.pickGo(${pages})" title="最後一頁">»</button>
      <span style="flex:1"></span>
      <span class="muted">每頁</span>
      <select onchange="App.pickSetSize(this.value)">${PICK_SIZES.map(n => `<option value="${n}" ${n === pickSize ? "selected" : ""}>${n} 列</option>`).join("")}</select>
    </div>`;

    let html = `<div class="muted" style="margin:6px 0 8px">符合 ${pickTotal.toLocaleString()} 筆；可選 ${avail.toLocaleString()} 筆（已在清單／已領出會標示）${pickTotal > pickSize ? `；本頁第 ${(from + 1).toLocaleString()}–${Math.min(from + pickSize, pickTotal).toLocaleString()} 筆` : ""}</div>`;
    html += nav;
    html += `<div class="scroll" style="max-height:52vh"><table class="tb"><thead><tr>
      <th style="width:34px"><input type="checkbox" ${allOnPageOn ? "checked" : ""} title="全選符合條件的 ${avail.toLocaleString()} 筆（不只這一頁）" onchange="App.togglePickAll(this)"></th>
      <th>SID</th><th>Study</th><th>盒</th><th>位置</th><th>容量(mL)</th><th>狀態</th></tr></thead><tbody>`;
    shown.forEach(a => {
      const inList = curKeys.has(a.key);
      const on = pickSel.has(a.key);
      const st = St.status(a.key);
      let tag;
      if (inList) tag = '<span class="tag">已在清單</span>';
      else if (st === "in_stock") tag = '<span class="tag ok">在庫</span>';
      else if (st === "out") tag = '<span class="tag err">已領出</span>';
      else tag = '<span class="tag warn">已移出</span>';
      const dis = inList || st !== "in_stock";
      html += `<tr class="${on ? "selrow" : ""}">
        <td><input type="checkbox" data-key="${esc(a.key)}" ${on ? "checked" : ""} ${dis ? "disabled" : ""} onchange="App.togglePick('${a.key}', this)"></td>
        <td>${esc(a.sid)}</td><td>${esc(a.study)}</td><td>${esc(a.box)}</td><td>${esc(a.pos)}</td>
        <td>${esc(a.vol || "")}</td><td>${tag}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    el.innerHTML = html;
    if (selInfo) selInfo.textContent = pickSel.size;
  }

  function pickGo(p) { pickPage = p; renderPickResults(); }
  function pickSetSize(v) { pickSize = +v || 200; pickPage = 1; renderPickResults(); }

  function searchPick() {
    pickQ = (document.getElementById("pq").value || "").trim();
    pickCab = document.getElementById("pcab").value || "";
    pickStudy = document.getElementById("pstudy").value || "";
    const q = pickQ.toLowerCase();
    const onlyNew = document.getElementById("onlynew") && document.getElementById("onlynew").checked;
    const data = pickData(pickCab);

    /* 輸入完整 SID → 走索引（O(1)）；其餘才線性比對（10 萬筆約 5ms） */
    let src = data.all;
    if (q) {
      const exact = data.bySid.get(pickQ) || data.bySid.get(pickQ.toUpperCase());
      if (exact) src = exact;
    }
    const hit = [];
    for (const a of src) {
      if ((a.kind || 0) !== 0) continue;          /* 未編號／區域不可加入清單 */
      if (q && !a.sid.toLowerCase().includes(q)) continue;
      if (pickStudy && a.study !== pickStudy) continue;
      if (onlyNew && a.seed) continue;
      hit.push(a);
    }
    /* 純字串比較比 localeCompare 快約 7 倍（10 萬列 49ms → 7ms） */
    hit.sort((x, y) => (x.box < y.box ? -1 : x.box > y.box ? 1 : x.pos < y.pos ? -1 : x.pos > y.pos ? 1 : 0));
    pickTotal = hit.length;
    pickRows = hit;
    pickPage = 1;
    renderPickResults();
  }

  /* 勾選不重繪整張表（只更新那一列） */
  function togglePick(key, el) {
    if (pickSel.has(key)) pickSel.delete(key); else pickSel.add(key);
    if (el && el.closest) {
      const tr = el.closest("tr");
      if (tr) tr.classList.toggle("selrow", pickSel.has(key));
    }
    const n = document.getElementById("psel"); if (n) n.textContent = pickSel.size;
  }
  /* 全選＝選「符合條件的全部」而不是只有這一頁（10 萬筆也不碰 DOM，只動資料） */
  function togglePickAll(cb) {
    const cur = St.getList(currentListId);
    const curKeys = new Set((cur ? cur.items : []).map(i => i.key));
    if (cb.checked) {
      for (const a of pickRows) {
        if (curKeys.has(a.key)) continue;
        if (St.status(a.key) !== "in_stock") continue;
        pickSel.add(a.key);
      }
    } else {
      for (const a of pickRows) pickSel.delete(a.key);
    }
    renderPickResults();
  }
  function clearPick() {
    pickSel.clear();
    renderPickResults();
  }
  async function addPicked() {
    if (!pickSel.size) { alert("尚未選取檢體"); return; }
    if (pickSel.size > 10000 && !confirm(`一次加入 ${pickSel.size.toLocaleString()} 支，資料量較大，確定要加入？`)) return;
    let l = St.getList(currentListId);
    let madeNew = false;
    if (!l || listLocked(l)) {
      const oldName = l ? l.name : "";
      l = await St.createList("需求清單 " + new Date().toISOString().slice(0, 10), "request");
      currentListId = l.id;
      madeNew = true;
      if (oldName) setTimeout(() => alert(`「${oldName}」已執行領出，不能再增列。\n已建立新清單「${l.no}｜${l.name}」。`), 0);
    }
    const byKey = new Map(pickData("").all.map(a => [a.key, a]));
    const items = [...pickSel].map(k => byKey.get(k)).filter(Boolean)
      .map(a => ({ key: a.key, sid: a.sid, study: a.study, box: a.box, pos: a.pos, vol: a.vol || "", qty: 1 }));
    await St.addItems(l.id, items);
    pickSel.clear();
    renderLists();
    return madeNew;
  }

  function itemVol(it) {
    if (it.vol) return it.vol;
    const a = St.byKey(it.key);
    return a && a.vol ? a.vol : "";
  }
  function volOf(items) {
    let sum = 0, any = false;
    items.forEach(it => {
      const v = parseFloat(itemVol(it));
      if (!isNaN(v)) { sum += v; any = true; }
    });
    return any ? sum : null;
  }
  function fmtVol(v) {
    if (v == null) return "容量未填";
    return (Math.round(v * 10) / 10) + " mL";
  }

  function toggleAll(cb) {
    document.querySelectorAll(".pickbox:not(:disabled)").forEach(x => x.checked = cb.checked);
  }

  /* ---------------- 選出領取（二階段確認） ---------------- */
  const CK_PURPOSES = ["實驗／上機分析", "分裝", "送檢", "教學示範", "報廢／銷毀", "盤點校正"];
  const CK_KEY = "ntuh_proto_checkout_defaults";
  let ck = null;

  function ckDefaults() { try { return JSON.parse(localStorage.getItem(CK_KEY)) || {}; } catch (e) { return {}; } }
  function ckSaveDefaults(o) { try { localStorage.setItem(CK_KEY, JSON.stringify(o)); } catch (e) { /* file:// 可能受限 */ } }
  function nowLocal() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const fmtWhen = (v) => (v || "").replace("T", " ").slice(0, 16);

  function ckTotals(items) {
    let qty = 0, vol = 0, any = false;
    items.forEach(it => {
      qty += it.qty || 1;
      const v = parseFloat(itemVol(it));
      if (!isNaN(v)) { vol += v; any = true; }
    });
    return { qty, vol: any ? Math.round(vol * 10) / 10 : null };
  }

  function ckTable(items, withStatus) {
    const t = ckTotals(items);
    let h = `<div class="ck-tb"><table class="tb"><thead><tr>
      <th style="width:34px">#</th><th>SID</th><th>Study</th><th>盒</th><th>位置</th><th>容量(mL)</th><th>數量</th>`;
    if (withStatus) h += `<th>結果</th>`;
    h += `</tr></thead><tbody>`;
    items.forEach((it, i) => {
      h += `<tr><td>${i + 1}</td><td>${esc(it.sid)}</td><td>${esc(it.study)}</td><td>${esc(it.box)}</td>
        <td>${esc(it.pos)}</td><td>${esc(itemVol(it) || "—")}</td><td>${it.qty || 1}</td>`;
      if (withStatus) {
        const r = ck.res && ck.res.get(it.key);
        h += `<td>${r === "ok" ? '<span class="tag ok">已領出</span>' : '<span class="tag err">標記缺</span>'}</td>`;
      }
      h += `</tr>`;
    });
    h += `</tbody><tfoot><tr class="totalrow"><td colspan="5">合計</td>
      <td>${t.vol == null ? "容量未填" : t.vol + " mL"}</td><td>${t.qty} 支</td>${withStatus ? "<td></td>" : ""}</tr></tfoot></table></div>`;
    return h;
  }

  function ckAlreadyOut() {
    return ck.items.filter(it => St.status(it.key) !== "in_stock").length;
  }

  function openCheckout() {
    const cur = St.getList(currentListId);
    if (!cur) return;
    const idxs = [...document.querySelectorAll(".pickbox")].filter(x => x.checked && !x.disabled).map(x => +x.dataset.idx);
    if (!idxs.length) { alert("請先在清單中勾選要領出的項目"); return; }
    const items = idxs.map(i => cur.items[i]).filter(Boolean);
    const d = ckDefaults();
    ck = {
      step: 1, ack: false, listId: cur.id, listName: cur.name, listNo: cur.no || "", items,
      pendingAll: cur.items.filter(i => i.status === "pending").length,
      meta: { recipient: d.recipient || "", unit: d.unit || "", purpose: d.purpose || "", when: nowLocal(), note: "" },
      result: null,
    };
    $("#outmodal").classList.add("on");
    drawCheckout();
  }

  function drawCheckout() {
    const p = $("#outpanel");
    if (!ck) { p.innerHTML = ""; return; }
    const m = ck.meta, t = ckTotals(ck.items);
    const steps = [["1", "填寫領取資料"], ["2", "核對並確認"], ["3", "完成"]]
      .map(s => `<span class="${ck.step === +s[0] ? "on" : ""}">${ck.step > +s[0] ? "✓ " : s[0] + ". "}${s[1]}</span>`).join("");
    let h = `<div class="ck-head"><h3>選出領取</h3><span class="ck-steps">${steps}</span></div>
      <div class="sub">清單：${ck.listNo ? esc(ck.listNo) + "｜" : ""}${esc(ck.listName)}｜本次領出 ${ck.items.length} 項／${t.qty} 支</div>`;

    if (ck.step === 1) {
      h += `<div class="ck-grid">
        <label><span>領取人 <i class="req">*</i></span>
          <input id="ck_recipient" value="${esc(m.recipient)}" placeholder="姓名／工號"
            oninput="App.ckField('recipient', this.value)"></label>
        <label><span>單位／聯絡</span>
          <input id="ck_unit" value="${esc(m.unit)}" placeholder="例：檢驗科 分機 1234"
            oninput="App.ckField('unit', this.value)"></label>
        <label><span>目的 <i class="req">*</i></span>
          <input id="ck_purpose" list="ck_purpose_list" value="${esc(m.purpose)}" placeholder="可選單或自行輸入"
            oninput="App.ckField('purpose', this.value)">
          <datalist id="ck_purpose_list">${CK_PURPOSES.map(x => `<option value="${esc(x)}"></option>`).join("")}</datalist></label>
        <label><span>領取時間 <i class="req">*</i></span>
          <input type="datetime-local" id="ck_when" value="${esc(m.when)}" oninput="App.ckField('when', this.value)"></label>
        <label class="wide"><span>備註</span>
          <input id="ck_note" value="${esc(m.note)}" placeholder="例：計畫第 3 次採樣、需乾冰運送"
            oninput="App.ckField('note', this.value)"></label>
      </div>
      <div id="ckerr"></div>
      <div class="muted" style="margin:2px 0 6px">本次領出明細</div>
      ${ckTable(ck.items)}
      <div class="ck-foot">
        <span class="muted" style="margin-right:auto">清單仍有 ${Math.max(0, ck.pendingAll - ck.items.length)} 支待領未勾選</span>
        <button class="btn" onclick="App.ckClose()">取消</button>
        <button class="btn primary" onclick="App.ckStep(2)">下一步：核對 →</button>
      </div>`;
    } else if (ck.step === 2) {
      const out = ckAlreadyOut();
      h += `<div class="ck-sum">
        <div><b>領取人</b><span>${esc(m.recipient)}</span></div>
        <div><b>單位／聯絡</b><span>${esc(m.unit) || "—"}</span></div>
        <div><b>目的</b><span>${esc(m.purpose)}</span></div>
        <div><b>領取時間</b><span>${fmtWhen(m.when)}</span></div>
        <div><b>件數</b><span>${t.qty} 支</span></div>
        <div><b>總量</b><span>${t.vol == null ? "容量未填" : t.vol + " mL"}</span></div>
      </div>
      ${m.note ? `<div class="muted" style="margin:-2px 0 10px">備註：${esc(m.note)}</div>` : ""}
      ${out ? `<div class="ck-warn" style="margin-bottom:10px">有 ${out} 支目前不是「在庫」（先前已領出／已移出），確認後會標記為「缺」，不會重複領出。</div>` : ""}
      ${ckTable(ck.items)}
      <div class="ck-warn" style="margin-top:10px">確認後這 ${ck.items.length} 項立即標記為「已領」並寫入交易紀錄（append-only，不可刪除）。</div>
      <label class="ck-ack"><input type="checkbox" ${ck.ack ? "checked" : ""} onchange="App.ckAck(this.checked)">
        <span>我已核對 <b>SID、盒號、位置與數量</b> 無誤，且領取資料正確。</span></label>
      <div class="ck-foot">
        <button class="btn" style="margin-right:auto" onclick="App.ckStep(1)">← 上一步</button>
        <button class="btn" onclick="App.ckClose()">取消</button>
        <button class="btn primary" ${ck.ack ? "" : "disabled"} onclick="App.ckConfirm()">確認領出（${t.qty} 支）</button>
      </div>`;
    } else {
      const r = ck.result || { ok: 0, miss: 0, batch: "" };
      h += `<div class="ck-done"><div class="big">${r.miss ? "⚠️" : "✅"}</div>
        <div class="ck-done-t">領出完成</div>
        <div class="muted">領取單號 ${esc(r.batch)}｜領取時間 ${fmtWhen(m.when)}</div></div>
      <div class="ck-sum">
        <div><b>成功領出</b><span>${r.ok} 支</span></div>
        <div><b>標記缺</b><span>${r.miss} 支</span></div>
        <div><b>領取人</b><span>${esc(m.recipient)}</span></div>
        <div><b>目的</b><span>${esc(m.purpose)}</span></div>
      </div>
      ${ckTable(ck.items, true)}
      <div class="ck-warn" style="margin-top:10px">領取單（Excel）是這次領出的正式表單，按下方按鈕即完成並下載 .xlsx 檔（含格線，可直接列印）。</div>
      <div class="ck-foot">
        <button class="btn" style="margin-right:auto" onclick="App.ckClose()">直接關閉</button>
        <button class="btn primary" onclick="App.ckSaveXlsx()">完成並下載領取單（Excel）</button>
      </div>`;
    }
    p.innerHTML = h;
    const first = p.querySelector("#ck_recipient");
    if (first && !first.value) first.focus();
  }

  function ckField(k, v) { if (ck) ck.meta[k] = v; }

  function ckAck(v) { if (!ck) return; ck.ack = !!v; drawCheckout(); }

  function ckStep(n) {
    if (!ck) return;
    if (n === 2) {
      const errs = [];
      if (!String(ck.meta.recipient || "").trim()) errs.push("領取人");
      if (!String(ck.meta.purpose || "").trim()) errs.push("目的");
      if (!ck.meta.when) errs.push("領取時間");
      if (errs.length) {
        const e = document.getElementById("ckerr");
        if (e) e.innerHTML = `<div class="ck-err">請填寫必填欄位：${errs.join("、")}</div>`;
        return;
      }
      ck.meta.recipient = String(ck.meta.recipient).trim();
      ck.meta.purpose = String(ck.meta.purpose).trim();
      ck.ack = false;
    }
    ck.step = n;
    drawCheckout();
  }

  function newBatchNo() { return St.nextNo("P"); }

  async function ckConfirm() {
    if (!ck || ck.step !== 2 || !ck.ack) return;
    const cur = St.getList(currentListId);
    if (!cur) return;
    let res;
    try {
      res = await St.drawOut(cur.id, ck.items, ck.meta);
    } catch (e) {
      const el = document.getElementById("ckerr");
      if (el) el.innerHTML = `<div class="ck-err">領出失敗：${esc(e.message)}</div>`;
      return;
    }
    ck.res = new Map();
    let ok = 0, miss = 0;
    ck.items.forEach(it => {
      const r = res.results ? res.results.get(it.key) : null;
      it.status = r === "ok" ? "picked" : "missing";
      ck.res.set(it.key, r === "ok" ? "ok" : "miss");
      if (r === "ok") ok++; else miss++;
    });
    const batch = res.batch_no || "—";
    St.save();
    ckSaveDefaults({ recipient: ck.meta.recipient, unit: ck.meta.unit, purpose: ck.meta.purpose });
    ck.result = { ok, miss, batch };
    ck.step = 3;
    renderLists();
    drawCheckout();
  }

  function ckClose() { $("#outmodal").classList.remove("on"); ck = null; $("#outpanel").innerHTML = ""; }

  function ckPickupData() {
    const m = ck.meta;
    return {
      meta: {
        batch: ck.result.batch,
        recipient: m.recipient, unit: m.unit, purpose: m.purpose, pickupAt: m.when, note: m.note,
      },
      items: ck.items.map(it => ({
        sid: it.sid, study: it.study, box: it.box, pos: it.pos, vol: itemVol(it), qty: it.qty,
        res: ck.res && ck.res.get(it.key),
      })),
    };
  }

  /* 領取單唯一的產出格式：Excel（.xlsx；有格線、可列印、可再編輯） */
  function ckSaveXlsx() {
    if (!ck || !ck.result) return;
    const d = ckPickupData();
    XForm.savePickup(d.meta, d.items);
    ckClose();
  }

  async function pickAllPending() {
    const cur = St.getList(currentListId); if (!cur) return 0;
    const items = cur.items.filter(it => it.status === "pending");
    if (!items.length) return 0;
    const res = await St.drawOut(cur.id, items, {
      recipient: (typeof St.email === "string" && St.email) || St.role,
      purpose: "批次領出",
    });
    return res.drawn ? res.drawn.length : 0;
  }

  async function markMissing() {
    const cur = St.getList(currentListId); if (!cur) return;
    const idxs = [...document.querySelectorAll(".pickbox")].filter(x => x.checked).map(x => +x.dataset.idx);
    if (!idxs.length) { alert("請先勾選要標記的項目"); return; }
    const keys = idxs.map(i => cur.items[i]).filter(Boolean).map(i => i.key);
    await St.markMissing(cur.id, keys);
    renderLists();
  }

  /* 同一 SID 有多管時，在清單內換成指定那一管 */
  function swapTube(idx, key) {
    const cur = St.getList(currentListId); if (!cur) return;
    const it = cur.items[idx];
    if (!it) return;
    const alt = (it.alts || []).find(a => a.key === key);
    if (!alt) return;
    const dup = cur.items.some((x, i) => i !== idx && x.key === key && x.status === "pending");
    if (dup) { alert("這一管已被清單中的另一項選用，請改選其他管"); renderLists(); return; }
    it.key = alt.key; it.box = alt.box; it.pos = alt.pos; it.vol = alt.vol || "";
    St.save(); renderLists();
  }

  async function newList() {
    const name = prompt("清單名稱", "需求清單 " + new Date().toISOString().slice(0, 10));
    if (!name) return;
    const l = await St.createList(name, "request");
    currentListId = l.id; renderLists();
  }
  async function delList() {
    if (!currentListId || !confirm("確定刪除這份清單？")) return;
    try { await St.deleteList(currentListId); }
    catch (e) { alert("刪除失敗：" + e.message); return; }
    currentListId = null; renderLists();
  }
  function exportList() {
    const cur = St.getList(currentListId); if (!cur) return;
    const rows = [
      ["清單單號", cur.no || "—"], ["清單名稱", cur.name], ["建立時間", fmt(cur.createdAt)],
      ["支數", cur.items.length], ["總量", fmtVol(volOf(cur.items))], [],
      ["SID", "Study", "盒", "位置", "容量(mL)", "數量", "狀態"],
    ];
    cur.items.forEach(i => rows.push([i.sid, i.study, i.box, i.pos, itemVol(i), i.qty, i.status]));
    downloadCSV(rows, `清單_${cur.no || cur.name}.csv`);
  }

  /* ---------------- 匯入 ---------------- */
  let imp = { rows: [], header: [], type: "request", parsed: null, ack: false, canImport: false };

  const STEP_LABELS = ["選類型", "上傳", "驗證", "匯入"];
  const STEP_NOTES = [
    "① 選類型：先選「需求清單」或「新增檢體」",
    "② 上傳：選 Excel／CSV 檔，或按「載入範例資料」試跑",
    "③ 驗證：檢查每列結果；錯誤列不匯入，警告列要勾「我已確認警告」",
    "④ 匯入：按「確認匯入」完成",
  ];

  function impStep() {
    if (!imp.parsed || !imp.parsed.length) return 2;
    return imp.canImport ? 4 : 3;
  }

  function updateSteps() {
    const el = document.getElementById("steps");
    if (!el) return;
    const cur = impStep();
    el.innerHTML = STEP_LABELS.map((t, i) => {
      const n = i + 1;
      const cls = n === cur ? "on" : n < cur ? "done" : "";
      const mark = n < cur ? "✓" : "①②③④"[i];
      return `<div class="step ${cls}">${mark} ${t}</div>`;
    }).join("");
    const note = document.getElementById("stepnote");
    if (note) note.textContent = "目前步驟：" + STEP_NOTES[cur - 1];
  }

  function renderImport() {
    $("#view").innerHTML = `<h1 class="page">匯入精靈</h1>
      <div class="steps" id="steps"></div>
      <div class="stepnote muted" id="stepnote"></div>
      <div class="card" style="max-width:900px">
        <div class="row" style="margin-bottom:10px">
          <label><input type="radio" name="itype" value="request" checked onchange="App.setImpType('request')"> 需求清單</label>
          <label style="margin-left:16px"><input type="radio" name="itype" value="new" onchange="App.setImpType('new')" ${St.role === "readonly" ? "disabled" : ""}> 新增檢體</label>
          <span class="muted" id="rolehint"></span>
        </div>
        <div class="row">
          <input type="file" id="file" accept=".xlsx,.xls,.csv" onchange="App.onFile(this)">
          <button class="btn" onclick="App.template(this)">下載範本</button>
          <button class="btn" onclick="App.loadSample()">載入範例資料</button>
        </div>
        <pre class="note" id="hint"></pre>
        <div id="preview"></div>
      </div>`;
    setImpType("request");
    const hint = $("#rolehint");
    hint.textContent = St.role === "readonly" ? "（唯讀帳號不能匯入）" : "";
    updateSteps();
  }

  function loadSample() {
    if (imp.type === "request") {
      imp.header = ["SID", "Study", "數量", "備註"];
      imp.rows = [
        ["DEMO0101", "NTUH", "1", ""],
        ["DEMO0102", "NTUH", "3", "數量測試"],
        ["DEMO0102", "NTUH", "1", "重複列"],
        ["DEMO9999", "NTUH", "1", "找不到"],
      ];
    } else {
      imp.header = ["SID", "Study", "Allocation", "Volume", "Samplingdate", "Note"];
      imp.rows = [
        ["DEMO0001", "NTUH", "H2541I1", "1.5", "2024-07-12", ""],
        ["DEMO0002", "NTUH", "H1111A1", "1.5", "2020-01-01", "佔用測試"],
        ["DEMO0003", "NTUH", "H9999A1", "1.5", "", "範圍外"],
        ["DEMO0004", "NTUH", "Q2141A1", "1.5", "2026-01-01", "新入庫"],
      ];
    }
    validate();
  }

  function setImpType(t) {
    imp.type = t; imp.parsed = null; imp.ack = false; imp.canImport = false;
    const hint = $("#hint");
    hint.textContent = t === "request"
      ? "需求清單欄位：SID、Study、數量、備註（數量不足會部分成立）"
      : "新增檢體欄位：SID、Study、Allocation、Volume、Samplingdate、Note（同一 SID 可有多支，直接入庫）";
    $("#preview").innerHTML = "";
    updateSteps();
  }

  function template() {
    const rows = imp.type === "request"
      ? [["SID", "Study", "數量", "備註"], ["DEMO0101", "NTUH", "1", ""], ["DEMO0102", "NTUH", "2", "B 計畫"]]
      : [["SID", "Study", "Allocation", "Volume", "Samplingdate", "Note"], ["DEMO0001", "NTUH", "H2541I1", "1.5", "2024-07-12", ""]];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, imp.type === "request" ? "需求清單範本.xlsx" : "新增檢體範本.xlsx");
  }

  function onFile(input) {
    const f = input.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      if (!aoa.length) { alert("檔案沒有資料"); return; }
      imp.header = aoa[0].map(x => String(x).trim());
      imp.rows = aoa.slice(1).filter(r => r.some(c => String(c).trim() !== ""));
      validate();
    };
    reader.readAsArrayBuffer(f);
  }

  function col(name) {
    const keys = ["SID", "Study", "數量", "備註", "Allocation", "Volume", "Samplingdate", "Note"];
    const i = imp.header.findIndex(h => h.toLowerCase() === name.toLowerCase());
    if (i >= 0) return i;
    const alias = { 數量: ["數量", "Qty", "Quantity"], 備註: ["備註", "Note"], Allocation: ["Allocation", "位置"] };
    for (const a of (alias[name] || [])) {
      const j = imp.header.findIndex(h => h.toLowerCase() === a.toLowerCase());
      if (j >= 0) return j;
    }
    return -1;
  }

  function validate() {
    const out = [];
    const iSID = col("SID"), iStudy = col("Study"), iQty = col("數量"),
      iAlloc = col("Allocation"), iVol = col("Volume"), iDate = col("Samplingdate"), iNote = col("Note");
    const seen = new Set();
    const all = St.allAliquots();

    imp.rows.forEach((r, n) => {
      const sid = String(r[iSID] ?? "").trim();
      const study = String(r[iStudy] ?? "").trim();
      const row = { n: n + 2, sid, study, status: "ok", msgs: [] };
      if (!sid || !study) { row.status = "err"; row.msgs.push("E07 必填欄位空白"); out.push(row); return; }

      if (imp.type === "request") {
        const qty = parseInt(String(r[iQty] ?? "1").trim(), 10);
        row.qty = qty;
        if (!Number.isInteger(qty) || qty <= 0) { row.status = "err"; row.msgs.push("E06 數量錯誤"); out.push(row); return; }
        const key = sid + "|" + study;
        if (seen.has(key)) { row.status = "warn"; row.msgs.push("W02 檔內重複（合併）"); }
        seen.add(key);
        const found = all.filter(a => a.sid === sid && a.study === study && St.status(a.key) === "in_stock");
        row.avail = found.length;
        if (!found.length) { row.status = "err"; row.msgs.push("E00 找不到在庫檢體"); out.push(row); return; }
        if (found.length < qty) { row.status = "warn"; row.msgs.push(`W01 數量不足（可用 ${found.length}）`); row.qty = found.length; }
        row.targets = found.slice(0, row.qty).map(a => ({ key: a.key, box: a.box, pos: a.pos, sid: a.sid, study: a.study }));
        /* 同一 SID 可能有多管：把全部候選帶著，讓清單工作台可以改選 */
        row.alts = found.map(a => ({ key: a.key, box: a.box, pos: a.pos, vol: a.vol == null ? "" : a.vol, date: a.date || "" }));
      } else {
        const alloc = String(r[iAlloc] ?? "").trim().toUpperCase();
        row.alloc = alloc;
        if (!/^[A-Z]\d{4}[A-Z]\d{1,2}$/.test(alloc)) { row.status = "err"; row.msgs.push("E01 位置格式錯誤"); out.push(row); return; }
        const c = alloc[0], box = alloc.slice(0, 5), pos = alloc.slice(5);
        const g = S.grid[c];
        if (!g) { row.status = "err"; row.msgs.push("E02 盒號不存在"); out.push(row); return; }
        const dim = boxDim(box);
        const inRange = +box[1] >= 1 && +box[1] <= g[0] && +box[2] >= 1 && +box[2] <= g[1] &&
          +box[3] >= 1 && +box[3] <= drawerRows(c, +box[1], +box[2]) && +box[4] >= 1 && +box[4] <= g[3] &&
          pos.charCodeAt(0) - 65 < dim.rows && +pos.slice(1) >= 1 && +pos.slice(1) <= dim.cols;
        if (!inRange) { row.status = "err"; row.msgs.push("E02 盒號超出範圍"); out.push(row); return; }
        const occupied = St.boxEntries(c, box).filter(a => a.pos === pos && St.status(a.key) === "in_stock");
        if (occupied.length) {
          if (occupied.some(a => a.sid === sid)) { row.status = "warn"; row.msgs.push("W07 同 SID 已在此位置（略過）"); row.skip = true; }
          else { row.status = "err"; row.msgs.push("E03 位置已被 " + occupied[0].sid + " 佔用"); out.push(row); return; }
        }
        row.vol = String(r[iVol] ?? "").trim();
        row.date = String(r[iDate] ?? "").trim();
        row.note = String(r[iNote] ?? "").trim();
      }
      out.push(row);
    });
    imp.parsed = out;
    const ok = out.filter(r => r.status === "ok").length;
    const warn = out.filter(r => r.status === "warn").length;
    const err = out.filter(r => r.status === "err").length;
    let html = `<div class="row" style="margin:12px 0 8px">
      <span class="tag ok">可匯入 ${ok}</span>
      <span class="tag warn">警告 ${warn}</span>
      <span class="tag err">錯誤 ${err}</span>
      <span style="flex:1"></span>
      <label class="muted"><input type="checkbox" id="ack" ${imp.ack ? "checked" : ""} onchange="App.setAck(this.checked)"> 我已確認警告</label>
      <button class="btn primary" id="doimp" onclick="App.doImport()" ${(warn && !imp.ack) || !(ok + warn) ? "disabled" : ""}>確認匯入</button>
    </div>`;
    html += `<div class="scroll"><table class="tb"><thead><tr><th>列</th><th>SID</th><th>Study</th><th>位置／數量</th><th>結果</th></tr></thead><tbody>`;
    out.forEach(r => {
      const pos = imp.type === "request" ? (r.qty || "") : (r.alloc || "");
      const cls = r.status === "err" ? "err" : r.status === "warn" ? "warn" : "ok";
      html += `<tr><td>${r.n}</td><td>${esc(r.sid)}</td><td>${esc(r.study)}</td><td>${esc(pos)}</td>
        <td><span class="tag ${cls}">${esc(r.msgs.join("；") || "OK")}</span></td></tr>`;
    });
    html += `</tbody></table></div>`;
    $("#preview").innerHTML = html;
    imp.canImport = (ok + warn) > 0 && (!warn || imp.ack);
    updateSteps();
  }

  function setAck(v) { imp.ack = v; validate(); }

  async function doImport() {
    if (imp.type === "new" && St.role === "readonly") { alert("唯讀帳號不能新增檢體（需要 operator 以上）"); return; }
    const rows = (imp.parsed || []).filter(r => r.status !== "err" && !r.skip);
    if (!rows.length) { alert("沒有可匯入的資料"); return; }
    if (imp.type === "new") { openImportConfirm(rows); return; }
    await runImportRequest(rows);
  }

  async function runImportRequest(rows) {
    const name = "需求清單 " + new Date().toISOString().slice(0, 16).replace("T", " ");
    const l = await St.createList(name, "request");
    const seen = new Set();
    const items = [];
    rows.forEach(r => (r.targets || []).forEach(t => {
      if (seen.has(t.key)) return;
      seen.add(t.key);
      items.push({
        key: t.key, sid: t.sid, study: t.study, box: t.box, pos: t.pos, vol: t.vol || "", qty: 1,
        alts: (r.alts || []).slice(),
      });
    }));
    await St.addItems(l.id, items);
    currentListId = l.id;
    alert(`已建立「${l.no}｜${name}」，共 ${items.length} 支`);
    location.hash = "#lists";
  }

  /* 新增檢體：二階段確認 */
  function openImportConfirm(rows) {
    imp.pendingRows = rows;
    const warn = rows.filter(r => r.status === "warn").length;
    let vol = 0, anyVol = false;
    rows.forEach(r => { const v = parseFloat(r.vol); if (!isNaN(v)) { vol += v; anyVol = true; } });
    const list = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.sid)}</td><td>${esc(r.study)}</td>
      <td>${esc(r.alloc)}</td><td>${esc(r.vol || "—")}</td><td>${esc(r.date || "—")}</td>
      <td>${r.status === "warn" ? `<span class="tag warn">${esc(r.msgs.join("；"))}</span>` : '<span class="tag ok">可匯入</span>'}</td></tr>`).join("");
    $("#confpanel").innerHTML = `
      <div class="ck-head"><h3>新增檢體｜確認匯入</h3>
        <span class="ck-steps"><span class="on">✓ 驗證完成</span><span class="on">② 核對並匯入</span></span></div>
      <div class="sub">檔案共 ${(imp.parsed || []).length} 列｜可匯入 ${rows.length} 筆${warn ? `（含警告 ${warn} 筆）` : ""}</div>
      <div class="ck-sum">
        <div><b>匯入筆數</b><span>${rows.length} 筆</span></div>
        <div><b>警告</b><span>${warn} 筆</span></div>
        <div><b>合計容量</b><span>${anyVol ? Math.round(vol * 10) / 10 + " mL" : "未填"}</span></div>
        <div><b>匯入批號</b><span>確認後產生 I…</span></div>
      </div>
      <div class="ck-tb"><table class="tb"><thead><tr><th>#</th><th>SID</th><th>Study</th><th>位置</th>
        <th>容量(mL)</th><th>採檢日</th><th>結果</th></tr></thead><tbody>${list}</tbody></table></div>
      <div class="ck-warn" style="margin-top:10px">確認後會立即寫入 ${rows.length} 筆入庫紀錄並取得匯入批號（I 開頭），寫入後不可自動復原。</div>
      <label class="ck-ack"><input type="checkbox" onchange="App.impAck(this.checked)">
        <span>我已核對 <b>位置、容量與採檢日</b> 無誤。</span></label>
      <div class="ck-foot">
        <button class="btn" style="margin-right:auto" onclick="App.impConfirmClose()">取消</button>
        <button class="btn primary" id="confgo" disabled onclick="App.impConfirmGo()">確認匯入（${rows.length} 筆）</button>
      </div>`;
    $("#confmodal").classList.add("on");
  }

  function impAck(v) {
    const b = document.getElementById("confgo");
    if (b) b.disabled = !v;
  }

  function impConfirmGo() {
    const rows = imp.pendingRows || [];
    if (!rows.length) return;
    impConfirmClose();
    runImportNew(rows);
  }

  function impConfirmClose() {
    $("#confmodal").classList.remove("on");
    $("#confpanel").innerHTML = "";
  }

  async function runImportNew(rows) {
    let res;
    try {
      res = await St.importRows(rows);
    } catch (e) {
      alert("匯入失敗：" + e.message);
      return;
    }
    const errs = (res.errors || []).length;
    alert(`已匯入 ${res.inserted} 筆（匯入批號 ${res.batch}）${errs ? `；${errs} 筆失敗` : ""}`);
    pickInvalidate();
    imp.pendingRows = null;
    location.hash = "#map";
  }

  /* ---------------- 推薦選位（新增檢體入庫位置建議，不寫入資料） ---------------- */
  let rc = { cab: "H", study: "", n: 5, rows: null, short: false, freeTotal: 0 };

  const RC_ROWS = "ABCDEFGHI";
  const rcDist = (a, b) => {
    const ra = RC_ROWS.indexOf(a[0]), rb = RC_ROWS.indexOf(b[0]);
    const ca = +a.slice(1), cb = +b.slice(1);
    return Math.abs(ra - rb) + Math.abs(ca - cb);
  };

  function rcBoxInfo(cab, study) {
    const cabs = cab ? [cab] : S.order.slice();
    const out = [];
    cabs.forEach(c => {
      const groups = {};
      St.allAliquots(c).forEach(a => {
        if (St.status(a.key) !== "in_stock") return;
        if ((a.kind || 0) !== 0) return;
        (groups[a.box] = groups[a.box] || []).push({ pos: a.pos, study: a.study });
      });
      Object.keys(groups).sort().forEach(code => {
        const tubes = groups[code];
        const counts = {};
        tubes.forEach(t => { counts[t.study] = (counts[t.study] || 0) + 1; });
        const used = new Set(tubes.map(t => t.pos));
        const free = MG_POS.filter(p => !used.has(p));
        const nS = study ? (counts[study] || 0) : 0;
        const max = Object.values(counts).reduce((m, x) => Math.max(m, x), 0);
        out.push({ code: code, cab: c, tubes: tubes, counts: counts, free: free, nS: nS, max: max, total: tubes.length, dominant: nS > 0 && nS === max });
      });
    });
    return out;
  }

  /* 單一櫃內的推薦：既有 Study 集中主盒、位置靠近同 Study；新 Study 從空位最多的盒開始 */
  function rcPlanInBoxes(info, study, n) {
    const existing = study ? info.filter(x => x.nS > 0 && x.free.length) : [];
    const rows = [];
    let remain = n;

    const take = (x) => {
      if (remain <= 0) return;
      const same = study ? x.tubes.filter(t => t.study === study).map(t => t.pos) : [];
      const free = x.free.slice().sort((p, q) => {
        const dp = same.length ? Math.min.apply(null, same.map(s2 => rcDist(s2, p))) : 0;
        const dq = same.length ? Math.min.apply(null, same.map(s2 => rcDist(s2, q))) : 0;
        return dp - dq || MG_POS.indexOf(p) - MG_POS.indexOf(q);
      });
      for (const pos of free) {
        if (remain <= 0) break;
        rows.push({ box: x.code, pos: pos });
        remain--;
      }
    };

    if (!existing.length) {
      info.filter(x => x.free.length)
        .sort((a, b) => b.free.length - a.free.length)
        .forEach(take);
    } else {
      const fitAll = existing.filter(x => x.dominant && x.free.length >= remain)
        .sort((a, b) => a.free.length - b.free.length || b.nS - a.nS);
      if (fitAll.length) take(fitAll[0]);
      existing.filter(x => x.dominant).sort((a, b) => b.free.length - a.free.length).forEach(take);
      existing.filter(x => !x.dominant).sort((a, b) => b.free.length - a.free.length).forEach(take);
      info.filter(x => !x.nS && x.free.length).sort((a, b) => b.free.length - a.free.length).forEach(take);
    }
    return rows;
  }

  /* 對外：指定冰箱就只用該櫃；全部冰箱時「先集中同一櫃」，不夠才跨櫃 */
  function rcPlan(cab, study, n) {
    if (cab) {
      const info = rcBoxInfo(cab, study);
      return { rows: rcPlanInBoxes(info, study, n), short: false, freeTotal: info.reduce((a, x) => a + x.free.length, 0) };
    }
    const all = rcBoxInfo("", study);
    const perCab = S.order.map(c => {
      const info = all.filter(x => x.cab === c);
      const tubeS = info.reduce((a, x) => a + x.nS, 0);
      const fitBox = info.filter(x => x.nS > 0 && x.dominant && x.free.length >= n)
        .sort((a, b) => a.free.length - b.free.length)[0];
      const maxFree = info.reduce((m, x) => Math.max(m, x.free.length), 0);
      return { c: c, info: info, tubeS: tubeS, fitBox: fitBox, maxFree: maxFree, free: info.reduce((a, x) => a + x.free.length, 0) };
    });
    /* 挑主櫃：既有 Study 先找「一盒就能放完」的櫃（挑剛好的），否則此 Study 最多的櫃；新 Study 找最空的櫃 */
    perCab.sort((a, b) => {
      if (study) {
        const fa = a.fitBox ? 0 : 1, fb = b.fitBox ? 0 : 1;
        if (fa !== fb) return fa - fb;
        if (fa === 0) return a.fitBox.free.length - b.fitBox.free.length;
        return b.tubeS - a.tubeS || b.free - a.free;
      }
      return b.maxFree - a.maxFree || b.free - a.free;
    });
    const rows = [];
    let remain = n;
    for (const p of perCab) {
      if (remain <= 0) break;
      const r = rcPlanInBoxes(p.info, study, remain);
      r.forEach(x => rows.push(x));
      remain = n - rows.length;
    }
    return { rows: rows, short: rows.length < n, freeTotal: all.reduce((a, x) => a + x.free.length, 0) };
  }

  function renderRecommend() {
    const studies = allStudies().slice().sort();
    if (!rc.study) rc.study = studies[0];
    const isNew = rc.study === "__new__";
    $("#view").innerHTML = `<h1 class="page">推薦選位 <span class="tag" style="vertical-align:3px">規劃工具 · 不寫入資料</span></h1>
      <div class="mg2">
        <div class="mgleft">
          <div class="card">
            <div class="mgform">
              <label>冰箱
                <select onchange="App.rcSet('cab', this.value)">
                  <option value="" ${rc.cab === "" ? "selected" : ""}>（全部冰箱）</option>
                  ${S.order.map(c => `<option value="${esc(c)}" ${c === rc.cab ? "selected" : ""}>${esc(c)}</option>`).join("")}
                </select></label>
              <label>Study
                <select onchange="App.rcSet('study', this.value)">
                  ${studies.map(x => `<option value="${esc(x)}" ${x === rc.study ? "selected" : ""}>${esc(x)}</option>`).join("")}
                  <option value="__new__" ${isNew ? "selected" : ""}>＋ 新 Study（未命名）</option>
                </select></label>
              <label>要新增幾支
                <input type="number" min="1" max="500" value="${rc.n}" onchange="App.rcSet('n', this.value)"></label>
              <button class="btn primary" onclick="App.rcPlan()">產生推薦位置</button>
            </div>
            <div class="muted" style="font-size:12px;line-height:1.7;margin-top:10px">
              既有 Study：優先放進「以它為主」的盒（空位剛好夠放完的優先、位置靠近同 Study）；不夠才開新盒。
              新 Study：不看 Study，直接從空位最多的盒開始。冰箱選「全部」時會先集中在同一櫃，該櫃不夠才跨櫃。</div>
          </div>
          <div id="rcinfo"></div>
        </div>
        <div class="mgright">
          <div class="card">
            <div class="row"><b>推薦位置</b><span class="muted">綠色框＝建議放進去的空格</span></div>
            <div class="mg-legend"><i class="sw mi"></i>推薦位置　其他＝現有檢體</div>
            <div id="rcgrid" class="mg-grids"></div>
          </div>
        </div>
      </div>`;
    renderRcResult();
  }

  function rcSet(key, val) {
    if (key === "n") rc.n = Math.max(1, Math.min(500, parseInt(val, 10) || 1));
    else rc[key] = val;
    rc.rows = null;
    renderRecommend();
  }

  function rcRun() {
    const study = rc.study === "__new__" ? "" : rc.study;
    const res = rcPlan(rc.cab, study, rc.n);
    rc.rows = res.rows;
    rc.short = res.short;
    rc.freeTotal = res.freeTotal;
    rc.runStudy = study;
    renderRcResult();
  }

  function renderRcResult() {
    const info = document.getElementById("rcinfo");
    const grid = document.getElementById("rcgrid");
    if (!info) return;
    if (!rc.rows) {
      info.innerHTML = `<div class="card"><div class="muted" style="padding:10px">選好冰箱、Study 與數量後按「產生推薦位置」。</div></div>`;
      if (grid) grid.innerHTML = "";
      return;
    }
    const studyLabel = rc.runStudy ? rc.runStudy : "新 Study（未命名）";
    const rows = rc.rows;
    const boxes = [...new Set(rows.map(r => r.box))];
    let html = "";
    if (rc.short) {
      html += `<div class="ck-warn" style="margin-bottom:12px">目前只剩 <b>${rc.freeTotal}</b> 格，只能推薦 <b>${rows.length}</b> 個位置（需求 ${rc.n} 個）。</div>`;
    }
    html += `<div class="ck-sum" style="grid-template-columns:1fr 1fr">
      <div><b>冰箱</b><span>${esc(rc.cab || "全部")}</span></div>
      <div><b>Study</b><span>${esc(studyLabel)}</span></div>
      <div><b>推薦位置</b><span>${rows.length} 個</span></div>
      <div><b>用到幾個盒</b><span>${boxes.length} 盒</span></div>
    </div>`;
    html += `<div class="card"><b>推薦位置清單</b>
      <div class="scroll" style="max-height:40vh;margin-top:8px"><table class="tb"><thead><tr>
      <th style="width:60px">#</th><th>盒</th><th>位置</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      html += `<tr><td>${i + 1}</td><td><b>${esc(r.box)}</b></td><td><b>${esc(r.pos)}</b></td></tr>`;
    });
    html += `</tbody></table></div>
      <div style="margin-top:12px"><button class="btn primary" style="width:100%" onclick="App.rcExport()">產生新增檢體清單（Excel）</button>
      <div class="muted" style="margin-top:8px;font-size:12px">欄位同「新增檢體」範本（SID／Study／Allocation／Volume／Samplingdate／Note），只有位置已填</div></div></div>`;
    info.innerHTML = html;

    if (!grid) return;
    const byBox = {};
    rows.forEach(r => { (byBox[r.box] = byBox[r.box] || new Set()).add(r.pos); });
    grid.innerHTML = Object.keys(byBox).sort().map(code => {
      const cab = code[0];
      const tubes = St.boxEntries(cab, code).filter(a => St.status(a.key) === "in_stock" && (a.kind || 0) === 0)
        .map(a => ({ pos: a.pos, sid: a.sid, study: a.study, vol: a.vol }));
      return `<div class="mgbox"><h5><span>${esc(code)}</span><span class="muted">${tubes.length} 支・推薦 ${byBox[code].size} 格</span></h5>${mgGridHTML(tubes, { in: byBox[code] }, code)}</div>`;
    }).join("");
  }

  function rcExport() {
    if (!rc.rows || !rc.rows.length) { alert("請先產生推薦位置"); return; }
    const study = rc.runStudy || "";
    const today = new Date();
    const pd = (n) => String(n).padStart(2, "0");
    const day = `${today.getFullYear()}${pd(today.getMonth() + 1)}${pd(today.getDate())}`;
    const sheet = {
      name: "新增檢體",
      title: `${rc.cab || "全部冰箱"}｜${study || "新 Study"}｜推薦入庫位置 ${rc.rows.length} 支`,
      subtitle: `產生時間 ${fmt(today.toISOString())}　（只有位置已填，其餘欄位請自行填寫）`,
      headers: ["SID", "Study", "Allocation", "Volume", "Samplingdate", "Note"],
      widths: [16, 16, 12, 11, 14, 20],
      rows: rc.rows.map(r => ["", "", r.box + r.pos, "", "", ""]),
      note: "位置（Allocation）已依推薦結果填好；填上 SID、Study 等欄位後，可在「匯入精靈 → 新增檢體」匯入。",
    };
    const bytes = window.MergeXlsx.buildXlsx([sheet]);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `新增檢體_${rc.cab || "ALL"}_${study || "NEWSTUDY"}_${day}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
  }

  /* ---------------- 整併規劃（只產清單，不改資料） ---------------- */
  let mg = { cab: "H", study: "", k: 3, mode: "box", plan: null, auto: false };
  const MG = window.MergePlan;
  const MG_POS = MG.POS;

  function mgBoxes(cab) {
    const map = {};
    St.allAliquots(cab).forEach(a => {
      if (St.status(a.key) !== "in_stock") return;
      if ((a.kind || 0) !== 0) return;
      (map[a.box] = map[a.box] || []).push({ sid: a.sid, study: a.study, vol: a.vol, date: a.date, pos: a.pos });
    });
    return Object.keys(map).sort().map(code => ({ code, cap: boxCapacity(code), tubes: map[code] }));
  }

  function renderMerge() {
    const studies = ["", ...allStudies().slice().sort()];
    const isBox = mg.mode === "box";
    $("#view").innerHTML = `<h1 class="page">整併規劃 <span class="tag" style="vertical-align:3px">規劃工具 · 不寫入資料</span></h1>
      <div class="mg2">
        <div class="mgleft">
          <div class="card">
            <div class="mgform">
              <label>模式
                <select onchange="App.mgSet('mode', this.value)">
                  <option value="box" ${isBox ? "selected" : ""}>盒整併（可搬其他 Study，空出盒位）</option>
                  <option value="study" ${!isBox ? "selected" : ""}>同 Study 整併（集中回只裝它的盒）</option>
                </select></label>
              <label>冰箱
                <select onchange="App.mgSet('cab', this.value)">${S.order.map(c => `<option value="${esc(c)}" ${c === mg.cab ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
              <label>Study
                <select onchange="App.mgSet('study', this.value)">${studies.map(x => `<option value="${esc(x)}" ${x === mg.study ? "selected" : ""}>${esc(x) || "（自動選擇）"}</option>`).join("")}</select></label>
              ${isBox ? `<label>整併盒數（2–8）
                <input type="number" min="2" max="8" value="${mg.k}" onchange="App.mgSet('k', this.value)"></label>` : ""}
              <button class="btn primary" onclick="App.mgPlan()">產生方案</button>
            </div>
            <div class="muted" style="font-size:12px;line-height:1.7;margin-top:10px">
              ${isBox
                ? "<b>盒整併</b>：補滿盒＝主要檢體是這個 Study；移出盒＝這個 Study 佔相對少，<b>整盒</b>（含其他 Study）搬進補滿盒 → 可空出盒位。"
                : "<b>同 Study 整併</b>：把這個 Study 散在各盒的檢體集中回<b>只裝這個 Study 的盒</b>；只搬這個 Study，其他不動。"}</div>
          </div>
          <div id="mginfo"></div>
        </div>
        <div class="mgright">
          <div class="card">
            <div class="row"><b>整併前</b><span class="muted">目前盒內狀態（紅虛線＝這一管要搬走）</span></div>
            <div class="mg-legend"><i class="sw mo"></i>要搬出　<i class="sw mi"></i>新放進來　其他＝留在原位</div>
            <div id="mgbefore" class="mg-grids"></div>
          </div>
          <div class="card" style="margin-top:14px">
            <div class="row"><b>整併後</b><span class="muted">完成後盒內狀態（綠框＝這次放進去的）</span></div>
            <div class="mg-legend"><i class="sw mi"></i>新放進來　其他＝原本就在</div>
            <div id="mgafter" class="mg-grids"></div>
          </div>
        </div>
      </div>`;
    renderMergeResult();
  }

  function mgSet(key, val) {
    if (key === "k") mg[key] = Math.max(2, Math.min(8, parseInt(val, 10) || 3));
    else mg[key] = val;
    mg.plan = null; mg.auto = false;
    renderMerge();
  }

  function mgPlan() {
    const res = MG.planMerge(mgBoxes(mg.cab), { study: mg.study, k: mg.k, mode: mg.mode, auto: !mg.study });
    if (res.error) { alert(res.error); return; }
    mg.plan = res.plan;
    mg.auto = !!res.auto;
    renderMergeResult();
  }

  /* 81 格盒圖（顏色＝Study；marks.out／marks.in 標示變動） */
  function mgGridHTML(tubes, marks, code) {
    const dim = code ? boxDim(code) : { rows: 9, cols: 9 };
    const byPos = {};
    tubes.forEach(t => { byPos[t.pos] = t; });
    let h = `<div class="wgrid" style="--cols:${dim.cols}"><div class="wh"></div>`;
    for (let k = 1; k <= dim.cols; k++) h += `<div class="wh">${k}</div>`;
    for (let ri = 0; ri < dim.rows; ri++) {
      const r = String.fromCharCode(65 + ri);
      h += `<div class="wr">${r}</div>`;
      for (let k = 1; k <= dim.cols; k++) {
        const pos = r + k, t = byPos[pos];
        let cls = "w";
        if (marks && marks.out && marks.out.has(pos)) cls += " mo";
        if (marks && marks.in && marks.in.has(pos)) cls += " mi";
        const bg = t ? color(t.study) : "";
        const title = t ? pos + " " + t.study + " " + t.sid + (t.vol ? "｜" + t.vol + "mL" : "") : pos + "（空）";
        h += `<div class="${cls}"${bg ? ` style="background:${bg}"` : ""} title="${esc(title)}"></div>`;
      }
    }
    return h + `</div>`;
  }

  function renderMergeResult() {
    const info = document.getElementById("mginfo");
    if (!info) return;
    const p = mg.plan;
    const beforeEl = document.getElementById("mgbefore");
    const afterEl = document.getElementById("mgafter");
    if (!p) {
      info.innerHTML = `<div class="card"><div class="muted" style="padding:10px">選好模式、冰箱、Study${mg.mode === "box" ? "與盒數" : ""}後按「產生方案」。</div></div>`;
      if (beforeEl) beforeEl.innerHTML = "";
      if (afterEl) afterEl.innerHTML = "";
      return;
    }
    const isBox = p.mode === "box";
    const cards = isBox
      ? `<div><b>處理盒數</b><span>${p.picked.length} 盒</span></div>
         <div><b>補滿 / 移出</b><span>${p.fill.length} / ${p.source.length}</span></div>
         <div><b>可空出</b><span>${p.freed.length ? p.freed.join("、") : "0 盒"}</span></div>
         <div><b>要搬</b><span>${p.moved} 管</span></div>`
      : `<div><b>目標盒（只裝此 Study）</b><span>${p.pureBoxes} 盒</span></div>
         <div><b>有變動的目標</b><span>${p.fill.length} 盒</span></div>
         <div><b>來源盒</b><span>${p.source.length} 盒</span></div>
         <div><b>要搬（只搬此 Study）</b><span>${p.moved} 管</span></div>`;

    let html = `<div class="ck-sum" style="grid-template-columns:1fr 1fr">${cards}</div>
      <div class="muted" style="margin:-4px 0 10px;font-size:12px">${mg.auto ? "系統自動選擇：" + esc(p.study) + "　｜　" : ""}此 Study 共 ${p.studyTubes} 支，${p.studyBefore} 盒 → ${p.studyAfter} 盒</div>`;

    html += `<div class="ck-warn" style="margin-bottom:12px;background:#e6f4ea;border-color:#bfe3c8;color:#1e5b28">
      ${isBox
        ? `補滿：<b>${p.fill.join("、")}</b>　｜　移出：<b>${p.source.join("、")}</b>${p.freed.length ? `（可空出 <b>${p.freed.join("、")}</b>）` : ""}`
        : `集中回 <b>${p.fill.length} 盒</b>（${p.fill.join("、")}）；來源 ${p.source.length} 盒（${p.source.join("、")}）。${p.freed.length ? `<b>${p.freed.join("、")}</b> 清空後可空出。` : ""}`}</div>`;

    /* 處理的盒（精簡版） */
    html += `<div class="card"><b>${isBox ? "處理的盒" : "有變動的盒"}</b>
      <div class="scroll" style="max-height:46vh;margin-top:8px"><table class="tb"><thead><tr>
      <th>盒</th><th>角色</th><th>支數</th><th>結果</th></tr></thead><tbody>`;
    p.picked.forEach(bk => {
      const afterAll = p.assign.filter(a => a.toBox === bk.code).length;
      const isMain = bk.role === "fill" || bk.role === "target";
      const roleTag = isMain
        ? `<span class="tag ok">${isBox ? "補滿" : "目標"}</span>`
        : `<span class="tag warn">${isBox ? "移出" : "來源"}</span>`;
      let result;
      if (isBox) result = p.freed.includes(bk.code) ? '<span class="tag ok">空出</span>' : '<span class="tag">保留</span>';
      else result = isMain ? '<span class="tag ok">集中</span>' : '<span class="tag">清空</span>';
      html += `<tr><td><b>${esc(bk.code)}</b></td><td>${roleTag}</td>
        <td>${bk.n} → <b>${afterAll}</b></td><td>${result}</td></tr>`;
    });
    html += `</tbody></table></div></div>`;

    html += `<div class="card" style="margin-top:14px"><button class="btn primary" style="width:100%" onclick="App.mgExport()">下載整併清單（Excel）</button>
      <div class="muted" style="margin-top:8px;font-size:12px">Excel 內含 4 個工作表：方案摘要、領出清單、入庫清單、完成後盒內容</div></div>`;
    info.innerHTML = html;

    /* 右欄：整併前 / 整併後 盒圖 */
    if (!beforeEl || !afterEl) return;
    const boxes = p.picked.map(b => b.code);
    const beforeHtml = [], afterHtml = [];
    boxes.forEach(code => {
      const orig = St.boxEntries(mg.cab, code)
        .filter(a => St.status(a.key) === "in_stock" && (a.kind || 0) === 0)
        .map(a => ({ pos: a.pos, sid: a.sid, study: a.study, vol: a.vol }));
      const outSet = new Set(p.assign.filter(a => a.moved && a.fromBox === code).map(a => a.fromPos));
      const inSet = new Set(p.assign.filter(a => a.moved && a.toBox === code).map(a => a.toPos));
      const after = p.assign.filter(a => a.toBox === code)
        .map(a => ({ pos: a.toPos, sid: a.sid, study: a.study, vol: a.vol }));
      const isFreed = p.freed.includes(code);
      beforeHtml.push(`<div class="mgbox"><h5><span>${esc(code)}</span><span class="muted">${orig.length} 支</span></h5>${mgGridHTML(orig, { out: outSet }, code)}</div>`);
      afterHtml.push(`<div class="mgbox"><h5><span>${esc(code)}</span><span class="muted">${after.length} 支${isFreed ? "（空出）" : ""}</span></h5>${mgGridHTML(after, { in: inSet }, code)}</div>`);
    });
    beforeEl.innerHTML = beforeHtml.join("");
    afterEl.innerHTML = afterHtml.join("");
  }

  function mgSpecs(p) {
    const today = new Date();
    const pd = (n) => String(n).padStart(2, "0");
    const day = `${today.getFullYear()}${pd(today.getMonth() + 1)}${pd(today.getDate())}`;
    const isBox = p.mode === "box";
    const modeName = isBox ? "盒整併" : "同 Study 整併";
    const title = `${p.cab} 櫃｜${p.study}｜${modeName}`;
    const moved = p.assign.filter(a => a.moved && a.toBox);

    const rows = [["冰箱", p.cab], ["Study", p.study], ["模式", modeName]];
    if (isBox) {
      rows.push(["處理盒數", `${p.picked.length} 盒`]);
      rows.push(["補滿盒", `${p.fill.length} 盒（${p.fill.join("、")}）`]);
      rows.push(["移出盒", `${p.source.length} 盒（${p.source.join("、")}）`]);
      rows.push(["可空出", p.freed.length ? p.freed.join("、") : "0 盒"]);
    } else {
      rows.push(["目標盒（只裝此 Study）", `${p.pureBoxes} 盒；有變動 ${p.fill.length} 盒（${p.fill.join("、")}）`]);
      rows.push(["來源盒", `${p.source.length} 盒（${p.source.join("、")}）`]);
    }
    rows.push(["此 Study 分佈", `${p.studyBefore} 盒 → ${p.studyAfter} 盒（共 ${p.studyTubes} 支）`]);
    rows.push(["要搬動", `${p.moved} 管`]);
    rows.push(["主要盒明細", p.picked.filter(b => b.role === "fill" || b.role === "target").map(b => {
      const after = p.assign.filter(a => a.toBox === b.code).length;
      const afterS = p.assign.filter(a => a.toBox === b.code && a.study === p.study).length;
      return `${b.code}：${b.n} → ${after} 支（此 Study ${b.nS} → ${afterS}）`;
    }).join("；")]);
    rows.push(["來源盒明細", p.picked.filter(b => b.role === "source").map(b =>
      isBox ? `${b.code}：整盒 ${b.n} 支搬走（此 Study ${b.nS} 支）`
        : `${b.code}：移出此 Study ${b.nS} 支，其他 ${b.n - b.nS} 支不動`).join("；")]);

    const summary = {
      name: "方案摘要", title, subtitle: `產生時間 ${fmt(today.toISOString())}`,
      headers: ["項目", "內容"], widths: [26, 70], rows,
      note: "本檔為整併規劃，系統資料尚未變更。實體操作請先全部領出放暫存盤，再依「入庫清單」放回。",
    };
    const outList = {
      name: "領出清單", title: `${title}｜領出清單`,
      subtitle: `共 ${moved.length} 管；一次全部領出放暫存盤`,
      headers: ["#", "SID", "Study", "原盒", "原位置", "容量(mL)", "→ 新盒", "→ 新位置"],
      widths: [6, 16, 16, 11, 9, 11, 11, 11],
      rows: moved.map((a, i) => [i + 1, a.sid, a.study, a.fromBox, a.fromPos, a.vol == null ? "" : a.vol, a.toBox, a.toPos]),
    };
    const inList = {
      name: "入庫清單", title: `${title}｜入庫清單`,
      subtitle: `共 ${moved.length} 管；照「新盒／新位置」放回`,
      headers: ["#", "SID", "Study", "新盒", "新位置", "容量(mL)", "採檢日"],
      widths: [6, 16, 16, 11, 9, 11, 14],
      rows: moved.slice()
        .sort((a, b) => a.toBox.localeCompare(b.toBox) || MG_POS.indexOf(a.toPos) - MG_POS.indexOf(b.toPos))
        .map((a, i) => [i + 1, a.sid, a.study, a.toBox, a.toPos, a.vol == null ? "" : a.vol, a.date || ""]),
    };
    const finalRows = [];
    p.used.forEach(bx => {
      const rs = p.assign.filter(a => a.toBox === bx)
        .sort((a, b) => MG_POS.indexOf(a.toPos) - MG_POS.indexOf(b.toPos));
      rs.forEach(a => finalRows.push([bx, a.toPos, a.sid, a.study, a.vol == null ? "" : a.vol, a.date || ""]));
      finalRows.push([bx, "小計", `${rs.length} 支`, `空 ${boxCapacity(bx) - rs.length} 格`, "", ""]);
    });
    const finalList = {
      name: "完成後盒內容", title: `${title}｜完成後盒內容`,
      headers: ["盒", "位置", "SID", "Study", "容量(mL)", "採檢日"],
      widths: [11, 9, 16, 18, 11, 14],
      rows: finalRows,
    };
    return { day, specs: [summary, outList, inList, finalList] };
  }

  function mgExport() {
    const p = mg.plan;
    if (!p) { alert("請先產生方案"); return; }
    const s = mgSpecs(p);
    const bytes = window.MergeXlsx.buildXlsx(s.specs);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `整併_${p.cab}_${p.study}_${s.day}_${p.mode}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
  }

  /* ---------------- 帳號管理後台（admin） ---------------- */
  const ROLE_NAME = { admin: "系統管理員", operator: "操作員", readonly: "唯讀" };
  const ROLE_DESC = {
    admin: "全部權限：日常操作＋帳號管理" ,
    operator: "日常操作：清單、領出、入庫、新增檢體匯入",
    readonly: "只能看：冰箱地圖、檢體分布、清單查詢都可用；不能領出、標記缺、新增檢體、管理帳號",
  };
  let usersCache = [];

  function renderUsers() {
    $("#view").innerHTML = `<h1 class="page">帳號管理</h1>
      <div class="card" id="userbox"><div class="muted" style="padding:16px">載入中…</div></div>`;
    if (!St.cloud) {
      $("#userbox").innerHTML = `<div class="muted" style="padding:16px">離線模式沒有帳號管理；請以雲端帳號登入。</div>`;
      return;
    }
    if (St.role !== "admin") {
      $("#userbox").innerHTML = `<div class="muted" style="padding:16px">僅 admin 可檢視帳號管理。</div>`;
      return;
    }
    loadUsers();
  }

  function loadUsers() {
    const box = $("#userbox");
    if (!box) return;
    box.innerHTML = `<div class="muted" style="padding:16px">載入中…</div>`;
    St.listUsers().then((rows) => {
      usersCache = rows || [];
      paintUsers();
    }).catch((e) => {
      const msg = String(e.message || e);
      const hint = /function|schema cache|does not exist/i.test(msg)
        ? `<div class="muted" style="margin-top:8px">資料庫還沒套用 <code>db/07_users.sql</code>。</div>` : "";
      box.innerHTML = `<div class="muted" style="padding:16px">載入失敗：${esc(msg)}${hint}</div>`;
    });
  }

  function userStats() {
    const s = { total: usersCache.length, admin: 0, operator: 0, readonly: 0, off: 0 };
    usersCache.forEach((u) => {
      if (s[u.role] != null) s[u.role]++;
      if (!u.active) s.off++;
    });
    return s;
  }

  function paintUsers() {
    const st = userStats();
    const rows = usersCache.map((u) => `<tr>
      <td>${esc(u.email || "—")}<div class="muted" style="font-size:11px">${esc(String(u.id).slice(0, 8))}</div></td>
      <td><input value="${esc(u.display_name || "")}" title="改完按 Enter 或點空白處儲存"
          onchange="App.userRename('${u.id}', this.value)"
          style="width:130px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;font:inherit"></td>
      <td><select onchange="App.userSetRole('${u.id}', this.value)" ${u.id === myId() ? 'title="自己的角色"' : ""}>
        ${["admin", "operator", "readonly"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
      </select><div class="muted" style="font-size:11px">${esc(ROLE_NAME[u.role] || "")}</div></td>
      <td>${u.active ? '<span class="tag ok">啟用</span>' : '<span class="tag err">停用</span>'}</td>
      <td>${u.last_sign_in_at ? fmt(u.last_sign_in_at) : '<span class="muted">尚未登入</span>'}</td>
      <td>${fmt(u.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn" style="padding:3px 8px;font-size:12px" onclick="App.userPw('${u.id}')">重設密碼</button>
        <button class="btn" style="padding:3px 8px;font-size:12px" ${u.id === myId() ? "disabled" : ""}
          onclick="App.userToggle('${u.id}')" id="tg_${u.id}">${u.active ? "停用" : "啟用"}</button>
        <button class="btn danger" style="padding:3px 8px;font-size:12px" ${u.id === myId() ? "disabled" : ""}
          onclick="App.userDel('${u.id}')">刪除</button>
      </td>
    </tr>`).join("");

    $("#userbox").innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <b style="font-size:15px">共 ${st.total} 位</b>
        <span class="tag">admin ${st.admin}</span>
        <span class="tag">operator ${st.operator}</span>
        <span class="tag">readonly ${st.readonly}</span>
        ${st.off ? `<span class="tag err">停用 ${st.off}</span>` : ""}
        <span style="flex:1"></span>
        <button class="btn" onclick="App.reloadUsers()">重新整理</button>
        <button class="btn primary" onclick="App.userNew()">＋ 新增帳號</button>
      </div>
      <div class="scroll"><table class="tb"><thead><tr>
        <th>Email</th><th>名稱</th><th>角色</th><th>狀態</th><th>最後登入</th><th>建立時間</th><th>操作</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">尚無帳號</td></tr>'}</tbody></table></div>
      <div class="muted" style="margin-top:10px;line-height:1.7">
        <b>admin</b>＝${ROLE_DESC.admin}<br>
        <b>operator</b>＝${ROLE_DESC.operator}<br>
        <b>readonly</b>＝${ROLE_DESC.readonly}<br>
        停用後該帳號無法登入讀取；刪除會一併移除登入帳號（無法復原）。
      </div>`;
  }

  function myId() { return window.CLOUD_UID || ""; }

  function openUserModal(html) {
    const m = $("#usermodal");
    if (!m) return;
    $("#userpanel").innerHTML = html;
    m.classList.add("on");
  }
  function closeUserModal() { const m = $("#usermodal"); if (m) m.classList.remove("on"); }

  function genPw(id) {
    const cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const a = new Uint32Array(14);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.floor(Math.random() * 1e9));
    let s = "";
    for (let i = 0; i < a.length; i++) s += cs[a[i] % cs.length];
    const el = document.getElementById(id);
    if (el) { el.type = "text"; el.value = s; }
    return s;
  }

  function userNew() {
    openUserModal(`
      <button class="close" onclick="App.userClose()">關閉</button>
      <h3>新增帳號</h3>
      <div class="sub">建立後即可用這個 Email／密碼登入，角色之後可隨時調整。</div>
      <div style="display:grid;gap:10px">
        <label>Email<input id="nu_email" type="email" placeholder="name@company.com" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid var(--line);border-radius:6px"></label>
        <label>名稱<input id="nu_name" placeholder="王小明" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid var(--line);border-radius:6px"></label>
        <label>角色<select id="nu_role" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid var(--line);border-radius:6px">
          <option value="operator">operator — ${ROLE_DESC.operator}</option>
          <option value="readonly">readonly — ${ROLE_DESC.readonly}</option>
          <option value="admin">admin — ${ROLE_DESC.admin}</option>
        </select></label>
        <label>密碼
          <div class="row" style="gap:6px;margin-top:4px;flex-wrap:nowrap">
            <input id="nu_pw" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="至少 6 碼">
            <button class="btn" onclick="App.genPw('nu_pw')">產生</button>
          </div>
        </label>
      </div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn" onclick="App.userClose()">取消</button>
        <button class="btn primary" onclick="App.userCreate()">建立帳號</button>
      </div>`);
    setTimeout(() => { const el = document.getElementById("nu_email"); if (el) el.focus(); }, 60);
  }

  async function userCreate() {
    const v = (id) => (document.getElementById(id) || {}).value || "";
    const email = v("nu_email").trim();
    const name = v("nu_name").trim();
    const role = v("nu_role") || "operator";
    const pw = v("nu_pw");
    if (!email.includes("@")) { alert("請填正確的 Email"); return; }
    if (pw.length < 6) { alert("密碼至少 6 碼（可按「產生」）"); return; }
    try {
      await St.createUser({ email, password: pw, display_name: name, role });
      closeUserModal();
      try { await navigator.clipboard.writeText(`${email}\n${pw}`); } catch (e) {}
      alert(`已建立帳號\n\nEmail：${email}\n密碼：${pw}\n角色：${role}\n\n（已複製到剪貼簿，請自行轉交，勿留在公開頻道）`);
      loadUsers();
    } catch (e) {
      alert("建立失敗：" + e.message);
    }
  }

  function userPw(id) {
    const u = usersCache.find((x) => x.id === id) || {};
    openUserModal(`
      <button class="close" onclick="App.userClose()">關閉</button>
      <h3>重設密碼</h3>
      <div class="sub">${esc(u.email || "")}</div>
      <div class="row" style="gap:6px;flex-wrap:nowrap">
        <input id="rp_pw" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="至少 6 碼">
        <button class="btn" onclick="App.genPw('rp_pw')">產生</button>
      </div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn" onclick="App.userClose()">取消</button>
        <button class="btn primary" onclick="App.userPwSave('${id}')">套用新密碼</button>
      </div>`);
    setTimeout(() => { const el = document.getElementById("rp_pw"); if (el) el.focus(); }, 60);
  }

  async function userPwSave(id) {
    const el = document.getElementById("rp_pw");
    const pw = el ? el.value : "";
    if (pw.length < 6) { alert("密碼至少 6 碼"); return; }
    try {
      await St.setPassword(id, pw);
      closeUserModal();
      try { await navigator.clipboard.writeText(pw); } catch (e) {}
      alert(`密碼已更新（已複製）：${pw}`);
    } catch (e) {
      alert("重設失敗：" + e.message);
    }
  }

  async function userRename(id, name) {
    try { await St.updateUser(id, { display_name: String(name || "").trim() }); loadUsers(); }
    catch (e) { alert("改名失敗：" + e.message); }
  }

  async function userSetRole(id, role) {
    const u = usersCache.find((x) => x.id === id) || {};
    if (!confirm(`把「${u.email || id}」的角色改為 ${role}（${ROLE_NAME[role] || ""}）？`)) { paintUsers(); return; }
    try { await St.updateUser(id, { role }); loadUsers(); }
    catch (e) { alert("改角色失敗：" + e.message); paintUsers(); }
  }

  async function userToggle(id) {
    const u = usersCache.find((x) => x.id === id) || {};
    const next = !u.active;
    if (!confirm(`${next ? "啟用" : "停用"}「${u.email || id}」？${next ? "" : "\n停用後該帳號將無法登入或讀取資料。"}`)) return;
    try { await St.updateUser(id, { active: next }); loadUsers(); }
    catch (e) { alert("更新失敗：" + e.message); }
  }

  async function userDel(id) {
    const u = usersCache.find((x) => x.id === id) || {};
    if (!confirm(`刪除「${u.email || id}」？\n\n這會一併移除登入帳號，無法復原。`)) return;
    if (!confirm("確定要刪除？（第二次確認）")) return;
    try { await St.deleteUser(id); loadUsers(); }
    catch (e) { alert("刪除失敗：" + e.message); }
  }

  /* ---------------- 交易紀錄 ---------------- */
  function renderLedger() {
    const mv = St.movements;
    const bs = outBatches();
    const batchOpts = bs.length
      ? bs.map(b => `<option value="${esc(b.batch)}">${esc(b.batch)}｜${fmtWhen(b.when)}｜${esc(b.recipient || "（未填領取人）")}｜${b.n} 支</option>`).join("")
      : `<option value="">（尚無領取單）</option>`;
    let html = `<h1 class="page">交易紀錄</h1><div class="card">
      <div class="row" style="margin-bottom:10px">
        <span class="muted">共 ${mv.length} 筆</span><span style="flex:1"></span>
        <select id="batchsel" class="toolsel" title="選擇領取單號，重新下載同一張領取單（Excel）" ${bs.length ? "" : "disabled"}>${batchOpts}</select>
        <button class="btn primary" onclick="App.saveBatchSelXlsx()" ${bs.length ? "" : "disabled"}>下載領取單（Excel）</button>
        <button class="btn" onclick="App.exportLedger()">匯出 CSV</button>
        <button class="btn danger" onclick="App.resetAll()">清除原型資料</button>
      </div>
      <div class="scroll"><table class="tb"><thead><tr>
        <th>時間</th><th>類型</th><th>單號</th><th>SID</th><th>Study</th><th>盒</th><th>位置</th><th>領取人</th><th>目的</th><th>操作人</th></tr></thead><tbody>`;
    if (!mv.length) html += `<tr><td colspan="10" class="muted">尚無紀錄</td></tr>`;
    mv.forEach(m => {
      const out = m.type === "OUT";
      const t = out ? '<span class="tag err">領出</span>' : '<span class="tag ok">入庫</span>';
      const when = out && m.pickupAt
        ? (fmtWhen(m.pickupAt) === fmt(m.at) ? fmtWhen(m.pickupAt)
          : `${fmtWhen(m.pickupAt)}<br><span class="muted">記錄 ${fmt(m.at)}</span>`)
        : fmt(m.at);
      const no = m.batch ? `<b>${esc(m.batch)}</b>` : '<span class="muted">—</span>';
      const who = out ? esc(m.recipient || "—") + (m.unit ? `<br><span class="muted">${esc(m.unit)}</span>` : "") : '<span class="muted">—</span>';
      const pur = out ? esc(m.purpose || "—") + (m.note ? `<br><span class="muted">${esc(m.note)}</span>` : "") : '<span class="muted">—</span>';
      html += `<tr><td>${when}</td><td>${t}</td><td>${no}</td><td>${esc(m.sid)}</td><td>${esc(m.study)}</td><td>${esc(m.box)}</td><td>${esc(m.pos)}</td><td>${who}</td><td>${pur}</td><td>${esc(m.operator)}</td></tr>`;
    });
    html += `</tbody></table></div>`;

    const cf = (S.conflicts || []);
    const cfRemoved = cf.reduce((a, c) => a + ((c.removed || []).length), 0);
    html += `<h2 style="font-size:15px;color:var(--navy);margin:22px 0 8px">位置衝突（同一位置多支，地圖以紅框標示）</h2>
      <div class="row" style="margin-bottom:8px">
        <span class="muted">共 ${cf.length} 個位置、${cfRemoved} 支重複</span>
        <span style="flex:1"></span>
        <button class="btn" onclick="App.exportConflicts()">匯出衝突清單 CSV</button>
      </div>
      <div class="scroll" style="max-height:40vh"><table class="tb"><thead><tr>
        <th>盒</th><th>位置</th><th>主要（地圖顯示）</th><th>重複</th></tr></thead><tbody>`;
    if (!cf.length) html += `<tr><td colspan="4" class="muted">無</td></tr>`;
    cf.forEach(c => {
      const kept = c.kept || { study: c.study || "", sid: c.sid || "", date: "" };
      const removed = c.removed || [];
      html += `<tr><td>${esc(c.box)}</td><td>${esc(c.pos)}</td>
        <td>${esc(kept.study)} ${esc(kept.sid)}<span class="muted">（${esc(kept.date || "-")}）</span></td>
        <td>${removed.length ? removed.map(r => `${esc(r.study)} ${esc(r.sid)}<span class="muted">（${esc(r.date || "-")}）</span>`).join("<br>") : '<span class="muted">—</span>'}</td></tr>`;
    });
    html += `</tbody></table></div></div>`;
    $("#view").innerHTML = html;
  }

  function exportConflicts() {
    const rows = [["盒", "位置", "主要Study", "主要SID", "主要日期", "重複Study", "重複SID", "重複日期"]];
    (S.conflicts || []).forEach(c => {
      const kept = c.kept || { study: c.study || "", sid: c.sid || "", date: "" };
      const removed = c.removed || [];
      if (!removed.length) rows.push([c.box, c.pos, kept.study, kept.sid, kept.date, "", "", ""]);
      else removed.forEach(r => rows.push([c.box, c.pos, kept.study, kept.sid, kept.date, r.study, r.sid, r.date]));
    });
    downloadCSV(rows, "位置衝突清單.csv");
  }

  function exportLedger() {
    const rows = [["時間", "領取時間", "類型", "單號", "SID", "Study", "盒", "位置", "領取人", "單位", "目的", "備註", "操作人"]];
    St.movements.forEach(m => rows.push([fmt(m.at), fmtWhen(m.pickupAt || ""), m.type, m.batch || "", m.sid, m.study,
      m.box, m.pos, m.recipient || "", m.unit || "", m.purpose || "", m.note || "", m.operator]));
    downloadCSV(rows, "交易紀錄.csv");
  }

  /* ---------------- Study 分布（各 Study × 冰箱 檢體數） ---------------- */
  let sf = { live: true, mode: "tubes" };   /* live=只看在庫；mode=tubes 檢體數／boxes 盒數 */

  function studyDistData() {
    const cabs = S.order;
    const tubes = new Map();   // study -> { cab: n }
    const boxes = new Map();   // study -> { cab: Set(box) }
    const pick = new Set();    // 有可領出（kind 0/1）的 Study
    for (const a of St.allAliquots()) {
      if (sf.live && St.status(a.key) !== "in_stock") continue;
      if ((a.kind || 0) >= 3) continue;            /* 區域不是檢體（無 SID 仍計入） */
      if ((a.kind || 0) <= 1) pick.add(a.study);
      const cab = a.box[0];
      if (cabs.indexOf(cab) < 0) continue;
      let t = tubes.get(a.study); if (!t) tubes.set(a.study, t = {});
      t[cab] = (t[cab] || 0) + 1;
      let b = boxes.get(a.study); if (!b) boxes.set(a.study, b = {});
      (b[cab] || (b[cab] = new Set())).add(a.box);
    }
    const rows = [...tubes.keys()].map(st => {
      const t = tubes.get(st) || {}, b = boxes.get(st) || {};
      const per = {};
      let total = 0, boxTotal = 0;
      for (const cab of cabs) {
        per[cab] = sf.mode === "boxes" ? (b[cab] ? b[cab].size : 0) : (t[cab] || 0);
        total += per[cab];
        boxTotal += b[cab] ? b[cab].size : 0;
      }
      return { study: st, per, total, boxTotal, pickable: pick.has(st), tubeTotal: Object.values(t).reduce((x, y) => x + y, 0) };
    }).filter(r => r.total > 0);
    rows.sort((a, b) => b.total - a.total || a.study.localeCompare(b.study));
    /* 不同盒數（同一盒裝多個 Study 只算 1 個盒） */
    const boxSet = new Set();
    for (const b of boxes.values()) for (const cab of Object.keys(b)) for (const code of b[cab]) boxSet.add(code);
    return { cabs, rows, boxSet };
  }

  function renderStudyDist() {
    const { cabs, rows, boxSet } = studyDistData();
    const grand = rows.reduce((n, r) => n + r.total, 0);
    const cabTotal = {};
    cabs.forEach(c => { cabTotal[c] = rows.reduce((n, r) => n + r.per[c], 0); });
    let max = 1;
    rows.forEach(r => cabs.forEach(c => { if (r.per[c] > max) max = r.per[c]; }));
    const unit = sf.mode === "boxes" ? "盒" : "支";
    const heat = (n) => {
      const base = "text-align:right";
      if (!n) return base;
      const a = (0.04 + 0.24 * Math.sqrt(n / max)).toFixed(3);
      return `${base};background:rgba(31,56,100,${a})`;
    };

    let html = `<h1 class="page">檢體分布</h1><div class="card">
      <div class="toolbar">
        <b>各 Study × 冰箱</b>
        <span class="muted">共 ${rows.length} 個 Study、${grand.toLocaleString()} ${unit}${sf.mode === "boxes" ? `（${boxSet.size.toLocaleString()} 個盒）` : ""}</span>
        <span style="flex:1"></span>
        <label class="muted" style="display:flex;align-items:center;gap:4px">
          <input type="checkbox" ${sf.live ? "checked" : ""} onchange="App.sfSet('live', this.checked)"> 只看在庫</label>
        <select onchange="App.sfSet('mode', this.value)" title="要算檢體支數，還是佔用盒數">
          <option value="tubes" ${sf.mode === "tubes" ? "selected" : ""}>檢體數</option>
          <option value="boxes" ${sf.mode === "boxes" ? "selected" : ""}>盒數</option>
        </select>
        <button class="btn" onclick="App.sfExport()">匯出 CSV</button>
      </div>
      <div class="scroll" style="max-height:70vh"><table class="tb"><thead><tr>
        <th style="min-width:120px">Study</th>
        ${cabs.map(c => `<th style="text-align:right">${c}</th>`).join("")}
        <th style="text-align:right">合計</th>
        ${sf.mode === "tubes" ? '<th style="text-align:right" title="該 Study 佔用的盒數（跨冰箱）">盒數</th>' : ""}
        <th style="text-align:right">佔比</th>
      </tr></thead><tbody>`;
    if (!rows.length) html += `<tr><td colspan="${cabs.length + 4}" class="muted">沒有資料</td></tr>`;
    rows.forEach(r => {
      const pct = grand ? (r.total / grand * 100) : 0;
      html += `<tr>
        <td><i class="sw-sq" style="background:${color(r.study)}"></i>${r.pickable
          ? `<a href="#" onclick="App.gotoStudy('${esc(r.study)}');return false" title="在清單工作台列出這個 Study">${esc(r.study)}</a>`
          : `<span title="此 Study 的檢體都沒有 SID，只能在地圖查看">${esc(r.study)}</span>`}</td>
        ${cabs.map(c => `<td style="${heat(r.per[c])}">${r.per[c] ? r.per[c].toLocaleString() : '<span class="muted">·</span>'}</td>`).join("")}
        <td style="text-align:right"><b>${r.total.toLocaleString()}</b></td>
        ${sf.mode === "tubes" ? `<td style="text-align:right" class="muted">${r.boxTotal.toLocaleString()}</td>` : ""}
        <td style="text-align:right" class="muted">${pct.toFixed(1)}%</td>
      </tr>`;
    });
    html += `</tbody><tfoot><tr style="background:#eef2f8">
      <td><b>合計</b></td>
      ${cabs.map(c => `<td style="text-align:right"><b>${cabTotal[c] ? cabTotal[c].toLocaleString() : '<span class="muted">·</span>'}</b></td>`).join("")}
      <td style="text-align:right"><b>${grand.toLocaleString()}</b></td>
      ${sf.mode === "tubes" ? `<td style="text-align:right" class="muted" title="不同盒數；同一盒裝多個 Study 只算 1 個盒">${boxSet.size.toLocaleString()}</td>` : ""}
      <td style="text-align:right" class="muted">100%</td>
    </tr></tfoot></table></div>
      <div class="muted" style="margin-top:8px;font-size:12px">
        ${sf.live ? "只計在庫（已領出／已移出未列入）" : "包含所有帳上檢體（含已領出、已移出）"}；點 Study 名稱可在「清單工作台」列出該 Study 的檢體。
        ${(window.SEED.tsghNoPid || []).length ? `另有 ${window.SEED.tsghNoPid.length} 支未歸戶 SID（IgAN deproID 的 Healthy Control／DM 世代，無 PatientID、無位置，未列入統計）。` : ""}
      </div>
    </div>`;
    $("#view").innerHTML = html;
  }

  function sfSet(k, v) {
    if (k === "live") sf.live = !!v;
    else sf.mode = v === "boxes" ? "boxes" : "tubes";
    renderStudyDist();
  }

  function sfExport() {
    const { cabs, rows, boxSet } = studyDistData();
    const grand = rows.reduce((n, r) => n + r.total, 0);
    const head = ["Study", ...cabs, "合計"];
    if (sf.mode === "tubes") head.push("盒數");
    head.push("佔比%");
    const out = [head];
    rows.forEach(r => {
      const line = [r.study, ...cabs.map(c => r.per[c]), r.total];
      if (sf.mode === "tubes") line.push(r.boxTotal);
      line.push(grand ? (r.total / grand * 100).toFixed(1) : "0.0");
      out.push(line);
    });
    const tot = ["合計", ...cabs.map(c => rows.reduce((n, r) => n + r.per[c], 0)), grand];
    if (sf.mode === "tubes") tot.push(boxSet.size);
    tot.push("100.0");
    out.push(tot);
    downloadCSV(out, `檢體分布_${sf.live ? "在庫" : "全部"}_${sf.mode === "boxes" ? "盒數" : "檢體數"}.csv`);
  }

  function gotoStudy(study) {
    pendingStudy = study;
    if (location.hash === "#lists") { applyPendingStudy(); return; }
    location.hash = "#lists";
  }
  function applyPendingStudy() {
    if (pendingStudy == null) return;
    const st = pendingStudy; pendingStudy = null;
    pickQ = ""; pickCab = ""; pickStudy = st; pickPage = 1;
    const q = document.getElementById("pq"); if (q) q.value = "";
    const c = document.getElementById("pcab"); if (c) c.value = "";
    const s = document.getElementById("pstudy"); if (s) s.value = st;
    searchPick();
  }

  /* 依單號重新下載領取單 */
  function outBatches() {
    const map = new Map();
    St.movements.forEach(m => {
      if (m.type !== "OUT" || !m.batch) return;
      const b = map.get(m.batch);
      if (b) { b.n += m.qty || 1; b.items.push(m); }
      else map.set(m.batch, {
        batch: m.batch, n: m.qty || 1, when: m.pickupAt || m.at,
        recipient: m.recipient || "", items: [m],
      });
    });
    return [...map.values()].sort((a, b) => b.batch.localeCompare(a.batch));
  }

  function batchPickup(no) {
    const ms = St.movements.filter(m => m.batch === no);
    if (!ms.length) return { err: "none" };
    const out = ms.filter(m => m.type === "OUT");
    if (!out.length) return { err: "in" };
    const h = out[0];
    const meta = {
      batch: no,
      recipient: h.recipient || "", unit: h.unit || "", purpose: h.purpose || "",
      pickupAt: h.pickupAt || h.at, note: h.note || "",
    };
    const items = out.map(m => {
      const a = St.byKey(St.KEYOF(m.box, m.pos, m.sid));
      return {
        sid: m.sid, study: m.study, box: m.box, pos: m.pos,
        vol: m.vol != null ? m.vol : (a ? a.vol : ""), qty: m.qty, res: "ok",
      };
    }).sort((a, b) => a.box.localeCompare(b.box) || a.pos.localeCompare(b.pos));
    return { meta, items };
  }

  function saveBatchXlsx(no) {
    const r = batchPickup(no);
    if (r.err === "none") { alert(`找不到單號 ${no}`); return; }
    if (r.err === "in") { alert(`單號 ${no} 是入庫批次（新增檢體），沒有領取單`); return; }
    XForm.savePickup(r.meta, r.items);
  }

  function saveBatchSelXlsx() {
    const sel = document.getElementById("batchsel");
    if (!sel || !sel.value) { alert("尚無可下載的領取單"); return; }
    saveBatchXlsx(sel.value);
  }

  function downloadCSV(rows, name) {
    const csv = rows.map(r => r.map(c => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }

  /* ---------------- 對外 ---------------- */
  window.App = {
    selCab(c) { cab = c; filter = null; renderMap(); },
    setFilter(s) { filter = (filter === s) ? null : s; renderMap(); },
    openBoxes, closeModal() { $("#modal").classList.remove("on"); },
    addBox,
    selList(id) { currentListId = id; renderLists(); },
    pickAllPending,
    searchPick, togglePick, togglePickAll, clearPick, addPicked, pickGo, pickSetSize,
    newList, delList, markMissing, exportList, toggleAll, swapTube,
    checkout: openCheckout, pick: openCheckout,
    ckField, ckAck, ckStep, ckConfirm, ckClose, ckSaveXlsx,
    reloadUsers: loadUsers, userNew, userCreate, userPw, userPwSave,
    userRename, userSetRole, userToggle, userDel, userClose: closeUserModal, genPw,
    setImpType, onFile, template, loadSample, setAck, doImport, exportLedger, exportConflicts,
    sfSet, sfExport, gotoStudy, pickInvalidate,
    mgSet, mgPlan, mgExport,
    rcSet, rcPlan: rcRun, rcExport,
    impAck, impConfirmGo, impConfirmClose,
    saveBatchXlsx, saveBatchSelXlsx,
    resetAll() { if (confirm("確定清除所有清單與交易紀錄？")) { try { St.reset(); } catch (e) { alert(e.message); return; } pickInvalidate(); currentListId = null; render(); } },
  };

  document.getElementById("role").addEventListener("change", e => { St.setRole(e.target.value); render(); });
  document.getElementById("role").value = St.role;
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if ($("#usermodal") && $("#usermodal").classList.contains("on")) closeUserModal();
    else if ($("#confmodal").classList.contains("on")) impConfirmClose();
    else if ($("#outmodal").classList.contains("on")) ckClose();
    else if ($("#modal").classList.contains("on")) $("#modal").classList.remove("on");
  });
  window.addEventListener("DOMContentLoaded", route);
  const qs = new URLSearchParams(location.search);
  if (qs.get("quiet")) { window.alert = function () {}; window.confirm = function () { return true; }; }
  if (qs.get("role")) { St.setRole(qs.get("role")); const rs = document.getElementById("role"); if (rs) rs.value = St.role; }
  const qb = qs.get("b");
  if (qs.get("demo")) location.hash = "#import";
  if (document.readyState !== "loading") route();
  if (qb) setTimeout(() => { const a = qb.split(",").map(Number); openBoxes(a[0], a[1], a[2]); }, 50);
  if (qs.get("demo")) setTimeout(() => { setImpType(qs.get("demo") === "new" ? "new" : "request"); loadSample(); }, 100);
  if (qs.get("pickdemo")) setTimeout(() => {
    if (!pickRows.length) searchPick();
    pickRows.slice(0, 3).forEach(a => pickSel.add(a.key));
    addPicked();
    pickAllPending();
    const cur = St.getList(currentListId);
    const first = cur && cur.items[0];
    if (first) cab = first.box[0];
    location.hash = "#map";
    renderMap();
  }, 800);
  if (qs.get("doimport")) setTimeout(() => {
    const cb = document.getElementById("ack");
    if (cb) cb.checked = true;
    imp.ack = true;
    validate();
    doImport();
  }, 900);
  if (qs.get("addemo")) setTimeout(() => {
    if (!pickRows.length) searchPick();
    pickRows.slice(0, 3).forEach(a => pickSel.add(a.key));
    addPicked();
  }, 600);
  if (qs.get("q")) setTimeout(() => {
    location.hash = "#lists";
    pickQ = qs.get("q");
    renderLists();
    const el = document.getElementById("pq"); if (el) el.value = pickQ;
    searchPick();
  }, 150);
})();
