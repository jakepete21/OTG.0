/****************************************************
 * CANCELED / MISSING — Runner-friendly (CM_RF1)
 *
 * Runner-friendly changes:
 * - Month is read from A1 of the sheet you run the runner from.
 * - Combined workbook is found dynamically in the Combined folder by "YYYY-MM"
 *   and picking the most recently updated match.
 * - Hardcoded IDs allowed/used:
 *    - Comp Key spreadsheet ID (source)
 *    - Disputes spreadsheet ID (destination)
 *    - Combined folder ID (where monthly combined files live)
 * - No hardcoded Combined spreadsheet ID.
 *
 * Behavior preserved from v9:
 * - Build matchSet by scanning carrier tabs and locating the column whose header
 *   is "OTG Comp Billing item" (NOT a fixed column).
 * - Routing:
 *   - ZMap if Comp Key col H contains "zmap"
 *   - Non-MRC Billing if Comp Key col W != "MRC" and non-blank
 *   - Else Canceled / Missing
 * - Non-MRC mapping: Invoice Total <- T, Expected <- U, Commission <- V
 * - Other mapping: Expected <- R, Commission <- S, Invoice Total blank
 * - Append-only; Non-MRC prevents re-adding by existing key in Column D.
 ****************************************************/

function CM_RF1_copyUnmatchedFromCompKey_ToCanceled_ZMap_NonMRC() {
    // ======= CONFIG =======
    const CM_RF1_SOURCE_SHEET_ID   = "10P1ACf1riryneD0zpZT6SRKqcnSHobfEVdAOE-cOPKo"; // Comp Key (hardcoded ok)
    const CM_RF1_SOURCE_SHEET_NAME = "NEW Comp Key";
  
    const CM_RF1_COMBINED_FOLDER_ID = "1fvJKGLOVyo4XJSi4sISvtLxH4YFYkNFk"; // Combined folder (hardcoded ok)
    const CM_RF1_MATCH_TAB_NAMES    = ["GoTo","MetTel","TBO","Lumen","Zayo","Allstream"];
    const CM_RF1_MATCH_KEY_HEADER   = "OTG Comp Billing item";
  
    const CM_RF1_OUTPUT_SHEET_ID    = "1DJgNesYSj1hQte64lEJ7UEevRSQlDZx1gNURZ9bwGI4"; // Disputes (hardcoded ok)
    const CM_RF1_TAB_CANCELED       = "Canceled / Missing";
    const CM_RF1_TAB_ZMAP           = "ZMap";
    const CM_RF1_TAB_NONMRC         = "Non-MRC Billing";
  
    // ======= COMP KEY HEADERS (with fallbacks) =======
    const HDR_KEY = "OTG Comp Billing item";
    const HDR_STATE_PRIMARY  = "ST";
    const HDR_STATE_FALLBACK = "State";
    const HDR_ACCOUNT_NAME   = "Account **CARRIER**";
    const HDR_ACCOUNT_NUMBER_CANDIDATES = [
      "Cust. \nACTIVE BAN",
      "Cust.\nACTIVE BAN",
      "Cust. ACTIVE BAN",
      "ACTIVE BAN",
      "Account Number",
      "Account #",
      "BAN"
    ];
    const HDR_PROVIDER = "Service Provider";
  
    // ======= COMP KEY FIXED COLUMN OFFSETS (0-based) =======
    const COL_H_IDX_0 = 7;    // H: ZMap flag
    const COL_M_IDX_0 = 12;   // M: Bill Description
  
    // Normal tabs
    const COL_R_IDX_0 = 17;   // R: Expected (normal)
    const COL_S_IDX_0 = 18;   // S: Commission (normal)
  
    // Non-MRC tab
    const COL_T_INVOICE_IDX_0  = 19; // T -> Invoice Total
    const COL_U_EXPECTED_IDX_0 = 20; // U -> Expected
    const COL_V_COMM_IDX_0     = 21; // V -> Commission
    const COL_W_TYPE_IDX_0     = 22; // W -> route if != "MRC"
    // =======================================================
  
    // --- Open Comp Key
    const sourceSS = SpreadsheetApp.openById(CM_RF1_SOURCE_SHEET_ID);
    const sourceSheet = sourceSS.getSheetByName(CM_RF1_SOURCE_SHEET_NAME);
    if (!sourceSheet) throw new Error("CM_RF1: Source sheet not found: " + CM_RF1_SOURCE_SHEET_NAME);
  
    const srcAll = sourceSheet.getDataRange().getValues();
    if (srcAll.length < 2) { Logger.log("CM_RF1: No data rows in Comp Key."); return; }
  
    const srcHdr  = srcAll[0].map(v => String(v || ""));
    const srcRows = srcAll.slice(1);
  
    const idxKey      = CM_RF1_exactHeaderIndex_(srcHdr, HDR_KEY);
    const idxState    = CM_RF1_findFirstHeaderIndex_(srcHdr, [HDR_STATE_PRIMARY, HDR_STATE_FALLBACK], "State (ST/State)");
    const idxAcctName = CM_RF1_exactHeaderIndex_(srcHdr, HDR_ACCOUNT_NAME);
    const idxAcctNum  = CM_RF1_findFirstHeaderIndex_(srcHdr, HDR_ACCOUNT_NUMBER_CANDIDATES, "Account Number (Cust. ACTIVE BAN / etc.)");
    const idxProvider = CM_RF1_exactHeaderIndex_(srcHdr, HDR_PROVIDER);
  
    // --- Resolve month & open Combined workbook (from folder; no sheet id)
    const targetMonth = CM_RF1_readTargetMonthFromA1_();
    const yearNum     = targetMonth.getFullYear();
    const monthNum    = targetMonth.getMonth() + 1;
    const ym = `${yearNum}-${String(monthNum).padStart(2, "0")}`;
  
    const combinedFile = CM_RF1_findCombinedByYearMonth_(CM_RF1_COMBINED_FOLDER_ID, yearNum, monthNum);
    if (!combinedFile) throw new Error(`CM_RF1: Could not find combined workbook for ${ym}.`);
    const combinedSS = SpreadsheetApp.openById(combinedFile.getId());
  
    // --- Build matchSet from carrier tabs by locating "OTG Comp Billing item" header
    const matchSet = CM_RF1_buildMatchSetFromCarrierTabs_(combinedSS, CM_RF1_MATCH_TAB_NAMES, CM_RF1_MATCH_KEY_HEADER);
  
    // --- Output headers
    const OUT_HEADERS = [
      "State",
      "Account Name",
      "Account Number",
      "OTG Comp Billing item",
      "EXPECTED/Mo. \nOTG Comp % \n - column R Comp Key",
      "Invoice Total",
      "Commission Amount\n - from Carrier Statement",
      "Provider",
      "Bill Description",
      "Bill/Invoice Period",
      "Date added to Disputes",
      "Associated Carrier Statement",
      "VP NOTES"
    ];
  
    const outputSS = SpreadsheetApp.openById(CM_RF1_OUTPUT_SHEET_ID);
    const zmapSh     = CM_RF1_getOrCreateSheetWithHeader_(outputSS, CM_RF1_TAB_ZMAP, OUT_HEADERS);
    const canceledSh = CM_RF1_getOrCreateSheetWithHeader_(outputSS, CM_RF1_TAB_CANCELED, OUT_HEADERS);
    const nonMrcSh   = CM_RF1_getOrCreateSheetWithHeader_(outputSS, CM_RF1_TAB_NONMRC, OUT_HEADERS);
  
    // --- Existing Non-MRC keys (Col D) to prevent re-adding
    const existingNonMrcKeys = new Set();
    const nmLastRow = nonMrcSh.getLastRow();
    if (nmLastRow > 1) {
      const nmKeys = nonMrcSh.getRange(2, 4, nmLastRow - 1, 1).getValues(); // D
      for (const [v] of nmKeys) {
        const k = String(v || "").trim();
        if (k) existingNonMrcKeys.add(k);
      }
    }
  
    const toCanceled = [];
    const toZmap     = [];
    const toNonMrc   = [];
  
    for (let i = 0; i < srcRows.length; i++) {
      const r = srcRows[i];
  
      const keyVal = String(r[idxKey] || "").trim();
      if (!keyVal) continue;
  
      // ✅ Match check against carrier tabs’ OTG Comp Billing item column
      if (matchSet.has(keyVal)) continue;
  
      const state    = String(r[idxState] || "").trim();
      const acctName = r[idxAcctName] || "";
      const acctNum  = r[idxAcctNum] || "";
      const provider = r[idxProvider] || "";
      const billDesc = (r.length > COL_M_IDX_0) ? (r[COL_M_IDX_0] ?? "") : "";
  
      const hVal = String(r[COL_H_IDX_0] || "").toLowerCase();
      const wVal = String(r[COL_W_TYPE_IDX_0] || "").trim();
      const isNonMrc = wVal && String(wVal).toUpperCase() !== "MRC";
  
      if (hVal.includes("zmap")) {
        const expectedPct = (r.length > COL_R_IDX_0) ? (r[COL_R_IDX_0] ?? "") : "";
        const commAmt     = (r.length > COL_S_IDX_0) ? (r[COL_S_IDX_0] ?? "") : "";
        toZmap.push(CM_RF1_buildOutRow_({ state, acctName, acctNum, keyVal, expectedPct, invoiceTotal:"", commAmt, provider, billDesc }));
  
      } else if (isNonMrc) {
        if (existingNonMrcKeys.has(keyVal)) continue;
  
        const invoiceTotal = (r.length > COL_T_INVOICE_IDX_0)  ? (r[COL_T_INVOICE_IDX_0]  ?? "") : "";
        const expectedPct  = (r.length > COL_U_EXPECTED_IDX_0) ? (r[COL_U_EXPECTED_IDX_0] ?? "") : "";
        const commAmt      = (r.length > COL_V_COMM_IDX_0)     ? (r[COL_V_COMM_IDX_0]     ?? "") : "";
  
        toNonMrc.push(CM_RF1_buildOutRow_({ state, acctName, acctNum, keyVal, expectedPct, invoiceTotal, commAmt, provider, billDesc }));
        existingNonMrcKeys.add(keyVal);
  
      } else {
        const expectedPct = (r.length > COL_R_IDX_0) ? (r[COL_R_IDX_0] ?? "") : "";
        const commAmt     = (r.length > COL_S_IDX_0) ? (r[COL_S_IDX_0] ?? "") : "";
        toCanceled.push(CM_RF1_buildOutRow_({ state, acctName, acctNum, keyVal, expectedPct, invoiceTotal:"", commAmt, provider, billDesc }));
      }
    }
  
    const now = new Date();
    if (toZmap.length)     CM_RF1_appendRows_(zmapSh,     toZmap.map(r => CM_RF1_setDateK_(r, now)));
    if (toNonMrc.length)   CM_RF1_appendRows_(nonMrcSh,   toNonMrc.map(r => CM_RF1_setDateK_(r, now)));
    if (toCanceled.length) CM_RF1_appendRows_(canceledSh, toCanceled.map(r => CM_RF1_setDateK_(r, now)));
  
    CM_RF1_formatMoneyCols_(zmapSh);
    CM_RF1_formatMoneyCols_(nonMrcSh);
    CM_RF1_formatMoneyCols_(canceledSh);
  
    Logger.log(`CM_RF1: Unmatched → ZMap: ${toZmap.length}, Non-MRC Billing: ${toNonMrc.length} (new only), Canceled/Missing: ${toCanceled.length}`);
  }
  
  
  
  // ======================= HELPERS =======================
  
  function CM_RF1_buildMatchSetFromCarrierTabs_(ss, tabNames, keyHeader) {
    const matchSet = new Set();
    const want = String(keyHeader || "").trim().toLowerCase();
  
    tabNames.forEach(name => {
      const sh = ss.getSheetByName(name);
      if (!sh) return;
  
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow < 2 || lastCol < 1) return;
  
      const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
      const idx0 = header.findIndex(h => String(h || "").trim().toLowerCase() === want);
      if (idx0 === -1) {
        Logger.log(`CM_RF1 MATCH: Tab "${name}" missing header "${keyHeader}" — skipping tab.`);
        return;
      }
  
      const vals = sh.getRange(2, idx0 + 1, lastRow - 1, 1).getValues();
      vals.forEach(([v]) => {
        const k = String(v || "").trim();
        if (k) matchSet.add(k);
      });
    });
  
    return matchSet;
  }
  
  function CM_RF1_buildOutRow_(o) {
    return [
      o.state || "",
      o.acctName || "",
      o.acctNum || "",
      o.keyVal || "",
      o.expectedPct ?? "",
      o.invoiceTotal ?? "",
      o.commAmt ?? "",
      o.provider || "",
      o.billDesc ?? "",
      "",     // Bill/Invoice Period
      null,   // Date added
      "",     // Associated Carrier Statement
      ""      // VP NOTES
    ];
  }
  
  function CM_RF1_setDateK_(row, dateObj) {
    const out = row.slice();
    out[10] = dateObj; // K
    return out;
  }
  
  function CM_RF1_findCombinedByYearMonth_(folderId, year, month) {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
  
    const candidates = [];
    while (files.hasNext()) {
      const f = files.next();
      if (f.getMimeType && f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
      const name = String(f.getName ? f.getName() : "");
      if (name.includes(ym)) candidates.push({ file: f, edited: f.getLastUpdated ? f.getLastUpdated().getTime() : 0 });
    }
    if (!candidates.length) return null;
    candidates.sort((a,b) => b.edited - a.edited);
    return candidates[0].file;
  }
  
  function CM_RF1_exactHeaderIndex_(headerRow, wantedHeader) {
    for (let i = 0; i < headerRow.length; i++) {
      if (String(headerRow[i] || "").trim() === String(wantedHeader || "").trim()) return i;
    }
    throw new Error(`CM_RF1: Required header not found exactly: "${wantedHeader}"`);
  }
  
  function CM_RF1_findFirstHeaderIndex_(headerRow, candidates, labelForError) {
    const wantList = candidates.map(s => String(s || ""));
    for (let i = 0; i < headerRow.length; i++) {
      const h = String(headerRow[i] || "");
      for (let j = 0; j < wantList.length; j++) {
        if (String(h).trim() === String(wantList[j]).trim()) return i;
      }
    }
    throw new Error(`CM_RF1: Required header not found: ${labelForError}. Tried: ${wantList.join(" | ")}`);
  }
  
  function CM_RF1_getOrCreateSheetWithHeader_(ss, name, header) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
  
    const needHdr =
      sh.getLastRow() === 0 ||
      sh.getRange(1, 1, 1, header.length).getValues()[0]
        .slice(0, header.length)
        .some((v, i) => String(v || "") !== String(header[i]));
  
    if (needHdr) {
      sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
    return sh;
  }
  
  function CM_RF1_appendRows_(sh, rows) {
    if (!rows.length) return;
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  }
  
  function CM_RF1_formatMoneyCols_(sh) {
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;
    const numRows = lastRow - 1;
    sh.getRange(2, 6, numRows, 1).setNumberFormat("$#,##0.00"); // Invoice Total
    sh.getRange(2, 7, numRows, 1).setNumberFormat("$#,##0.00"); // Commission Amount
    sh.getRange(2, 11, numRows, 1).setNumberFormat("M/d/yyyy"); // Date added
  }
  
  function CM_RF1_readTargetMonthFromA1_() {
    const sh = SpreadsheetApp.getActiveSheet();
    const raw = String(sh.getRange("A1").getDisplayValue() || "").trim();
    if (!raw) throw new Error('CM_RF1: A1 is blank; enter e.g. "October" or "October 2025".');
  
    const today = new Date();
    const currentYear = today.getFullYear();
  
    let m = raw.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
    if (m) {
      const mm = CM_RF1_monthNameToIndex_(m[1]);
      let y = parseInt(m[2], 10); if (y < 100) y += 2000;
      return new Date(y, mm, 1);
    }
    m = raw.match(/^([A-Za-z]+)$/i);
    if (m) return new Date(currentYear, CM_RF1_monthNameToIndex_(m[1]), 1);
  
    m = raw.match(/^(\d{1,2})[-\/](\d{4})$/);
    if (m) return new Date(parseInt(m[2], 10), Math.max(1, Math.min(12, parseInt(m[1], 10))) - 1, 1);
  
    m = raw.match(/^(\d{4})[-\/](\d{1,2})$/);
    if (m) return new Date(parseInt(m[1], 10), Math.max(1, Math.min(12, parseInt(m[2], 10))) - 1, 1);
  
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);
  
    throw new Error('CM_RF1: Could not parse month from A1: "' + raw + '". Try "October", "October 2025", or "10/2025".');
  }
  
  function CM_RF1_monthNameToIndex_(name) {
    const n = String(name || "").toLowerCase().slice(0, 3);
    const map = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    if (!(n in map)) throw new Error("CM_RF1: Unknown month name: " + name);
    return map[n];
  }
  