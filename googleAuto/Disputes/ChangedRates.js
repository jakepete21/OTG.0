/****************************************************
 * CHANGED RATES — Runner-friendly (CR_RF1)
 *
 * Runner-friendly changes:
 * - NO hardcoded Combined sheet ID. Uses Combined folder + YYYY-MM token.
 * - Reads target month from A1 (same parsing style as your other scripts).
 * - Compares target month vs previous month automatically.
 * - Keeps all hardcoded IDs that you said are allowed:
 *    - Disputes sheet ID
 *    - Comp Key sheet ID
 *    - Folder IDs (Combined folder + Statements folder)
 *
 * Notes:
 * - This is no longer “December only”. If you still want Dec-only behavior,
 *   keep CR_RF1_runChangedRates_DecemberOnly() wrapper (included).
 ****************************************************/

// ===================== CONFIG =====================

// Combined month files live here:
const CR_RF1_COMBINED_FOLDER_ID = "1fvJKGLOVyo4XJSi4sISvtLxH4YFYkNFk";

// Actual carrier statements live here (for links):
const CR_RF1_STATEMENTS_FOLDER_ID = "1JJRszMqel6kWL8CeoVKBCclROSoDfzw_";

// Destination (Disputes)
const CR_RF1_DISPUTES_SHEET_ID = "1DJgNesYSj1hQte64lEJ7UEevRSQlDZx1gNURZ9bwGI4";
const CR_RF1_DISPUTES_TAB_NAME = "Changed Rates";

// Threshold + Zayo offset logic
const CR_RF1_THRESHOLD = 50;         // dollars
const CR_RF1_ZAYO_OFFSET_MONTHS = 2; // Dec => Oct 1; Nov => Sep 1 (same logic)

// Comp Key expected lookup
const CR_RF1_COMP_KEY_SHEET_ID = "10P1ACf1riryneD0zpZT6SRKqcnSHobfEVdAOE-cOPKo";
const CR_RF1_COMP_KEY_TAB_NAME = "NEW Comp Key";
const CR_RF1_COMP_KEY_ITEM_HDR = "OTG Comp Billing item";
const CR_RF1_COMP_KEY_EXPECTED_HDR_PRIMARY  = "EXPECTED/Mo. \nOTG Comp % \n - column R Comp Key";
const CR_RF1_COMP_KEY_EXPECTED_HDR_FALLBACK = "Monthly Comp \nExpected to OTG";


// ===================== ENTRYPOINTS =====================

/**
 * Runner-friendly default:
 * - reads month from active sheet A1
 * - compares that month vs previous month
 */
function CR_RF1_flagChangedRatesFromA1() {
  const targetMonthDate = CR_RF1_readTargetMonthFromA1_(); // normalized to 1st
  CR_RF1_flagChangedRatesForMonth_(targetMonthDate);
}

/** Optional: keep your old Dec-only behavior */
function CR_RF1_runChangedRates_DecemberOnly() {
  const targetMonthDate = new Date(2025, 11, 1); // December 2025
  CR_RF1_flagChangedRatesForMonth_(targetMonthDate);
}


// ===================== MAIN =====================

function CR_RF1_flagChangedRatesForMonth_(targetMonthDate) {
  if (!(targetMonthDate instanceof Date) || isNaN(targetMonthDate.getTime())) {
    throw new Error("CR_RF1: targetMonthDate must be a valid Date.");
  }

  const tz = Session.getScriptTimeZone();

  const thisYear   = targetMonthDate.getFullYear();
  const thisMonth  = targetMonthDate.getMonth() + 1;
  const prevDate   = new Date(thisYear, targetMonthDate.getMonth() - 1, 1);
  const prevYear   = prevDate.getFullYear();
  const prevMonth  = prevDate.getMonth() + 1;

  const thisFile = CR_RF1_findCombinedByYearMonth_(CR_RF1_COMBINED_FOLDER_ID, thisYear, thisMonth);
  if (!thisFile) throw new Error(`CR_RF1: Could not find Combined for ${thisYear}-${String(thisMonth).padStart(2,"0")}.`);
  const prevFile = CR_RF1_findCombinedByYearMonth_(CR_RF1_COMBINED_FOLDER_ID, prevYear, prevMonth);
  if (!prevFile) throw new Error(`CR_RF1: Could not find Combined for ${prevYear}-${String(prevMonth).padStart(2,"0")}.`);

  const thisSS = SpreadsheetApp.openById(thisFile.getId());
  const prevSS = SpreadsheetApp.openById(prevFile.getId());

  // Expected lookup from Comp Key
  const expectedByBilling = CR_RF1_buildExpectedLookupFromCompKey_(
    CR_RF1_COMP_KEY_SHEET_ID,
    CR_RF1_COMP_KEY_TAB_NAME,
    CR_RF1_COMP_KEY_ITEM_HDR,
    CR_RF1_COMP_KEY_EXPECTED_HDR_PRIMARY,
    CR_RF1_COMP_KEY_EXPECTED_HDR_FALLBACK
  );

  // Matches tables
  const thisMatches = thisSS.getSheetByName("Matches");
  const prevMatches = prevSS.getSheetByName("Matches");
  if (!thisMatches) throw new Error(`CR_RF1: Missing "Matches" in ${thisFile.getName()}`);
  if (!prevMatches) throw new Error(`CR_RF1: Missing "Matches" in ${prevFile.getName()}`);

  const T = CR_RF1_readTable_(thisMatches);
  const P = CR_RF1_readTable_(prevMatches);

  // Required cols (loose header match)
  const T_STATE = CR_RF1_findHeaderIndexLoose_(T.header, ["State"], true);
  const T_ACCT  = CR_RF1_findHeaderIndexLoose_(T.header, ["Account Name"], true);
  const T_ACCTN = CR_RF1_findHeaderIndexLoose_(T.header, ["Account Number"], true);

  const T_BILL  = CR_RF1_findHeaderIndexLoose_(T.header, ["OTG Comp Billing item", "Service Number"]);
  const T_INV   = CR_RF1_findHeaderIndexLoose_(T.header, ["Invoice Total"], true);
  const T_COMM  = CR_RF1_findHeaderIndexLoose_(T.header, ["Commission Amount"]);
  const T_PER   = CR_RF1_findHeaderIndexLoose_(T.header, ["Bill/Invoice Period"], true);
  const T_PROV  = CR_RF1_findHeaderIndexLoose_(T.header, ["Provider"], true);
  const T_STMT  = CR_RF1_findHeaderIndexLoose_(T.header, ["Carrier Statement"], true);

  const P_BILL  = CR_RF1_findHeaderIndexLoose_(P.header, ["OTG Comp Billing item", "Service Number"]);
  const P_COMM  = CR_RF1_findHeaderIndexLoose_(P.header, ["Commission Amount"]);
  const P_PROV  = CR_RF1_findHeaderIndexLoose_(P.header, ["Provider"], true);

  // Aggregate latest and prev (excluding Zayo from Matches)
  const latestByBilling = new Map(); // billingUpper -> acc
  const prevByBilling   = new Map(); // billingUpper -> sumComm

  CR_RF1_addMatchesRows_({
    map: latestByBilling,
    rows: T.rows,
    iState: T_STATE,
    iAcct: T_ACCT,
    iAcctNum: T_ACCTN,
    iBill: T_BILL,
    iInv: T_INV,
    iComm: T_COMM,
    iPer: T_PER,
    iProv: T_PROV,
    iStmt: T_STMT,
    skipZayo: true
  });

  const prevNonZayoAgg = new Map();
  CR_RF1_addMatchesRows_({
    map: prevNonZayoAgg,
    rows: P.rows,
    iState: null,
    iAcct: null,
    iAcctNum: null,
    iBill: P_BILL,
    iInv: null,
    iComm: P_COMM,
    iPer: null,
    iProv: P_PROV,
    iStmt: null,
    skipZayo: true
  });

  prevNonZayoAgg.forEach((val, billingUpper) => {
    prevByBilling.set(billingUpper, (prevByBilling.get(billingUpper) || 0) + val.sumComm);
  });

  // Zayo offset periods (read Zayo tab by display date in col F)
  const thisZayoPeriod = new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth() - CR_RF1_ZAYO_OFFSET_MONTHS, 1);
  const prevZayoPeriod = new Date(prevDate.getFullYear(),       prevDate.getMonth()       - CR_RF1_ZAYO_OFFSET_MONTHS, 1);

  const wantedThis = Utilities.formatDate(thisZayoPeriod, tz, "MM/dd/yyyy");
  const wantedPrev = Utilities.formatDate(prevZayoPeriod, tz, "MM/dd/yyyy");

  const latestZayo = CR_RF1_readZayoTotalsForDate_(thisSS, wantedThis);
  const prevZayo   = CR_RF1_readZayoTotalsForDate_(prevSS, wantedPrev);

  latestZayo.forEach((z, billingUpper) => {
    const acc = latestByBilling.get(billingUpper) || CR_RF1_blankAcc_();
    acc.sumInv  += z.sumInv;
    acc.sumComm += z.sumComm;

    if (!acc.firstState && z.firstState) acc.firstState = z.firstState;
    if (!acc.firstAcct && z.firstAcct) acc.firstAcct = z.firstAcct;
    if (!acc.firstAcctNum && z.firstAcctNum) acc.firstAcctNum = z.firstAcctNum;
    if (!acc.firstPeriod && z.firstPeriod) acc.firstPeriod = z.firstPeriod;

    if (!acc.firstProv) acc.firstProv = "Zayo";
    if (!acc.firstStmtText) acc.firstStmtText = z.firstStmtText || "Zayo";

    latestByBilling.set(billingUpper, acc);
  });

  prevZayo.forEach((z, billingUpper) => {
    prevByBilling.set(billingUpper, (prevByBilling.get(billingUpper) || 0) + z.sumComm);
  });

  // Output sheet prep
  const disputesSs = SpreadsheetApp.openById(CR_RF1_DISPUTES_SHEET_ID);
  let outSh = disputesSs.getSheetByName(CR_RF1_DISPUTES_TAB_NAME);
  if (!outSh) outSh = disputesSs.insertSheet(CR_RF1_DISPUTES_TAB_NAME);

  const outHeader = [
    "State",
    "Account Name",
    "Account Number",
    "OTG Comp Billing item",
    "EXPECTED/Mo. \nOTG Comp % \n - column R Comp Key",
    "Invoice Total",
    "Commission Amount\n - from Carrier Statement",
    "Provider",
    "Difference vs Prev",
    "Bill/Invoice Period",
    "Date added to Disputes",
    "Associated Carrier Statement",
    "VP NOTES"
  ];
  CR_RF1_ensureHeader_(outSh, outHeader);

  const existingKeys = CR_RF1_buildExistingKeys_(outSh);

  // Cache statement lookups: stmtTextLower -> {url,name} or null
  const stmtCache = new Map();

  const rowsOut = [];
  latestByBilling.forEach((val, billingUpper) => {
    if (!prevByBilling.has(billingUpper)) return;

    const latestComm = val.sumComm;
    const prevComm   = prevByBilling.get(billingUpper) || 0;
    const diff       = latestComm - prevComm;

    if (Math.abs(diff) <= CR_RF1_THRESHOLD) return;

    const expected = expectedByBilling.get(CR_RF1_normKey_(billingUpper)) || "";

    const stmtText = String(val.firstStmtText || "").trim();
    const linkFormula = CR_RF1_buildLinkFromCarrierStatementText_(
      CR_RF1_STATEMENTS_FOLDER_ID,
      stmtText,
      stmtCache
    );

    const row = [
      val.firstState || "",
      val.firstAcct || "",
      val.firstAcctNum || "",
      billingUpper,
      expected,
      val.sumInv,
      val.sumComm,
      val.firstProv || "",
      Number(diff.toFixed(2)),
      val.firstPeriod || "",
      null,                // K date filled below
      linkFormula || "",   // L hyperlink
      ""                   // M
    ];

    const dk = CR_RF1_buildDedupeKey_(row);
    if (!dk) return;
    if (existingKeys.has(dk)) return;

    existingKeys.add(dk);
    rowsOut.push(row);
  });

  if (!rowsOut.length) {
    Logger.log("CR_RF1: No new changed-rate rows to append (after dedupe).");
    return;
  }

  const now = new Date();
  rowsOut.forEach(r => r[10] = now);

  const startRow = outSh.getLastRow() + 1;
  outSh.getRange(startRow, 1, rowsOut.length, outHeader.length).setValues(rowsOut);

  // Money formatting (F,G,I) + date (K)
  outSh.getRange(startRow, 6, rowsOut.length, 1).setNumberFormat("$#,##0.00;-$#,##0.00");
  outSh.getRange(startRow, 7, rowsOut.length, 1).setNumberFormat("$#,##0.00;-$#,##0.00");
  outSh.getRange(startRow, 9, rowsOut.length, 1).setNumberFormat("$#,##0.00;-$#,##0.00");
  outSh.getRange(startRow, 11, rowsOut.length, 1).setNumberFormat("mm/dd/yyyy");

  Logger.log(`CR_RF1: Appended Changed Rates rows: ${rowsOut.length}`);
}


// =====================================================
// ===================== LINK LOGIC =====================
// =====================================================

function CR_RF1_buildLinkFromCarrierStatementText_(folderId, stmtText, cacheMap) {
  const s = String(stmtText || "").trim();
  if (!s) return "";

  const key = s.toLowerCase();
  if (cacheMap && cacheMap.has(key)) {
    const info = cacheMap.get(key);
    return info ? CR_RF1_makeHyperlinkFormula_(info.url, info.name) : "";
  }

  const f = CR_RF1_findMostRecentFileContainingText_(folderId, s);
  if (!f) {
    if (cacheMap) cacheMap.set(key, null);
    return "";
  }

  const info = { url: f.getUrl(), name: f.getName() };
  if (cacheMap) cacheMap.set(key, info);

  return CR_RF1_makeHyperlinkFormula_(info.url, info.name);
}

function CR_RF1_findMostRecentFileContainingText_(folderId, stmtText) {
  const needle = String(stmtText || "").trim().toLowerCase();
  if (!needle) return null;

  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();

  let best = null; // {file, ts}
  while (files.hasNext()) {
    const f = files.next();
    const name = String(f.getName() || "");
    const lname = name.toLowerCase();
    if (!lname.includes(needle)) continue;

    const ts = f.getLastUpdated ? f.getLastUpdated().getTime() : 0;
    if (!best || ts > best.ts) best = { file: f, ts };
  }
  return best ? best.file : null;
}

function CR_RF1_makeHyperlinkFormula_(url, text) {
  const escUrl = String(url).replace(/"/g, '""');
  const escTxt = String(text).replace(/"/g, '""');
  return `=HYPERLINK("${escUrl}","${escTxt}")`;
}


// =====================================================
// ===================== DEDUPE =========================
// =====================================================

function CR_RF1_buildExistingKeys_(sh) {
  const set = new Set();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return set;

  const vals = sh.getRange(2, 1, lastRow - 1, Math.max(13, sh.getLastColumn())).getValues();
  vals.forEach(r => {
    const billingItem = String(r[3] || "").trim();
    const provider    = String(r[7] || "").trim();
    const billPeriod  = String(r[9] || "").trim();
    const commAmt     = CR_RF1_toNum_(r[6]).toFixed(2);
    const diffAmt     = CR_RF1_toNum_(r[8]).toFixed(2);

    if (!billingItem || !provider) return;
    const k = [
      CR_RF1_normKey_(billingItem),
      provider.toUpperCase(),
      billPeriod,
      commAmt,
      diffAmt
    ].join("|");

    set.add(k);
  });

  return set;
}

function CR_RF1_buildDedupeKey_(row) {
  const billingItem = String(row[3] || "").trim();
  const provider    = String(row[7] || "").trim();
  const billPeriod  = String(row[9] || "").trim();
  const commAmt     = CR_RF1_toNum_(row[6]).toFixed(2);
  const diffAmt     = CR_RF1_toNum_(row[8]).toFixed(2);

  if (!billingItem || !provider) return "";

  return [
    CR_RF1_normKey_(billingItem),
    provider.toUpperCase(),
    billPeriod,
    commAmt,
    diffAmt
  ].join("|");
}


// =====================================================
// ===================== COMP KEY LOOKUP ===============
// =====================================================

function CR_RF1_buildExpectedLookupFromCompKey_(ssId, tabName, itemHdr, expectedHdrPrimary, expectedHdrFallback) {
  const ss = SpreadsheetApp.openById(ssId);
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error("CR_RF1: Comp Key tab not found: " + tabName);

  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return new Map();

  const header = vals[0].map(h => String(h || ""));

  const idxItem = CR_RF1_findHeaderIndexLoose_(header, [itemHdr]);

  let idxExpected = CR_RF1_findHeaderIndexLoose_(header, [expectedHdrPrimary], true);
  if (idxExpected == null) idxExpected = CR_RF1_findHeaderIndexLoose_(header, [expectedHdrFallback], true);

  const map = new Map();
  for (let r = 1; r < vals.length; r++) {
    const item = String(vals[r][idxItem] || "").trim();
    if (!item) continue;
    const key = CR_RF1_normKey_(item);
    if (!key) continue;

    const exp = (idxExpected != null) ? vals[r][idxExpected] : "";
    if (!map.has(key)) map.set(key, exp);
  }
  return map;
}


// =====================================================
// ===================== TABLE HELPERS =================
// =====================================================

function CR_RF1_readTable_(sh) {
  const vals = sh.getDataRange().getValues();
  if (!vals.length) return { header: [], rows: [] };
  return { header: vals[0].map(v => String(v || "")), rows: vals.slice(1) };
}

function CR_RF1_normHeader_(s) {
  return String(s || "")
    .replace(/[\u00A0\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function CR_RF1_findHeaderIndexLoose_(headerRow, candidates, optional) {
  const H = headerRow.map(CR_RF1_normHeader_);
  const cand = (candidates || []).map(CR_RF1_normHeader_);

  for (let c = 0; c < cand.length; c++) {
    const want = cand[c];
    for (let i = 0; i < H.length; i++) {
      if (H[i] === want || H[i].startsWith(want)) return i;
    }
  }
  if (optional) return null;
  throw new Error(`CR_RF1: Missing required header "${candidates && candidates[0] ? candidates[0] : ''}".`);
}

function CR_RF1_toNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function CR_RF1_normKey_(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[\u00A0\u200B]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function CR_RF1_blankAcc_() {
  return {
    sumInv: 0,
    sumComm: 0,
    firstState: "",
    firstAcct: "",
    firstAcctNum: "",
    firstPeriod: "",
    firstProv: "",
    firstStmtText: ""
  };
}

function CR_RF1_addMatchesRows_(opts) {
  const { map, rows, iState, iAcct, iAcctNum, iBill, iInv, iComm, iPer, iProv, iStmt, skipZayo } = opts;

  rows.forEach(r => {
    const prov = (iProv != null) ? String(r[iProv] || "").trim() : "";
    if (skipZayo && prov.toLowerCase() === "zayo") return;

    const billRaw = (iBill != null) ? String(r[iBill] || "").trim() : "";
    const key = billRaw.toUpperCase();
    if (!key) return;

    const inv  = (iInv  != null) ? CR_RF1_toNum_(r[iInv])  : 0;
    const comm = (iComm != null) ? CR_RF1_toNum_(r[iComm]) : 0;

    const acc = map.get(key) || CR_RF1_blankAcc_();
    acc.sumInv  += inv;
    acc.sumComm += comm;

    if (iState != null && !acc.firstState) acc.firstState = String(r[iState] || "").trim();
    if (iAcct  != null && !acc.firstAcct)  acc.firstAcct  = String(r[iAcct]  || "").trim();
    if (iAcctNum != null && !acc.firstAcctNum) acc.firstAcctNum = String(r[iAcctNum] || "").trim();
    if (iPer   != null && !acc.firstPeriod) acc.firstPeriod = String(r[iPer] || "").trim();
    if (!acc.firstProv && prov) acc.firstProv = prov;

    if (iStmt != null && !acc.firstStmtText) {
      const st = String(r[iStmt] || "").trim();
      if (st) acc.firstStmtText = st;
    }

    map.set(key, acc);
  });
}


// =====================================================
// ===================== ZAYO SPECIAL ==================
// =====================================================

function CR_RF1_readZayoTotalsForDate_(combinedSS, wantedDisplayDate) {
  const sh = combinedSS.getSheetByName("Zayo");
  if (!sh) return new Map();

  const range = sh.getDataRange();
  const vals  = range.getValues();
  const disp  = range.getDisplayValues();
  if (vals.length < 2) return new Map();

  const header = vals[0].map(h => String(h || ""));

  const idxState = CR_RF1_findHeaderIndexLoose_(header, ["State"], true);
  const idxAcct  = CR_RF1_findHeaderIndexLoose_(header, ["Account Name"], true);
  const idxAcctN = CR_RF1_findHeaderIndexLoose_(header, ["Account Number"], true);
  const idxBill  = CR_RF1_findHeaderIndexLoose_(header, ["OTG Comp Billing item", "Service Number"], true);
  const idxInv   = CR_RF1_findHeaderIndexLoose_(header, ["Invoice Total"], true);
  const idxComm  = CR_RF1_findHeaderIndexLoose_(header, ["Commission Amount"], true);
  const idxPer   = CR_RF1_findHeaderIndexLoose_(header, ["Bill/Invoice Period"], true);
  const idxStmt  = CR_RF1_findHeaderIndexLoose_(header, ["Carrier Statement"], true);

  const IDX_DATE_F_0 = 5;

  const out = new Map();
  for (let r = 1; r < vals.length; r++) {
    const dateTxt = String(disp[r][IDX_DATE_F_0] || "").trim();
    if (dateTxt !== wantedDisplayDate) continue;

    const billRaw = (idxBill != null && idxBill >= 0) ? String(vals[r][idxBill] || "").trim() : "";
    const key = billRaw.toUpperCase();
    if (!key) continue;

    const inv  = (idxInv  != null && idxInv  >= 0) ? CR_RF1_toNum_(vals[r][idxInv])  : 0;
    const comm = (idxComm != null && idxComm >= 0) ? CR_RF1_toNum_(vals[r][idxComm]) : 0;

    const acc = out.get(key) || {
      sumInv: 0, sumComm: 0,
      firstState: "", firstAcct: "", firstAcctNum: "", firstPeriod: "", firstStmtText: ""
    };

    acc.sumInv  += inv;
    acc.sumComm += comm;

    if (!acc.firstState && idxState != null && idxState >= 0) acc.firstState = String(vals[r][idxState] || "").trim();
    if (!acc.firstAcct  && idxAcct  != null && idxAcct  >= 0) acc.firstAcct  = String(vals[r][idxAcct]  || "").trim();
    if (!acc.firstAcctNum && idxAcctN != null && idxAcctN >= 0) acc.firstAcctNum = String(vals[r][idxAcctN] || "").trim();
    if (!acc.firstPeriod && idxPer != null && idxPer >= 0) acc.firstPeriod = String(vals[r][idxPer] || "").trim();

    if (!acc.firstStmtText && idxStmt != null && idxStmt >= 0) {
      const st = String(vals[r][idxStmt] || "").trim();
      if (st) acc.firstStmtText = st;
    }

    out.set(key, acc);
  }

  return out;
}


// =====================================================
// ===================== OUTPUT HEADER =================
// =====================================================

function CR_RF1_ensureHeader_(sh, header) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
    sh.setFrozenRows(1);
    return;
  }

  const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), header.length))
    .getValues()[0]
    .slice(0, header.length)
    .map(v => String(v || ""));

  const mismatch = existing.some((v, i) => v !== String(header[i]));
  if (mismatch) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
}


// =====================================================
// ===================== COMBINED FINDER ===============
// =====================================================

function CR_RF1_findCombinedByYearMonth_(folderId, year, month) {
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


// =====================================================
// ===================== MONTH FROM A1 =================
// =====================================================

function CR_RF1_readTargetMonthFromA1_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const raw = String(sh.getRange("A1").getDisplayValue() || "").trim();
  if (!raw) throw new Error('CR_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');

  const today = new Date();
  const currentYear = today.getFullYear();

  let m = raw.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const mm = CR_RF1_monthNameToIndex_(m[1]);
    let y = parseInt(m[2], 10); if (y < 100) y += 2000;
    return new Date(y, mm, 1);
  }

  m = raw.match(/^([A-Za-z]+)$/);
  if (m) return new Date(currentYear, CR_RF1_monthNameToIndex_(m[1]), 1);

  m = raw.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);

  const d = new Date(raw);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);

  throw new Error('CR_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');
}

function CR_RF1_monthNameToIndex_(name) {
  const n = String(name || "").toLowerCase().slice(0, 3);
  const map = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  if (!(n in map)) throw new Error("CR_RF1: Unknown month name: " + name);
  return map[n];
}
