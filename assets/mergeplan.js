/* 整併規劃核心（純函式，不碰檔案、不碰系統）
 * 系統分頁與 CLI 共用同一份。
 *
 * 兩種模式：
 *   box   = 盒整併（指定 K 盒）：補滿盒＝主要檢體是該 Study、移出盒＝該 Study 佔相對少；
 *           移出盒「所有檢體」都會搬（含其他 Study），因此可以真的空出盒位。
 *   study = 同 Study 整併：把某 Study 散在各盒的檢體集中回「以該 Study 為主的盒」（可多盒）。
 *           只搬該 Study，其他 Study 不動；盒數由系統自動決定。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MergePlan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const POS = [];
  for (const r of "ABCDEFGHI") for (let i = 1; i <= 9; i++) POS.push(r + i);

  const sidNum = (sid) => {
    const m = String(sid).match(/\d+/g);
    return m ? Number(m.join("")) : Number.MAX_SAFE_INTEGER;
  };
  const bySid = (a, b) => {
    const na = sidNum(a.sid), nb = sidNum(b.sid);
    if (na !== nb) return na - nb;
    if (a.sid !== b.sid) return String(a.sid).localeCompare(String(b.sid));
    return String(a.date || "").localeCompare(String(b.date || ""));
  };

  function studyCounts(box) {
    const counts = {};
    box.tubes.forEach(t => { counts[t.study] = (counts[t.study] || 0) + 1; });
    const max = Object.keys(counts).reduce((m, k) => Math.max(m, counts[k]), 0);
    return { counts, max };
  }

  function boxesWithStudy(boxes) {
    const names = new Set();
    boxes.forEach(b => b.tubes.forEach(t => names.add(t.study)));
    return [...names].sort();
  }

  /* ---------- 模式 1：盒整併（連其他 Study 一起搬） ---------- */
  function chooseRoles(boxes, study, k) {
    const info = boxes
      .filter(b => b.tubes.length > 0)
      .map(b => {
        const { counts, max } = studyCounts(b);
        return { box: b, nS: counts[study] || 0, total: b.tubes.length, max };
      })
      .filter(x => x.nS > 0);

    const fillCand = info.filter(x => x.nS === x.max)
      .sort((a, b) => a.total - b.total || a.box.code.localeCompare(b.box.code));
    const sourceCand = info.filter(x => x.nS < x.max)
      .sort((a, b) => a.nS - b.nS || a.total - b.total || a.box.code.localeCompare(b.box.code));

    if (!fillCand.length) return { error: "「" + study + "」在這一櫃沒有主要檢體是它的盒，無法補滿" };

    for (let nSource = Math.min(k - 1, sourceCand.length); nSource >= 1; nSource--) {
      const nFill = Math.min(fillCand.length, Math.max(1, k - nSource));
      const fill = fillCand.slice(0, nFill);
      const source = sourceCand.slice(0, nSource);
      const cap = fill.reduce((a, x) => a + ((x.cap || 81) - x.total), 0);
      const need = source.reduce((a, x) => a + x.total, 0);
      if (need <= cap) return { fill, source, error: null };
    }
    return { error: "「" + study + "」的補滿盒沒有足夠空位容納要移出的整盒內容（試試加大盒數）" };
  }

  function planBoxMerge(boxes, study, k) {
    const roles = chooseRoles(boxes, study, k);
    if (roles.error) return { error: roles.error };
    const fill = roles.fill, source = roles.source;
    const fillBoxes = fill.map(x => x.box);
    const sourceBoxes = source.map(x => x.box);

    const assign = [];
    fillBoxes.forEach(b => b.tubes.forEach(t => assign.push({
      sid: t.sid, study: t.study, vol: t.vol, date: t.date,
      fromBox: b.code, fromPos: t.pos, toBox: b.code, toPos: t.pos, moved: false,
    })));

    /* 移出盒的所有檢體都搬（先目標 Study，其餘依 Study 名稱、SID） */
    const moving = [];
    sourceBoxes.forEach(b => b.tubes.forEach(t => moving.push({
      sid: t.sid, study: t.study, vol: t.vol, date: t.date, fromBox: b.code, fromPos: t.pos,
    })));
    moving.sort((a, b) => {
      const ta = a.study === study ? 0 : 1, tb = b.study === study ? 0 : 1;
      if (ta !== tb) return ta - tb;
      if (a.study !== b.study) return a.study.localeCompare(b.study);
      return bySid(a, b);
    });

    const gaps = [];
    fillBoxes.forEach(b => {
      const used = new Set(b.tubes.map(t => t.pos));
      POS.forEach(pos => { if (!used.has(pos)) gaps.push({ box: b.code, pos }); });
    });
    moving.forEach((t, i) => {
      const g = gaps[i];
      assign.push(Object.assign({}, t, g ? { toBox: g.box, toPos: g.pos, moved: true } : { toBox: "", toPos: "", moved: true }));
    });

    const info = boxes.map(b => {
      const { counts } = studyCounts(b);
      return { code: b.code, n: b.tubes.length, nS: counts[study] || 0 };
    });
    const beforeBoxes = info.filter(x => x.nS > 0).length;

    return {
      mode: "box",
      study: study,
      picked: fill.map(x => ({ code: x.box.code, n: x.total, nS: x.nS, role: "fill" }))
        .concat(source.map(x => ({ code: x.box.code, n: x.total, nS: x.nS, role: "source" }))),
      fill: fillBoxes.map(b => b.code),
      source: sourceBoxes.map(b => b.code),
      assign: assign,
      used: fillBoxes.map(b => b.code),
      freed: sourceBoxes.map(b => b.code),
      moved: assign.filter(a => a.moved).length,
      kept: assign.filter(a => !a.moved).length,
      studyTubes: info.reduce((a, x) => a + x.nS, 0),
      studyBefore: beforeBoxes,
      studyAfter: beforeBoxes - sourceBoxes.length,
      error: null,
    };
  }

  /* ---------- 模式 2：同 Study 整併（集中回「只裝該 Study」的盒，可多盒） ----------
   * 目標盒＝盒內全部都是該 Study；來源盒可以是一般的混合盒，也可以是「只裝該 Study 但太小」的盒。
   * 只搬該 Study，其他 Study 不動；結果只列有變動的盒。
   */
  function planStudyMerge(boxes, study) {
    const info = boxes
      .filter(b => b.tubes.length > 0)
      .map(b => {
        const c = studyCounts(b);
        const nS = c.counts[study] || 0;
        return { box: b, nS: nS, total: b.tubes.length, max: c.max, pure: nS === b.tubes.length, cap: (b.cap || 81) - b.tubes.length };
      });
    const withS = info.filter(x => x.nS > 0);
    if (withS.length < 2) return { error: "「" + study + "」在這個櫃只有 " + withS.length + " 盒，不需要整併" };

    const pureAll = withS.filter(x => x.pure)
      .sort((a, b) => b.cap - a.cap || b.nS - a.nS || a.box.code.localeCompare(b.box.code));
    if (!pureAll.length) return { error: "這一櫃沒有「只裝 " + study + "」的盒，無法當集中目標（請改用「盒整併」模式）" };

    /* 從此 Study 最少的盒開始併走；混合盒先併（不影響容量），只裝它的盒留下當目標 */
    const asc = withS.slice().sort((a, b) =>
      (a.pure ? 1 : 0) - (b.pure ? 1 : 0) || a.nS - b.nS || a.total - b.total || a.box.code.localeCompare(b.box.code));
    const removed = new Set();
    let need = 0;
    for (const c of asc) {
      if (removed.has(c.box.code)) continue;
      const pureLeft = pureAll.filter(x => !removed.has(x.box.code));
      const targetsAfter = pureLeft.length - (c.pure ? 1 : 0);
      if (targetsAfter <= 0) break;
      const cap = pureLeft.filter(x => x.box.code !== c.box.code).reduce((a, x) => a + x.cap, 0);
      if (need + c.nS <= cap) { removed.add(c.box.code); need += c.nS; }
    }
    if (!removed.size) {
      const capAll = pureAll.reduce((a, x) => a + x.cap, 0);
      return { error: "「" + study + "」散在 " + withS.length + " 盒，但只裝它的盒只剩 " + capAll + " 格，無法集中（請改用「盒整併」模式）" };
    }

    const source = withS.filter(x => removed.has(x.box.code));
    const targets = pureAll.filter(x => !removed.has(x.box.code));
    const targetBoxes = targets.map(x => x.box);

    const assign = [];
    targetBoxes.forEach(b => b.tubes.forEach(t => assign.push({
      sid: t.sid, study: t.study, vol: t.vol, date: t.date,
      fromBox: b.code, fromPos: t.pos, toBox: b.code, toPos: t.pos, moved: false,
    })));

    const tubesToMove = [];
    source.forEach(x => x.box.tubes.filter(t => t.study === study).forEach(t => tubesToMove.push({
      sid: t.sid, study: t.study, vol: t.vol, date: t.date, fromBox: x.box.code, fromPos: t.pos,
    })));
    tubesToMove.sort(bySid);

    const gaps = [];
    targetBoxes.forEach(b => {
      const usedPos = new Set(b.tubes.map(t => t.pos));
      POS.forEach(pos => { if (!usedPos.has(pos)) gaps.push({ box: b.code, pos: pos }); });
    });
    tubesToMove.forEach((t, i) => {
      const g = gaps[i];
      assign.push(Object.assign({}, t, g ? { toBox: g.box, toPos: g.pos, moved: true } : { toBox: "", toPos: "", moved: true }));
    });

    const changedTargets = [...new Set(assign.filter(a => a.moved && a.toBox).map(a => a.toBox))];
    const mixedLeft = withS.filter(x => !x.pure && !removed.has(x.box.code)).length;

    return {
      mode: "study",
      study: study,
      picked: changedTargets.map(code => {
        const x = withS.find(y => y.box.code === code);
        return { code: code, n: x ? x.total : 0, nS: x ? x.nS : 0, role: "target" };
      }).concat(source.map(x => ({ code: x.box.code, n: x.total, nS: x.nS, role: "source" }))),
      fill: changedTargets,
      source: source.map(x => x.box.code),
      assign: assign,
      used: changedTargets,
      freed: source.filter(x => x.total === x.nS).map(x => x.box.code),
      moved: assign.filter(a => a.moved).length,
      kept: assign.filter(a => !a.moved).length,
      studyTubes: withS.reduce((a, x) => a + x.nS, 0),
      studyBefore: withS.length,
      studyAfter: targets.length + mixedLeft,
      pureBoxes: pureAll.length,
      unchanged: pureAll.length - changedTargets.length,
      error: null,
    };
  }

  /* ---------- 入口 ---------- */
  function bestStudy(boxes, k, mode) {
    let best = null;
    boxesWithStudy(boxes).forEach(name => {
      const p = mode === "study" ? planStudyMerge(boxes, name) : planBoxMerge(boxes, name, k);
      if (p.error) return;
      const cut = p.studyBefore - p.studyAfter;
      const score = { study: name, cut: cut, moved: p.moved, tubes: p.studyTubes };
      if (!best
        || score.cut > best.score.cut
        || (score.cut === best.score.cut && score.moved < best.score.moved)
        || (score.cut === best.score.cut && score.moved === best.score.moved && score.tubes > best.score.tubes)) {
        best = { score: score, plan: p };
      }
    });
    return best;
  }

  function planMerge(boxes, opts) {
    const o = opts || {};
    const study = o.study || "";
    const k = o.k || 3;
    const mode = o.mode === "study" ? "study" : "box";
    if (!study && !o.auto) return { error: "請選擇 Study，或開啟自動選擇" };
    if (study) {
      const p = mode === "study" ? planStudyMerge(boxes, study) : planBoxMerge(boxes, study, k);
      return p.error ? { error: p.error } : { plan: p, auto: false };
    }
    const best = bestStudy(boxes, k, mode);
    if (!best) return { error: "這一櫃找不到適合整併的 Study" };
    return { plan: best.plan, auto: true };
  }

  /* 資料 → 盒（seed 版；系統分頁用自己的 store 版本） */
  function boxesFromSeed(SEED, cab, isOut) {
    const raw = ((SEED.boxes || {})[cab]) || {};
    const out = [];
    for (const code of Object.keys(raw).sort()) {
      const tubes = [];
      const byPos = raw[code];
      for (const pos of Object.keys(byPos)) {
        for (const e of byPos[pos]) {
          const sid = e[1];
          if ((e[4] || 0) !== 0) continue;          /* 未編號／區域不可搬動 */
          if (isOut && isOut(code, pos, sid)) continue;
          tubes.push({ sid: sid, study: SEED.studies[e[0]], vol: e[2], date: e[3], pos: pos });
        }
      }
      if (tubes.length) out.push({ code: code, tubes: tubes });
    }
    return out;
  }

  return {
    POS: POS, planMerge: planMerge, planBoxMerge: planBoxMerge, planStudyMerge: planStudyMerge,
    chooseRoles: chooseRoles, bestStudy: bestStudy, studyCounts: studyCounts,
    boxesFromSeed: boxesFromSeed, sidNum: sidNum,
  };
});
