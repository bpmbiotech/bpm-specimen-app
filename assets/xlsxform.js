/* 領取單 Excel（.xlsx）產生器
 * 不使用外部套件：自行組 OOXML + 最小 ZIP（store，無壓縮）
 * 產出的表格有實線格線、可列印、可在 Excel 編輯
 */
(function () {
  /* ---------- ZIP（store） ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);
      const cd = new Uint8Array(46 + name.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      central.push(cd);
      offset += lh.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]),
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- XML helpers ---------- */
  const xmlEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const COL = (i) => String.fromCharCode(65 + i); // A–H
  const cell = (v, ref, s) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  const cellNum = (ref, v, s) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const fmtWhen = (v) => (v || "").replace("T", " ").slice(0, 16);
  const fmtDate = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* ---------- 樣式 ---------- */
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Microsoft JhengHei"/><family val="2"/></font>
<font><b/><sz val="16"/><name val="Microsoft JhengHei"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Microsoft JhengHei"/><family val="2"/></font>
<font><sz val="10"/><name val="Microsoft JhengHei"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7F7F7"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`;

  /* ---------- 領取單 ---------- */
  function buildSheet(meta, items) {
    let qty = 0, vol = 0, anyVol = false;
    items.forEach(it => {
      qty += it.qty || 1;
      const v = parseFloat(it.vol);
      if (!isNaN(v)) { vol += v; anyVol = true; }
    });
    const totalVol = anyVol ? Math.round(vol * 10) / 10 : null;

    const rows = [];
    const merges = [];
    let r = 0; // 目前列號
    /* 每列都寫滿 A–H；合併範圍的每一格都套同樣樣式，格線才不會缺角 */
    const row8 = (styles, texts, ht) => {
      r++;
      const cells = [];
      for (let i = 0; i < 8; i++) {
        const t = texts && texts[i] != null ? texts[i] : "";
        cells.push(cell(t === "" ? " " : t, COL(i) + r, styles[i]));
      }
      rows.push({ r, cells, ht });
      return r;
    };
    const blank = (ht) => { r++; rows.push({ r, cells: [], ht: ht || 8 }); };

    // 標題
    row8(Array(8).fill(1), { 0: "檢體領取單" }, 34);
    merges.push("A1:H1");
    // 副標
    row8(Array(8).fill(9), { 0: "BPM檢體管理系統　｜　領取單號 " + meta.batch + "　｜　列印日期 " + fmtDate(new Date()) }, 18);
    merges.push("A2:H2");
    // 資料區
    row8([2, 3, 3, 2, 3, 3, 3, 3],
      { 0: "領取單號", 1: meta.batch, 3: "領取人", 4: meta.recipient || "" }, 26);
    merges.push("B3:C3", "E3:H3");
    row8([2, 3, 3, 2, 3, 3, 3, 3],
      { 0: "單位／聯絡", 1: meta.unit || "", 3: "領取時間", 4: fmtWhen(meta.pickupAt) }, 26);
    merges.push("B4:C4", "E4:H4");
    row8([2, 3, 3, 3, 3, 3, 3, 3], { 0: "目的", 1: meta.purpose || "" }, 26);
    merges.push("B5:H5");
    row8([2, 3, 3, 3, 3, 3, 3, 3], { 0: "備註", 1: meta.note || "" }, 26);
    merges.push("B6:H6");
    blank(10);
    // 表頭
    const head = ["#", "SID", "Study", "盒", "位置", "容量(mL)", "數量", "結果"];
    row8(Array(8).fill(4), head.reduce((o, v, i) => (o[i] = v, o), {}), 26);
    // 明細
    items.forEach((it, i) => {
      r++;
      const cells = [
        cell(String(i + 1), "A" + r, 6),
        cell(it.sid, "B" + r, 5),
        cell(it.study, "C" + r, 5),
        cell(it.box, "D" + r, 6),
        cell(it.pos, "E" + r, 6),
      ];
      const v = parseFloat(it.vol);
      cells.push(!isNaN(v) ? cellNum("F" + r, v, 6)
        : cell(it.vol == null || it.vol === "" ? " " : it.vol, "F" + r, 6));
      cells.push(cell(String(it.qty || 1), "G" + r, 6));
      cells.push(cell(it.res === "ok" ? "已領出" : "標記缺", "H" + r, 6));
      rows.push({ r, cells, ht: 22 });
    });
    // 合計
    r++;
    const totalCells = [0, 1, 2, 3, 4].map(i => cell(i === 0 ? "合計" : " ", COL(i) + r, 7));
    totalCells.push(totalVol == null ? cell("—", "F" + r, 8) : cellNum("F" + r, totalVol, 8));
    totalCells.push(cell(qty + " 支", "G" + r, 8));
    totalCells.push(cell(" ", "H" + r, 8));
    rows.push({ r, cells: totalCells, ht: 26 });
    merges.push("A" + r + ":E" + r);
    blank(18);
    // 簽收
    row8(Array(8).fill(9),
      { 0: "領取人簽收：＿＿＿＿＿＿＿＿＿　　經手人：＿＿＿＿＿＿＿＿＿　　日期：＿＿＿＿＿＿" }, 30);
    merges.push("A" + r + ":H" + r);
    // 註記
    row8(Array(8).fill(9),
      { 0: "本單由 BPM檢體管理系統產生（單號 " + meta.batch + "），可於「交易紀錄」重新下載。" }, 18);
    merges.push("A" + r + ":H" + r);
    const lastRow = r;

    const sheetData = rows.map(row => {
      const ht = row.ht ? ` ht="${row.ht}" customHeight="1"` : "";
      return `<row r="${row.r}"${ht}>${row.cells.join("")}</row>`;
    }).join("");

    const cols = [13, 17, 13, 11, 7, 11, 7, 10]
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");

    return {
      sheet: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:H${lastRow}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${cols}</cols>
<sheetData>${sheetData}</sheetData>
<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
<printOptions horizontalCentered="1"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`,
      lastRow,
    };
  }

  function workbookXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets><sheet name="領取單" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  }

  function pickupBlob(meta, items) {
    const { sheet } = buildSheet(meta, items);
    return zip([
      {
        name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      },
      { name: "xl/workbook.xml", data: workbookXml() },
      {
        name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
      },
      { name: "xl/styles.xml", data: STYLES },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
    ]);
  }

  function savePickup(meta, items) {
    const blob = pickupBlob(meta, items);
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `領取單_${meta.batch}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
  }

  window.XForm = { pickupBlob, savePickup, zip, crc32 };
})();
