
/****************************************************
 * Months Held PAID ALL — Runner-friendly (ZMHP_RF1)
 *
 * Runner-friendly changes:
 * - NO December-only.
 * - Reads target month from A1 (like your master runner).
 * - Applies Zayo offset (-2 months) to pick the correct Zayo statement file.
 * - Emits ONE output row per month token from "Months" (col F),
 *   EXCEPT it skips the lag month token itself (same as your Dec-only version).
 * - Appends to "Months Held Paid ALL"
 * - Dedupe: ignores last col (hyperlink) when checking duplicates (same as original).
 *
 * Entry point for your master runner:
 *   ZMHP_RF1_copyMonthsHeldPaid_ALL();
 ****************************************************/

// ======= CONFIG =======
const ZMHP_RF1_CARRIER_FOLDER_ID = "1JJRszMqel6kWL8CeoVKBCclROSoDfzw_";
const ZMHP_RF1_TARGET_SHEET_ID   = "1DJgNesYSj1hQte64lEJ7UEevRSQlDZx1gNURZ9bwGI4";
const ZMHP_RF1_TARGET_SHEET_NAME = "Months Held Paid ALL";
const ZMHP_RF1_ZAYO_OFFSET_MONTHS = 2;
// ======================

const ZMHP_RF1_HEADERS = [
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

function ZMHP_RF1_copyMonthsHeldPaid_ALL() {
  const tz = Session.getScriptTimeZone();

  // Month selection (runner-friendly)
  const selectedMonth = ZMHP_RF1_readTargetMonthFromA1_(); // normalized to 1st

  // Zayo lag month (selected -> minus offset)
  const zayoMonth   = ZMHP_RF1_shiftMonth_(selectedMonth, -ZMHP_RF1_ZAYO_OFFSET_MONTHS);
  const yyyyMm      = ZMHP_RF1_formatYYYYMM_(zayoMonth);
  const lagToken    = ZMHP_RF1_formatMonthYearToken_(zayoMonth); // skip this token in output

  // Find Zayo statement file for lag month
  const zayoFile = ZMHP_RF1_findZayoFileForMonth_(ZMHP_RF1_CARRIER_FOLDER_ID, yyyyMm);
  if (!zayoFile) throw new Error(`ZMHP_RF1: Could not find Zayo file for ${yyyyMm} in folder.`);

  // Hyperlink to statement (same for all rows from this run)
  const fixedLinkFormula = ZMHP_RF1_makeHyperlinkFormula_(zayoFile.getUrl(), zayoFile.getName());

  // Open Collection of Commissions
  const sourceSS    = SpreadsheetApp.openById(zayoFile.getId());
  const sourceSheet = sourceSS.getSheetByName("Collection of Commissions");
  if (!sourceSheet) throw new Error(`ZMHP_RF1: Missing "Collection of Commissions" in ${zayoFile.getName()}.`);

  const lastRow = sourceSheet.getLastRow();
  const lastCol = sourceSheet.getLastColumn();
  if (lastRow < 2) {
    Logger.log("ZMHP_RF1: No rows to process.");
    return;
  }

  const header = sourceSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
  const data   = sourceSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Optional indices if present
  const idxState      = ZMHP_RF1_findHeaderIndexCI_(header, ["State", "ST"], true);
  const idxBillDesc   = ZMHP_RF1_findHeaderIndexCI_(header, ["Bill Description"], true);
  const idxBillPeriod = (function () {
    const byHdr = ZMHP_RF1_findHeaderIndexCI_(header, ["Bill/Invoice Period", "Bill Invoice Period", "Invoice Period"], true);
    if (byHdr != null) return byHdr;
    return (lastCol > 13) ? 13 : null; // fallback: N
  })();

  // Fixed indices (0-based)
  const IDX = {
    YESNO_C:     2,   // Paid flag must be "Yes"
    MONTHS_F:    5,   // Months list/date(s)
    NAME_L:      11,  // Account Name
    SERVICE_M:   12,  // OTG Comp Billing item (preferred)
    BAN_K:       10,  // Account Number
    INVOICE_AF:  31,  // Invoice Total
    TOTAL_AG:    32   // Commission Amount (Total Commissions)
  };

  const today = new Date();
  const toAppend = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const paidFlag = String(row[IDX.YESNO_C] || "").trim().toLowerCase();
    if (paidFlag !== "yes") continue;

    const acctName = String(row[IDX.NAME_L] || "").trim();
    const svcRaw   = String(row[IDX.SERVICE_M] || "").trim();
    const banRaw   = String(row[IDX.BAN_K] || "").trim();
    const billingItem = svcRaw || banRaw;
    if (!billingItem) continue;

    const state      = (idxState != null) ? String(row[idxState] || "").trim() : "";
    const billDesc   = (idxBillDesc != null) ? (row[idxBillDesc] || "") : "";
    const billPeriod = (idxBillPeriod != null) ? (row[idxBillPeriod] || "") : "";

    const inv  = row[IDX.INVOICE_AF] || "";
    const tot  = row[IDX.TOTAL_AG] || "";

    const months = ZMHP_RF1_normalizeMonthsFromCell_(row[IDX.MONTHS_F]);
    if (months.size === 0) continue;

    months.forEach(mTok => {
      if (mTok === lagToken) return; // skip lag month itself

      // If Bill/Invoice Period is blank, we can optionally populate with first-of-month from token
      let billPeriodOut = billPeriod;
      if (!billPeriodOut) {
        const firstOf = ZMHP_RF1_monthTokenToFirstOfMonth_(mTok);
        if (firstOf) billPeriodOut = Utilities.formatDate(firstOf, tz, "M/d/yyyy");
      }

      toAppend.push([
        state,                 // A
        acctName,              // B
        banRaw,                // C
        billingItem,           // D
        "",                    // E expected blank
        inv,                   // F
        tot,                   // G
        "Zayo",                // H
        billDesc,              // I
        billPeriodOut || "",   // J
        today,                 // K
        fixedLinkFormula,      // L
        ""                     // M
      ]);
    });
  }

  const targetSS = SpreadsheetApp.openById(ZMHP_RF1_TARGET_SHEET_ID);
  ZMHP_RF1_appendToSheetWithHeaders_(targetSS, ZMHP_RF1_TARGET_SHEET_NAME, ZMHP_RF1_HEADERS, toAppend, {
    dedupe: true,
    ignoreLastColInDedupe: true
  });

  // Formatting
  const sh = targetSS.getSheetByName(ZMHP_RF1_TARGET_SHEET_NAME);
  const lr = sh.getLastRow();
  if (lr >= 2) {
    sh.getRange(2, 6, lr - 1, 2).setNumberFormat('$#,##0.00;-$#,##0.00'); // F,G
    sh.getRange(2, 11, lr - 1, 1).setNumberFormat('M/d/yyyy');            // K
  }

  SpreadsheetApp.getActive().toast(`Months Held Paid ALL updated. Candidate rows: ${toAppend.length}`);
  Logger.log(`ZMHP_RF1: Candidate rows (pre-dedupe): ${toAppend.length}`);
}


// ======================= HELPERS =======================

function ZMHP_RF1_appendToSheetWithHeaders_(targetSS, sheetName, headers, rows, options) {
  const sh = targetSS.getSheetByName(sheetName) || targetSS.insertSheet(sheetName);

  // Ensure headers (row 1)
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
  } else {
    const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0]
      .map(h => String(h || "").trim());
    const mismatch = headers.some((h, i) => String(existing[i] || "") !== String(h));
    if (mismatch) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  }

  if (!rows || rows.length === 0) {
    Logger.log(`ZMHP_RF1: Nothing to append to "${sheetName}".`);
    return;
  }

  const dedupe = !!(options && options.dedupe);
  const ignoreLast = !!(options && options.ignoreLastColInDedupe);

  let existingSet = new Set();
  if (dedupe) {
    const existingRows = Math.max(0, sh.getLastRow() - 1);
    if (existingRows > 0) {
      const existingVals = sh.getRange(2, 1, existingRows, headers.length).getValues();
      const colsForKey = ignoreLast ? headers.length - 1 : headers.length;
      for (let i = 0; i < existingVals.length; i++) {
        existingSet.add(existingVals[i].slice(0, colsForKey).join("|"));
      }
    }
  }

  const colsForNewKey = ignoreLast ? headers.length - 1 : headers.length;
  const filtered = dedupe
    ? rows.filter(r => !existingSet.has(r.slice(0, colsForNewKey).join("|")))
    : rows;

  if (!filtered.length) {
    Logger.log(`ZMHP_RF1: All rows were duplicates for "${sheetName}".`);
    return;
  }

  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, filtered.length, headers.length).setValues(filtered);
}

function ZMHP_RF1_findZayoFileForMonth_(folderId, yyyyMm) {
  const folder = DriveApp.getFolderById(folderId);
  const it = folder.getFiles();

  const needle = String(yyyyMm).toLowerCase();
  const candidates = [];

  while (it.hasNext()) {
    const f = it.next();
    const name = String(f.getName() || "");
    const lname = name.toLowerCase();
    if (lname.includes(needle) && lname.includes("zayo")) candidates.push(f);
  }

  if (!candidates.length) return null;

  // Prefer file containing "Collection of Commissions"
  for (const f of candidates) {
    try {
      const ss = SpreadsheetApp.openById(f.getId());
      if (ss.getSheetByName("Collection of Commissions")) return f;
    } catch (e) {}
  }
  return candidates[0];
}

function ZMHP_RF1_findHeaderIndexCI_(headerRow, names, optional) {
  const norm = s => String(s||"").replace(/[\u00A0\u200B]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const H = headerRow.map(norm);
  for (const name of names) {
    const target = norm(name);
    const idx = H.indexOf(target);
    if (idx !== -1) return idx;
  }
  return optional ? null : null;
}

function ZMHP_RF1_makeHyperlinkFormula_(url, text) {
  const escUrl = String(url).replace(/"/g, '""');
  const escTxt = String(text).replace(/"/g, '""');
  return `=HYPERLINK("${escUrl}","${escTxt}")`;
}

function ZMHP_RF1_shiftMonth_(dateObj, deltaMonths) {
  const d = new Date(dateObj);
  d.setMonth(d.getMonth() + deltaMonths, 1);
  d.setHours(0,0,0,0);
  return d;
}

function ZMHP_RF1_formatYYYYMM_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function ZMHP_RF1_formatMonthYearToken_(date){
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const shortMonths = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${shortMonths[d.getMonth()]}'${String(d.getFullYear()).slice(-2)}`;
}

function ZMHP_RF1_normalizeMonthsFromCell_(cell) {
  const out = new Set();
  if (cell == null || cell === "") return out;

  if (cell instanceof Date && !isNaN(cell.getTime())) {
    out.add(ZMHP_RF1_formatMonthYearToken_(cell));
    return out;
  }

  const txt = String(cell).trim();
  if (!txt) return out;

  const parts = txt.split(/[\n,;|]+/).map(s => s.trim()).filter(Boolean);
  parts.forEach(p => {
    const d = new Date(p);
    if (!isNaN(d.getTime())) { out.add(ZMHP_RF1_formatMonthYearToken_(d)); return; }

    const tok = ZMHP_RF1_normalizeMonthToken_(p);
    if (tok) out.add(tok);
  });

  return out;
}

function ZMHP_RF1_normalizeMonthToken_(t) {
  const s = String(t || "").trim();

  // "Nov'24"
  let m = s.match(/^([A-Za-z]{3})'(\d{2})$/);
  if (m) return `${ZMHP_RF1_canonicalMon_(m[1])}'${m[2]}`;

  // "Nov 2024" or "November 2024"
  m = s.match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) return `${ZMHP_RF1_canonicalMon_(m[1])}'${String(parseInt(m[2],10)).slice(-2)}`;

  // "November '24" or "Nov 24"
  m = s.match(/^([A-Za-z]{3,})\s*'?\s*(\d{2})$/);
  if (m) return `${ZMHP_RF1_canonicalMon_(m[1])}'${m[2]}`;

  return "";
}

function ZMHP_RF1_monthTokenToFirstOfMonth_(token) {
  const s = String(token).trim();
  if (!s) return null;

  const m = s.match(/^([A-Za-z]{3})'(\d{2})$/);
  if (m) {
    const monthIndex = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11}[m[1]];
    return new Date(2000 + parseInt(m[2],10), monthIndex, 1);
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);
  return null;
}

function ZMHP_RF1_canonicalMon_(s){
  const lower = String(s||"").toLowerCase();
  const map = {
    january:"Jan", jan:"Jan",
    february:"Feb", feb:"Feb",
    march:"Mar", mar:"Mar",
    april:"Apr", apr:"Apr",
    may:"May",
    june:"Jun", jun:"Jun",
    july:"Jul", jul:"Jul",
    august:"Aug", aug:"Aug",
    september:"Sep", sep:"Sep",
    october:"Oct", oct:"Oct",
    november:"Nov", nov:"Nov",
    december:"Dec", dec:"Dec"
  };
  return map[lower] || "";
}

// Month parser from A1 (same style as your other steps)
function ZMHP_RF1_readTargetMonthFromA1_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const raw = String(sh.getRange("A1").getDisplayValue() || "").trim();
  if (!raw) throw new Error('ZMHP_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');

  const today = new Date();
  const currentYear = today.getFullYear();

  let m = raw.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const mm = ZMHP_RF1_monthNameToIndex_(m[1]);
    let y = parseInt(m[2], 10); if (y < 100) y += 2000;
    return new Date(y, mm, 1);
  }

  m = raw.match(/^([A-Za-z]+)$/);
  if (m) return new Date(currentYear, ZMHP_RF1_monthNameToIndex_(m[1]), 1);

  m = raw.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);

  const d = new Date(raw);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);

  throw new Error('ZMHP_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');
}

function ZMHP_RF1_monthNameToIndex_(name) {
  const n = String(name || "").toLowerCase().slice(0, 3);
  const map = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  if (!(n in map)) throw new Error("ZMHP_RF1: Unknown month name: " + name);
  return map[n];
}
