/****************************************************
 * Months Held NOT Paid ALL — Runner-friendly (ZMHNP_RF1)
 *
 * Runner-friendly changes:
 * - NO December-only.
 * - Reads target month from A1 (like your other runner steps).
 * - Applies Zayo offset (-2 months) to pick the correct Zayo statement file.
 * - Keeps behavior: updates existing rows by OTG item (col D) or appends new.
 * - Keeps sheet/tab + IDs the same.
 *
 * Entry point for your master runner:
 *   ZMHNP_RF1_transferMonthsHeldNotPaid_ALL();
 ****************************************************/

// ======= CONFIG =======
const ZMHNP_RF1_CARRIER_FOLDER_ID = "1JJRszMqel6kWL8CeoVKBCclROSoDfzw_";
const ZMHNP_RF1_TARGET_SHEET_ID   = "1DJgNesYSj1hQte64lEJ7UEevRSQlDZx1gNURZ9bwGI4";
const ZMHNP_RF1_TARGET_SHEET_NAME = "Months Held NOT Paid ALL";
const ZMHNP_RF1_ZAYO_OFFSET_MONTHS = 2;
// ======================

const ZMHNP_RF1_HEADERS = [
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

/**
 * Runner step:
 * - month comes from active sheet A1 (e.g., "December 2025" or "Dec" or "2025-12")
 * - offset -2 months for Zayo file selection
 */
function ZMHNP_RF1_transferMonthsHeldNotPaid_ALL() {
  const tz = Session.getScriptTimeZone();

  // Month selection (runner-friendly)
  const selectedMonth = ZMHNP_RF1_readTargetMonthFromA1_(); // normalized to 1st

  // Apply Zayo offset: selectedMonth -> carrier statement month
  const zayoMonthDate = ZMHNP_RF1_shiftMonth_(selectedMonth, -ZMHNP_RF1_ZAYO_OFFSET_MONTHS);
  const zayoYYYYMM    = ZMHNP_RF1_formatYYYYMM_(zayoMonthDate);

  // Find Zayo statement for offset month
  const zayoFile = ZMHNP_RF1_findZayoFileForMonth_(ZMHNP_RF1_CARRIER_FOLDER_ID, zayoYYYYMM);
  if (!zayoFile) throw new Error(`ZMHNP_RF1: No Zayo file found for ${zayoYYYYMM}`);

  const linkFormula = ZMHNP_RF1_makeHyperlinkFormula_(zayoFile.getUrl(), zayoFile.getName());

  // Open "Collection of Commissions"
  const srcSS = SpreadsheetApp.openById(zayoFile.getId());
  const srcSh = srcSS.getSheetByName("Collection of Commissions");
  if (!srcSh) throw new Error(`ZMHNP_RF1: Missing "Collection of Commissions" in ${zayoFile.getName()}`);

  const lastRow = srcSh.getLastRow();
  const lastCol = srcSh.getLastColumn();
  if (lastRow < 2) {
    Logger.log("ZMHNP_RF1: No rows in Collection of Commissions.");
    return;
  }

  const header = srcSh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
  const data   = srcSh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Optional columns
  const idxState     = ZMHNP_RF1_findHeaderIndexCI_(header, ["State", "ST"], true);
  const idxBillDesc  = ZMHNP_RF1_findHeaderIndexCI_(header, ["Bill Description"], true);

  // Bill period detection: prefer header; else fallback to N (0-based 13) if exists
  const idxBillPeriod = (function () {
    const byHdr = ZMHNP_RF1_findHeaderIndexCI_(header, ["Bill/Invoice Period", "Bill Invoice Period", "Invoice Period"], true);
    if (byHdr != null) return byHdr;
    return (lastCol > 13) ? 13 : null;
  })();

  // Fixed indices from your original mapping (0-based)
  const IDX = {
    PAID_FLAG_C: 2,   // C
    MONTHS_F:    5,   // F (not written, only used for grouping)
    NAME_L:      11,  // L -> Account Name
    SERVICE_M:   12,  // M -> OTG Comp Billing item (preferred)
    BAN_K:       10,  // K -> Account Number
    INVOICE_AF:  31,  // AF -> Invoice Total
    TOTAL_AG:    32   // AG -> Commission Amount (Total Commissions)
  };

  // Group by billing item (service name fallback ban)
  const grouped = new Map(); // normKey -> obj

  data.forEach(row => {
    const paidFlag = String(row[IDX.PAID_FLAG_C] || "").trim().toLowerCase();
    if (paidFlag !== "no") return;

    const svcRaw = String(row[IDX.SERVICE_M] || "").trim();
    const banRaw = String(row[IDX.BAN_K] || "").trim();
    const billingItem = svcRaw || banRaw;
    if (!billingItem) return;

    const key = ZMHNP_RF1_normKey_(billingItem);

    const state      = (idxState != null) ? String(row[idxState] || "").trim() : "";
    const acctName   = String(row[IDX.NAME_L] || "").trim();
    const acctNumber = banRaw;

    const invoiceTotal  = row[IDX.INVOICE_AF] || "";
    const commissionAmt = row[IDX.TOTAL_AG] || "";

    const billDesc   = (idxBillDesc != null) ? (row[idxBillDesc] || "") : "";
    const billPeriod = (idxBillPeriod != null) ? (row[idxBillPeriod] || "") : "";

    const monthsSet  = ZMHNP_RF1_normalizeMonthsFromCell_(row[IDX.MONTHS_F]);

    if (!grouped.has(key)) {
      grouped.set(key, {
        state,
        acctName,
        acctNumber,
        billingItemRaw: billingItem,
        invoiceTotal,
        commissionAmt,
        billDesc,
        billPeriod,
        months: new Set()
      });
    }

    const agg = grouped.get(key);
    monthsSet.forEach(m => agg.months.add(m));

    if (!agg.state && state) agg.state = state;
    if (!agg.acctName && acctName) agg.acctName = acctName;
    if (!agg.acctNumber && acctNumber) agg.acctNumber = acctNumber;
    if (!agg.billDesc && billDesc) agg.billDesc = billDesc;
    if (!agg.billPeriod && billPeriod) agg.billPeriod = billPeriod;
  });

  // Destination
  const destSS = SpreadsheetApp.openById(ZMHNP_RF1_TARGET_SHEET_ID);
  let destSh = destSS.getSheetByName(ZMHNP_RF1_TARGET_SHEET_NAME);
  if (!destSh) destSh = destSS.insertSheet(ZMHNP_RF1_TARGET_SHEET_NAME);

  ZMHNP_RF1_ensureHeadersRow1_(destSh, ZMHNP_RF1_HEADERS);

  if (grouped.size === 0) {
    SpreadsheetApp.getActive().toast("Months Held NOT Paid ALL: nothing to add.");
    Logger.log("ZMHNP_RF1: nothing to add.");
    return;
  }

  // Index existing rows by OTG Comp Billing item (col D)
  const width = ZMHNP_RF1_HEADERS.length;
  const destLastRow = destSh.getLastRow();
  const existingValues = (destLastRow >= 2)
    ? destSh.getRange(2, 1, destLastRow - 1, width).getValues()
    : [];

  const existingIndex = new Map(); // normKey(col D) -> idx in existingValues
  for (let i = 0; i < existingValues.length; i++) {
    const item = String(existingValues[i][3] || "").trim();
    if (!item) continue;
    existingIndex.set(ZMHNP_RF1_normKey_(item), i);
  }

  const today = new Date();
  const toAppend = [];
  let modified = false;

  grouped.forEach(obj => {
    const key = ZMHNP_RF1_normKey_(obj.billingItemRaw);

    if (existingIndex.has(key)) {
      const idx = existingIndex.get(key);
      const row = existingValues[idx];

      if (!row[0] && obj.state) row[0] = obj.state;               // A State
      if (!row[1] && obj.acctName) row[1] = obj.acctName;         // B Account Name
      if (!row[2] && obj.acctNumber) row[2] = obj.acctNumber;     // C Account Number
      if (!row[3]) row[3] = obj.billingItemRaw;                   // D OTG item

      row[4] = "";                                                // E EXPECTED blank here
      if (row[5] === "" || row[5] == null) row[5] = obj.invoiceTotal;
      if (row[6] === "" || row[6] == null) row[6] = obj.commissionAmt;

      row[7] = "Zayo";                                            // H Provider
      if (!row[8] && obj.billDesc) row[8] = obj.billDesc;         // I Bill Desc
      if (!row[9] && obj.billPeriod) row[9] = obj.billPeriod;     // J Bill Period

      // Keep statement link current
      if (row[11] !== linkFormula) {
        row[10] = today;     // K Date added (stamp when link changes)
        row[11] = linkFormula;
        modified = true;
      }

      row[12] = ""; // M VP NOTES
    } else {
      toAppend.push([
        obj.state || "",
        obj.acctName || "",
        obj.acctNumber || "",
        obj.billingItemRaw || "",
        "",
        obj.invoiceTotal || "",
        obj.commissionAmt || "",
        "Zayo",
        obj.billDesc || "",
        obj.billPeriod || "",
        today,
        linkFormula,
        ""
      ]);
    }
  });

  if (modified && existingValues.length) {
    destSh.getRange(2, 1, existingValues.length, width).setValues(existingValues);
  }
  if (toAppend.length) {
    const start = destSh.getLastRow() + 1;
    destSh.getRange(start, 1, toAppend.length, width).setValues(toAppend);
  }

  // Formatting
  const finalLastRow = destSh.getLastRow();
  if (finalLastRow >= 2) {
    destSh.getRange(2, 6, finalLastRow - 1, 2).setNumberFormat('$#,##0.00;-$#,##0.00'); // F,G
    destSh.getRange(2, 11, finalLastRow - 1, 1).setNumberFormat('M/d/yyyy');            // K
  }

  SpreadsheetApp.getActive().toast(`Months Held NOT Paid ALL updated. Added: ${toAppend.length}`);
  Logger.log(`ZMHNP_RF1: Updated. Added: ${toAppend.length}`);
}


// ======================= HELPERS =======================

function ZMHNP_RF1_ensureHeadersRow1_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }
  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
    .map(h => String(h || "").trim());
  const mismatch = headers.some((h, i) => String(existing[i] || "") !== String(h));
  if (mismatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

function ZMHNP_RF1_makeHyperlinkFormula_(url, text) {
  const escUrl = String(url).replace(/"/g, '""');
  const escTxt = String(text).replace(/"/g, '""');
  return `=HYPERLINK("${escUrl}","${escTxt}")`;
}

function ZMHNP_RF1_findHeaderIndexCI_(headerRow, names, optional) {
  const norm = s => String(s||"").replace(/[\u00A0\u200B]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const H = headerRow.map(norm);
  for (const name of names) {
    const target = norm(name);
    const idx = H.indexOf(target);
    if (idx !== -1) return idx;
  }
  return optional ? null : null;
}

function ZMHNP_RF1_normKey_(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[\u00A0\u200B]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function ZMHNP_RF1_normalizeMonthsFromCell_(cell) {
  const out = new Set();
  if (cell == null || cell === "") return out;

  if (cell instanceof Date && !isNaN(cell.getTime())) {
    out.add(ZMHNP_RF1_monthToken_(cell));
    return out;
  }
  const txt = String(cell).trim();
  if (!txt) return out;

  const parts = txt.split(/[\n,;|]+/).map(s => s.trim()).filter(Boolean);
  parts.forEach(p => {
    const d = new Date(p);
    if (!isNaN(d.getTime())) { out.add(ZMHNP_RF1_monthToken_(d)); return; }
    out.add(p);
  });
  return out;
}

function ZMHNP_RF1_monthToken_(d) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]}'${String(d.getFullYear()).slice(-2)}`;
}

function ZMHNP_RF1_shiftMonth_(date, deltaMonths) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + deltaMonths);
  return d;
}

function ZMHNP_RF1_formatYYYYMM_(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

function ZMHNP_RF1_findZayoFileForMonth_(folderId, yyyyMm) {
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

  // Prefer the file that actually contains "Collection of Commissions"
  for (const f of candidates) {
    try {
      const ss = SpreadsheetApp.openById(f.getId());
      if (ss.getSheetByName("Collection of Commissions")) return f;
    } catch (e) {}
  }
  return candidates[0];
}

// Month parser from A1 (same approach as your other runner-friendly steps)
function ZMHNP_RF1_readTargetMonthFromA1_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const raw = String(sh.getRange("A1").getDisplayValue() || "").trim();
  if (!raw) throw new Error('ZMHNP_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');

  const today = new Date();
  const currentYear = today.getFullYear();

  let m = raw.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const mm = ZMHNP_RF1_monthNameToIndex_(m[1]);
    let y = parseInt(m[2], 10); if (y < 100) y += 2000;
    return new Date(y, mm, 1);
  }

  m = raw.match(/^([A-Za-z]+)$/);
  if (m) return new Date(currentYear, ZMHNP_RF1_monthNameToIndex_(m[1]), 1);

  m = raw.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);

  const d = new Date(raw);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);

  throw new Error('ZMHNP_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');
}

function ZMHNP_RF1_monthNameToIndex_(name) {
  const n = String(name || "").toLowerCase().slice(0, 3);
  const map = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  if (!(n in map)) throw new Error("ZMHNP_RF1: Unknown month name: " + name);
  return map[n];
}
