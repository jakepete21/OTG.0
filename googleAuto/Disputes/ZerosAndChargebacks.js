/****************************************************
 * ZEROS + CHARGEBACKS — Runner-friendly (ZC_RF1)
 *
 * Runner-friendly changes:
 * - Reads target month from A1 of the sheet you run from.
 * - Finds the monthly Combined workbook by searching the COMBINED FOLDER for "YYYY-MM"
 *   and picking the most recently updated match.
 * - Writes to the Disputes workbook (hardcoded) on tabs: "Zeros" + "Chargebacks".
 * - Keeps the “real statement link” logic:
 *    - Use "Carrier Statement" (preferred) or "Provider" as hint
 *    - Find MOST RECENT matching file in STATEMENTS folder
 *    - If not found, fall back to the Combined workbook link
 * - Append-only. Dedupe ONLY against rows already added TODAY.
 *
 * FIX (Jan 2026):
 * - Zeros are detected by "rounds to $0.00" at cent precision, not strict numeric === 0.
 *   This catches tiny values like 0.004 that display as "$0.00".
 ****************************************************/


// ===================== CONFIG (YOU EDIT) =====================

// Actual provider statement files live here
const ZC_RF1_STATEMENTS_FOLDER_ID     = "1JJRszMqel6kWL8CeoVKBCclROSoDfzw_";

// Combined monthly spreadsheets live here (the monthly combined workbooks)
const ZC_RF1_COMBINED_FOLDER_ID       = "1fvJKGLOVyo4XJSi4sISvtLxH4YFYkNFk";
const ZC_RF1_SOURCE_MATCHES_SHEET     = "Matches";

// Destination workbook + tabs (Disputes workbook)
const ZC_RF1_TARGET_SHEET_ID          = "1DJgNesYSj1hQte64lEJ7UEevRSQlDZx1gNURZ9bwGI4";
const ZC_RF1_ZEROS_SHEET_NAME         = "Zeros";
const ZC_RF1_CHARGEBACKS_SHEET_NAME   = "Chargebacks";

// Comp Key lookup (Expected % from column R)
const ZC_RF1_COMP_KEY_SHEET_ID        = "10P1ACf1riryneD0zpZT6SRKqcnSHobfEVdAOE-cOPKo";
const ZC_RF1_COMP_KEY_TAB_NAME        = "NEW Comp Key";
const ZC_RF1_COMP_KEY_ITEM_HEADER     = "OTG Comp Billing item";
const ZC_RF1_COMP_KEY_COL_R_INDEX1    = 18; // Column R (1-based)

// Guardrails: statement files must include at least one of these words
const ZC_RF1_STATEMENT_REQUIRED_WORDS = ["statement", "carrier statement", "remittance", "compensation"];

// Zero detection tolerance (cent rounding threshold)
const ZC_RF1_ZERO_TOLERANCE = 0.005; // anything with abs(value) < 0.005 displays as $0.00 at 2 decimals

// =============================================================


// ===================== ENTRYPOINT (RUNNER CALLS THIS) =====================

function ZC_RF1_separateChargebacksAndZerosForSelectedMonth() {
  // 1) Resolve month & token
  const targetMonth = ZC_RF1_readTargetMonthFromA1_();
  const yearNum     = targetMonth.getFullYear();
  const monthNum    = targetMonth.getMonth() + 1;
  const yyyyMm      = `${yearNum}-${String(monthNum).padStart(2, "0")}`;

  // 2) Find combined spreadsheet in the COMBINED folder
  const srcFile = ZC_RF1_findCombinedByYearMonth_(ZC_RF1_COMBINED_FOLDER_ID, yearNum, monthNum);
  if (!srcFile) throw new Error(`ZC_RF1: Could not find a combined spreadsheet for ${yyyyMm} in combined folder.`);
  const combinedUrl  = srcFile.getUrl();
  const combinedName = srcFile.getName();

  // 3) Read Matches
  const sourceSS    = SpreadsheetApp.openById(srcFile.getId());
  const sourceSheet = sourceSS.getSheetByName(ZC_RF1_SOURCE_MATCHES_SHEET);
  if (!sourceSheet) throw new Error(`ZC_RF1: Source sheet not found: "${ZC_RF1_SOURCE_MATCHES_SHEET}" in file "${srcFile.getName()}"`);

  const data = sourceSheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log("ZC_RF1: No data rows in source."); return; }

  const header = data[0].map(h => String(h || "").trim());
  const rows   = data.slice(1);

  // 4) Column indices (header-driven w/ fallbacks)
  const idxState     = ZC_RF1_findHeaderIndexExact_(header, ["State"], true);

  const idxAcctName  = ZC_RF1_findHeaderIndexExact_(header, ["Account Name", "Name", "Customer Account"]);
  const idxAcctNum   = ZC_RF1_findHeaderIndexExact_(header, ["Account Number", "BAN", "Billing Account Number"], true);

  const idxOtgItem   = ZC_RF1_findHeaderIndexExact_(header, ["OTG Comp Billing item", "Service Number"], false);

  const idxInvTotal  = ZC_RF1_findHeaderIndexExact_(header, ["Invoice Total"], true);
  const idxCommAmt   = ZC_RF1_findHeaderIndexExact_(header, ["Commission Amount", "Commission Amount (USD)"], true);

  const idxProvider  = ZC_RF1_findHeaderIndexExact_(header, ["Provider"], true);
  const idxCarrierStatementHint = ZC_RF1_findHeaderIndexExact_(header, ["Carrier Statement"], true);

  const idxBillDesc  = ZC_RF1_findHeaderIndexExact_(header, ["Bill Description"], true);
  const idxBillPer   = ZC_RF1_findHeaderIndexExact_(header, ["Bill/Invoice Period", "Reporting Period"], true);

  if (idxAcctName == null || idxOtgItem == null) {
    throw new Error("ZC_RF1: Matches sheet missing required headers for Account Name / OTG item. Found: " + header.join(" | "));
  }

  // 5) Load Expected from Comp Key col R
  const expectedByItemNorm = ZC_RF1_loadExpectedFromCompKey_();

  // 6) Partition rows (zeros + chargebacks bucket)
  const zeroRowsRaw = [];
  const chargebackItemNormSet = new Set();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const otgItemRaw = String(r[idxOtgItem] || "").trim();
    if (!otgItemRaw) continue;
    const itemNorm = ZC_RF1_normalizeKey_(otgItemRaw);

    const commNum = (idxCommAmt != null) ? ZC_RF1_parseMoney_(r[idxCommAmt]) : null;

    // ✅ UPDATED ZERO LOGIC: treat values that round to $0.00 as zero
    if (commNum != null && Math.abs(commNum) < ZC_RF1_ZERO_TOLERANCE) {
      zeroRowsRaw.push(r);
    }

    if (commNum != null && commNum < 0) chargebackItemNormSet.add(itemNorm);
  }

  // Collect chargeback rows: any OTG item that has a negative commission anywhere in the month
  const chargebackRowsRaw = [];
  const seenRunChargebacks = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const otgItemRaw = String(r[idxOtgItem] || "").trim();
    if (!otgItemRaw) continue;

    const itemNorm = ZC_RF1_normalizeKey_(otgItemRaw);
    if (!chargebackItemNormSet.has(itemNorm)) continue;

    const sig = ZC_RF1_sourceRowSignature_(r, {
      idxState, idxAcctName, idxAcctNum, idxOtgItem, idxInvTotal, idxCommAmt,
      idxProvider, idxCarrierStatementHint, idxBillDesc, idxBillPer
    });

    if (!seenRunChargebacks.has(sig)) {
      chargebackRowsRaw.push(r);
      seenRunChargebacks.add(sig);
    }
  }

  // 7) Preload statement folder file index for fast matching
  const statementIndex = ZC_RF1_buildStatementFolderIndex_(ZC_RF1_STATEMENTS_FOLDER_ID);

  // 8) Destination headers
  const destHeaders = [
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

  const tz = Session.getScriptTimeZone();
  const today = new Date();
  const todayKey = Utilities.formatDate(today, tz, "yyyy-MM-dd");

  // 9) Build + append output rows
  if (zeroRowsRaw.length) {
    const outZeros = zeroRowsRaw.map(r => {
      const providerVal = (idxProvider != null) ? String(r[idxProvider] || "").trim() : "";
      const hintVal = (idxCarrierStatementHint != null) ? String(r[idxCarrierStatementHint] || "").trim() : "";
      const hint = hintVal || providerVal;

      const stmtFile = ZC_RF1_findBestStatementFileForHint_(statementIndex, hint);
      const url  = stmtFile ? stmtFile.url : combinedUrl;
      const text = stmtFile ? stmtFile.name : combinedName;

      return ZC_RF1_buildDestRowFromSource_(
        r,
        { idxState, idxAcctName, idxAcctNum, idxOtgItem, idxInvTotal, idxCommAmt, idxProvider, idxBillDesc, idxBillPer },
        expectedByItemNorm,
        today,
        ZC_RF1_makeHyperlinkFormula_(url, text),
        providerVal || hintVal
      );
    });

    ZC_RF1_appendToSheetTodayDedupe_(
      ZC_RF1_TARGET_SHEET_ID,
      ZC_RF1_ZEROS_SHEET_NAME,
      destHeaders,
      outZeros,
      todayKey
    );
  }

  if (chargebackRowsRaw.length) {
    const outChargebacks = chargebackRowsRaw.map(r => {
      const providerVal = (idxProvider != null) ? String(r[idxProvider] || "").trim() : "";
      const hintVal = (idxCarrierStatementHint != null) ? String(r[idxCarrierStatementHint] || "").trim() : "";
      const hint = hintVal || providerVal;

      const stmtFile = ZC_RF1_findBestStatementFileForHint_(statementIndex, hint);
      const url  = stmtFile ? stmtFile.url : combinedUrl;
      const text = stmtFile ? stmtFile.name : combinedName;

      return ZC_RF1_buildDestRowFromSource_(
        r,
        { idxState, idxAcctName, idxAcctNum, idxOtgItem, idxInvTotal, idxCommAmt, idxProvider, idxBillDesc, idxBillPer },
        expectedByItemNorm,
        today,
        ZC_RF1_makeHyperlinkFormula_(url, text),
        providerVal || hintVal
      );
    });

    ZC_RF1_appendToSheetTodayDedupe_(
      ZC_RF1_TARGET_SHEET_ID,
      ZC_RF1_CHARGEBACKS_SHEET_NAME,
      destHeaders,
      outChargebacks,
      todayKey
    );
  }

  Logger.log(`ZC_RF1: Done (${yyyyMm}). Appended — Zeros: ${zeroRowsRaw.length}, Chargebacks: ${chargebackRowsRaw.length}`);
}



// ======================= STATEMENT FOLDER INDEX + MATCH =======================

function ZC_RF1_buildStatementFolderIndex_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const it = folder.getFiles();

  const requiredWords = (ZC_RF1_STATEMENT_REQUIRED_WORDS || [])
    .map(w => String(w).toLowerCase())
    .filter(Boolean);

  const index = []; // [{name,lname,url,ts}]
  while (it.hasNext()) {
    const f = it.next();
    const name = String(f.getName() || "");
    const lname = name.toLowerCase();

    // avoid "combined" sheets/docs
    if (lname.includes("combined")) continue;

    // require statement-ish term (helps avoid random docs)
    if (requiredWords.length) {
      let ok = false;
      for (const w of requiredWords) {
        if (lname.includes(w)) { ok = true; break; }
      }
      if (!ok) continue;
    }

    const ts = f.getLastUpdated ? f.getLastUpdated().getTime() : 0;
    index.push({ name, lname, url: f.getUrl(), ts });
  }
  return index;
}

/**
 * Uses the row’s Carrier Statement text as the matching hint.
 * We do "contains all meaningful tokens" matching and pick MOST RECENT.
 */
function ZC_RF1_findBestStatementFileForHint_(index, hintRaw) {
  const hint = String(hintRaw || "").trim();
  if (!hint) return null;

  const tokens = ZC_RF1_hintTokens_(hint);
  if (!tokens.length) return null;

  let best = null;
  for (const f of index) {
    // must include ALL tokens
    let ok = true;
    for (const t of tokens) {
      if (!f.lname.includes(t)) { ok = false; break; }
    }
    if (!ok) continue;

    // pick most recent
    if (!best || f.ts > best.ts) best = f;
  }
  return best;
}

function ZC_RF1_hintTokens_(hint) {
  const s = String(hint || "").toLowerCase();
  const cleaned = s.replace(/[^a-z0-9]+/g, " ").trim();
  if (!cleaned) return [];

  const stop = new Set(["and","or","the","a","an","of","to","for","in","on","at","with"]);
  const rawTokens = cleaned.split(/\s+/).filter(Boolean).filter(t => !stop.has(t));

  // keep tokens >= 3 chars, but keep "l3"
  return Array.from(new Set(rawTokens.filter(t => t.length >= 3 || t === "l3")));
}



// ======================= BUILD DEST ROW =======================

function ZC_RF1_buildDestRowFromSource_(r, idx, expectedMap, todayDateObj, linkFormula, providerOut) {
  const state = (idx.idxState != null) ? String(r[idx.idxState] || "").trim() : "";

  const acctName = String(r[idx.idxAcctName] || "").trim();
  const acctNum  = (idx.idxAcctNum != null) ? String(r[idx.idxAcctNum] || "").trim() : "";

  const otgItemRaw  = String(r[idx.idxOtgItem] || "").trim();
  const otgItemNorm = ZC_RF1_normalizeKey_(otgItemRaw);

  const expectedVal = expectedMap.get(otgItemNorm) || "";

  const invoiceTotal = (idx.idxInvTotal != null) ? ZC_RF1_parseMoney_(r[idx.idxInvTotal]) : null;
  const commAmt      = (idx.idxCommAmt != null)  ? ZC_RF1_parseMoney_(r[idx.idxCommAmt])  : null;

  const billDesc = (idx.idxBillDesc != null) ? (r[idx.idxBillDesc] || "") : "";
  const billPer  = (idx.idxBillPer != null)  ? (r[idx.idxBillPer] || "")  : "";

  return [
    state,                // A
    acctName,             // B
    acctNum,              // C
    otgItemRaw,           // D
    expectedVal,          // E
    invoiceTotal ?? "",   // F
    commAmt ?? "",        // G
    providerOut || "",    // H
    billDesc,             // I
    billPer,              // J
    todayDateObj,         // K
    linkFormula,          // L
    ""                    // M
  ];
}



// ======================= APPEND (TODAY DEDUPE, APPEND ONLY) =======================

function ZC_RF1_appendToSheetTodayDedupe_(targetSpreadsheetId, sheetName, headers, rows, todayKeyYYYYMMDD) {
  const tSS = SpreadsheetApp.openById(targetSpreadsheetId);
  let tSheet = tSS.getSheetByName(sheetName);
  if (!tSheet) tSheet = tSS.insertSheet(sheetName);

  // only set header if empty
  if (tSheet.getLastRow() === 0) {
    tSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    tSheet.setFrozenRows(1);
  }

  // existing today sigs (dedupe only within "today")
  const existingTodaySigs = new Set();
  const lastRow = tSheet.getLastRow();
  if (lastRow >= 2) {
    const lastCol = Math.max(tSheet.getLastColumn(), headers.length);
    const existingVals = tSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (let i = 0; i < existingVals.length; i++) {
      const r = existingVals[i];
      const dateCell = r[10]; // K
      const key = ZC_RF1_ymdKey_(dateCell);
      if (key === todayKeyYYYYMMDD) {
        const sig = ZC_RF1_destRowSignature_(r.slice(0, 13));
        if (sig) existingTodaySigs.add(sig);
      }
    }
  }

  const toAppend = rows.filter(r => !existingTodaySigs.has(ZC_RF1_destRowSignature_(r)));
  if (!toAppend.length) { Logger.log(`ZC_RF1: Nothing new to append to "${sheetName}".`); return; }

  const startRow = tSheet.getLastRow() + 1;
  tSheet.getRange(startRow, 1, toAppend.length, headers.length).setValues(toAppend);

  // money + date formats
  tSheet.getRange(startRow, 6, toAppend.length, 1).setNumberFormat("$#,##0.00"); // F
  tSheet.getRange(startRow, 7, toAppend.length, 1).setNumberFormat("$#,##0.00"); // G
  tSheet.getRange(startRow, 11, toAppend.length, 1).setNumberFormat("M/d/yyyy"); // K
}

function ZC_RF1_destRowSignature_(destRow) {
  const aToJ = destRow.slice(0, 10).map(v => String(v ?? "").trim());
  aToJ[3] = ZC_RF1_normalizeKey_(aToJ[3]); // OTG item normalize
  return aToJ.join("|");
}

function ZC_RF1_sourceRowSignature_(r, idx) {
  const state = (idx.idxState != null) ? String(r[idx.idxState] || "").trim() : "";
  const acctName = String(r[idx.idxAcctName] || "").trim();
  const acctNum  = (idx.idxAcctNum != null) ? String(r[idx.idxAcctNum] || "").trim() : "";
  const itemRaw  = String(r[idx.idxOtgItem] || "").trim();

  const inv = (idx.idxInvTotal != null) ? String(ZC_RF1_parseMoney_(r[idx.idxInvTotal]) ?? "") : "";
  const com = (idx.idxCommAmt != null)  ? String(ZC_RF1_parseMoney_(r[idx.idxCommAmt]) ?? "")  : "";

  const prov = (idx.idxProvider != null) ? String(r[idx.idxProvider] || "").trim() : "";
  const stmt = (idx.idxCarrierStatementHint != null) ? String(r[idx.idxCarrierStatementHint] || "").trim() : "";

  const bd   = (idx.idxBillDesc != null) ? String(r[idx.idxBillDesc] || "").trim() : "";
  const bp   = (idx.idxBillPer != null)  ? String(r[idx.idxBillPer] || "").trim()  : "";

  return [
    state, acctName, acctNum,
    ZC_RF1_normalizeKey_(itemRaw),
    inv, com,
    (stmt || prov).toUpperCase(),
    bd, bp
  ].join("|");
}



// ======================= COMP KEY LOOKUP (COL R) =======================

function ZC_RF1_loadExpectedFromCompKey_() {
  const ss = SpreadsheetApp.openById(ZC_RF1_COMP_KEY_SHEET_ID);
  const sh = ss.getSheetByName(ZC_RF1_COMP_KEY_TAB_NAME);
  if (!sh) throw new Error("ZC_RF1: Missing Comp Key tab: " + ZC_RF1_COMP_KEY_TAB_NAME);

  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(h => String(h || "").trim());

  const itemColIdx0 = ZC_RF1_findPinnedHeaderIndex_(header, ZC_RF1_COMP_KEY_ITEM_HEADER);
  if (itemColIdx0 === -1) {
    throw new Error(`ZC_RF1: Could not find Comp Key column "${ZC_RF1_COMP_KEY_ITEM_HEADER}". Found: ${header.join(" | ")}`);
  }

  const expectedColIdx0 = ZC_RF1_COMP_KEY_COL_R_INDEX1 - 1;
  if (expectedColIdx0 < 0 || expectedColIdx0 >= header.length) {
    Logger.log("ZC_RF1: WARNING: Comp Key col R out of range; EXPECTED values will be blank.");
    return new Map();
  }

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return new Map();

  const vals = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  const map = new Map();

  for (let i = 0; i < vals.length; i++) {
    const row = vals[i];
    const itemRaw = String(row[itemColIdx0] || "").trim();
    if (!itemRaw) continue;

    const expected = row[expectedColIdx0];
    const expectedTxt = String(expected ?? "").trim();
    if (!expectedTxt) continue;

    map.set(ZC_RF1_normalizeKey_(itemRaw), expectedTxt);
  }

  return map;
}



// ======================= COMBINED FILE FINDER =======================

function ZC_RF1_findCombinedByYearMonth_(folderId, year, month) {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();

  const candidates = [];
  while (files.hasNext()) {
    const f = files.next();
    if (f.getMimeType && f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    const name = String(f.getName() || "");
    if (name.includes(ym)) {
      candidates.push({ file: f, ts: f.getLastUpdated ? f.getLastUpdated().getTime() : 0 });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.ts - a.ts);
  return candidates[0].file;
}



// ======================= MONTH FROM A1 =======================

function ZC_RF1_readTargetMonthFromA1_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const raw = String(sh.getRange("A1").getDisplayValue() || "").trim();
  if (!raw) throw new Error('ZC_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');

  const today = new Date();
  const currentYear = today.getFullYear();

  let m = raw.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const mm = ZC_RF1_monthNameToIndex_(m[1]);
    let y = parseInt(m[2], 10); if (y < 100) y += 2000;
    return new Date(y, mm, 1);
  }

  m = raw.match(/^([A-Za-z]+)$/);
  if (m) return new Date(currentYear, ZC_RF1_monthNameToIndex_(m[1]), 1);

  m = raw.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);

  const d = new Date(raw);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);

  throw new Error('ZC_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');
}

function ZC_RF1_monthNameToIndex_(name) {
  const n = String(name || "").toLowerCase().slice(0, 3);
  const map = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  if (!(n in map)) throw new Error("ZC_RF1: Unknown month name: " + name);
  return map[n];
}



// ======================= GENERIC HELPERS =======================

function ZC_RF1_findHeaderIndexExact_(headerRow, names, optional) {
  const norm = s => String(s||"")
    .replace(/[\u00A0\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const H = headerRow.map(norm);
  for (const name of names) {
    const target = norm(name);
    const idx = H.indexOf(target);
    if (idx !== -1) return idx;
  }
  return optional ? null : null;
}

function ZC_RF1_findPinnedHeaderIndex_(headerRow, wantedHeader) {
  const want = String(wantedHeader || "").trim().toLowerCase();
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || "").trim().toLowerCase();
    if (h === want || h.startsWith(want)) return i;
  }
  return -1;
}

function ZC_RF1_normalizeKey_(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[\u00A0\u200B]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function ZC_RF1_parseMoney_(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;

  const s0 = String(v).trim();
  if (!s0) return null;

  let neg = false;
  let s = s0;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/\$/g, "")
       .replace(/,/g, "")
       .replace(/\s+/g, "")
       .replace(/[^\d.\-]/g, "");

  if (!s) return null;

  const n = parseFloat(s);
  if (isNaN(n)) return null;

  return neg ? -Math.abs(n) : n;
}

function ZC_RF1_makeHyperlinkFormula_(url, text) {
  const safeText = String(text).replace(/"/g, '""');
  const safeUrl  = String(url).replace(/"/g, '""');
  return `=HYPERLINK("${safeUrl}","${safeText}")`;
}

function ZC_RF1_ymdKey_(d) {
  const dd = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dd.getTime())) return "";
  return Utilities.formatDate(dd, Session.getScriptTimeZone(), "yyyy-MM-dd");
}
