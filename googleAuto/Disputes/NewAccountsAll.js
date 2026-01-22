

/****************************************************
 * NEW ACCOUNTS ALL — Runner-friendly (NA_RF1)
 *
 * Runner-friendly changes:
 * - NO hardcoded Combined SHEET ID.
 * - Finds the Combined spreadsheet for the month in A1 by searching the Combined FOLDER for "YYYY-MM"
 *   and choosing the most recently updated match.
 * - Reads carrier tabs from that Combined file: ["Zayo","Lumen","GoTo","TBO","MetTel","Allstream"].
 * - Still excludes OTG Comp Billing items that exist in Comp Key.
 * - Still dedupes ONLY by full-row signature (meaningful columns only), so multiple occurrences
 *   of the same item/provider can append if other fields differ.
 * - Appends only; never clears/replaces destination.
 *
 * Added (Jan 2026):
 * - Zayo-only state fallback:
 *   If State is missing on the carrier tab row, look at the selected Zayo carrier statement file,
 *   open the "Collection of Commissions" tab, find the row that contains the Account Name,
 *   and read column V. Only use it if it’s a valid US state abbreviation.
 *
 * Hardcoded IDs allowed:
 * - Disputes workbook (destination)
 * - Comp Key workbook
 * - Statements folder (real statements)
 * - Combined folder (monthly combined workbooks)
 ****************************************************/


// ===================== CONFIG (YOU EDIT) =====================

// Comp Key source (used ONLY for exclusion check)
const NA_RF1_COMP_KEY_SHEET_ID     = "10P1ACf1riryneD0zpZT6SRKqcnSHobfEVdAOE-cOPKo";
const NA_RF1_COMP_KEY_TAB_NAME     = "NEW Comp Key";
const NA_RF1_COMP_KEY_ITEM_HEADER  = "OTG Comp Billing item";

// Combined monthly spreadsheets live here (we find the right one by A1 month)
const NA_RF1_COMBINED_FOLDER_ID    = "1fvJKGLOVyo4XJSi4sISvtLxH4YFYkNFk";
const NA_RF1_CARRIER_TABS          = ["Zayo","Lumen","GoTo","TBO","MetTel","Allstream"];

// Destination (Disputes workbook)
const NA_RF1_DEST_SHEET_ID         = "1DJgNesYSj1hQte64lEJ7UEevRSQlDZx1gNURZ9bwGI4";
const NA_RF1_DEST_TAB_NAME         = "New Accounts All";

// Folder containing actual carrier statement files
const NA_RF1_STATEMENTS_FOLDER_ID  = "1JJRszMqel6kWL8CeoVKBCclROSoDfzw_";

// Optional safety
const NA_RF1_STRICT_STOP_IF_EMPTY_COMP_KEY = true;
const NA_RF1_MIN_EXPECTED_COMPKEY_VALUES   = 5;

// Provider → filename needles (lowercase). A file matches if it contains ANY needle.
const NA_RF1_PROVIDER_FILE_NEEDLES = {
  "Zayo":      ["zayo"],
  "Lumen":     ["lumen", "level 3", "level3"],
  "GoTo":      ["goto"],
  "TBO":       ["tbo"],
  "MetTel":    ["mettel", "met tel"],
  "Allstream": ["allstream"]
};

// Also require this phrase in carrier statement filenames:
const NA_RF1_REQUIRED_STATEMENT_PHRASE = "carrier statement";

// Zayo fallback sheet/tab name in the carrier statement spreadsheet
const NA_RF1_ZAYO_COLLECTION_TAB_NAME = "Collection of Commissions";

// =============================================================


// ===================== ENTRYPOINT (RUNNER CALLS THIS) =====================

function NA_RF1_buildNewAccountsAll() {
  // 1) Resolve month from A1 and find the Combined workbook for YYYY-MM
  const targetMonth = NA_RF1_readTargetMonthFromA1_(); // Date normalized to 1st
  const y = targetMonth.getFullYear();
  const m = targetMonth.getMonth() + 1;
  const ym = `${y}-${String(m).padStart(2, "0")}`;

  const combinedFile = NA_RF1_findCombinedByYearMonth_(NA_RF1_COMBINED_FOLDER_ID, y, m);
  if (!combinedFile) throw new Error(`NA_RF1: Could not find Combined workbook for ${ym} in folder.`);
  const combinedSs = SpreadsheetApp.openById(combinedFile.getId());

  // 2) Load Comp Key exclusion set
  const compKey = NA_RF1_loadCompKeySet_();

  // 3) Destination sheet + headers
  const destSh = NA_RF1_getOrCreateSheet_(NA_RF1_DEST_SHEET_ID, NA_RF1_DEST_TAB_NAME);
  NA_RF1_ensureHeaders_(destSh);

  // 4) Existing row signatures for dedupe (meaningful columns only)
  const existingRowSigs = NA_RF1_buildExistingRowSignatureSet_(destSh);

  const tz = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), tz, "M/d/yyyy");

  // 5) Build most-recent statement link + fileId once per provider
  const providerToStmtInfo = NA_RF1_buildProviderStatementInfoMap_();
  const zayoStmtId = providerToStmtInfo["Zayo"] ? (providerToStmtInfo["Zayo"].fileId || "") : "";

  // Cache for Zayo fallback lookups (so we don’t re-scan the statement tab for every row)
  const zayoStateFallbackCache = {
    loaded: false,
    // normalizedAccountName -> stateAbbrev (or "" if not found/valid)
    map: {},
    // keep the loaded sheet values if you want, but map is enough
  };

  // 6) Walk carrier tabs and collect rows to append
  const rowsToAppend = [];
  const seenThisRun = new Set();

  NA_RF1_CARRIER_TABS.forEach(provider => {
    const sh = combinedSs.getSheetByName(provider);
    if (!sh) {
      Logger.log(`NA_RF1: Skipping missing tab "${provider}" in ${combinedFile.getName()}`);
      return;
    }

    const values = sh.getDataRange().getValues();
    if (values.length < 2) return;

    const header = values[0].map(h => String(h || "").trim());
    const rows = values.slice(1);

    const idxState     = NA_RF1_findHeaderIndexExact_(header, ["State"], true);
    const idxAcctNm    = NA_RF1_findHeaderIndexExact_(header, ["Account Name"]);
    const idxAcctNo    = NA_RF1_findHeaderIndexExact_(header, ["Account Number"], true);
    const idxItem      = NA_RF1_findHeaderIndexExact_(header, ["OTG Comp Billing item"]);
    const idxInvTot    = NA_RF1_findHeaderIndexExact_(header, ["Invoice Total"], true);
    const idxCommAmt   = NA_RF1_findHeaderIndexExact_(header, ["Commission Amount"], true);
    const idxBillDesc  = NA_RF1_findHeaderIndexExact_(header, ["Bill Description"], true);
    const idxBillPer   = NA_RF1_findHeaderIndexExact_(header, ["Bill/Invoice Period"], true);

    if (idxAcctNm == null || idxItem == null) {
      Logger.log(`NA_RF1: Tab "${provider}" missing required headers. Found: ${header.join(" | ")}`);
      return;
    }

    const stmtFormula = (providerToStmtInfo[provider] && providerToStmtInfo[provider].formula) ? providerToStmtInfo[provider].formula : "";

    rows.forEach(r => {
      const itemRaw = String(r[idxItem] || "").trim();
      if (!itemRaw) return;

      // Exclusion: already in Comp Key
      if (compKey.has(NA_RF1_normalizeKey_(itemRaw)) || compKey.has(itemRaw.toLowerCase())) return;

      const accountNm  = String(r[idxAcctNm] || "").trim();
      const accountNo  = (idxAcctNo != null) ? String(r[idxAcctNo] || "").trim() : "";

      // State (primary from carrier tab, fallback to first column if no State header)
      let state = (idxState != null) ? String(r[idxState] || "").trim() : String(r[0] || "").trim();

      // Zayo-only fallback: if state is empty (or not a real state abbrev), try statement
      if (provider === "Zayo") {
        // if carrier tab state is missing OR not a valid state abbrev, attempt fallback
        if (!NA_RF1_isUSStateAbbrev_(state)) {
          const fallback = NA_RF1_getZayoStateFallbackFromStatement_(
            accountNm,
            zayoStmtId,
            zayoStateFallbackCache
          );
          if (NA_RF1_isUSStateAbbrev_(fallback)) {
            state = fallback;
          }
        }
      }

      const invoiceTot = (idxInvTot != null)  ? NA_RF1_parseMoney_(r[idxInvTot]) : "";
      const commAmt    = (idxCommAmt != null) ? NA_RF1_parseMoney_(r[idxCommAmt]) : "";

      const billDesc   = (idxBillDesc != null) ? (r[idxBillDesc] || "") : "";
      const billPeriod = (idxBillPer != null)  ? (r[idxBillPer] || "") : "";

      const outRow = [
        state,       // A State
        accountNm,   // B Account Name
        accountNo,   // C Account Number
        itemRaw,     // D OTG Comp Billing item
        "",          // E BLANK
        invoiceTot,  // F Invoice Total
        commAmt,     // G Commission Amount - from Carrier Statement
        provider,    // H Provider
        billDesc,    // I Bill Description
        billPeriod,  // J Bill/Invoice Period
        todayStr,    // K Date added to Disputes
        stmtFormula, // L Associated Carrier Statement
        ""           // M VP NOTES
      ];

      // Dedupe by full row signature (meaningful columns only)
      const sig = NA_RF1_buildRowSignature_(outRow);
      if (!sig) return;

      if (existingRowSigs.has(sig) || seenThisRun.has(sig)) return;

      existingRowSigs.add(sig);
      seenThisRun.add(sig);
      rowsToAppend.push(outRow);
    });
  });

  if (!rowsToAppend.length) {
    SpreadsheetApp.getActive().toast("New Accounts All: nothing new to add.");
    Logger.log("NA_RF1: New Accounts All: nothing new to add.");
    return;
  }

  // 7) Append in one batch
  const startRow = destSh.getLastRow() + 1;
  destSh.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);

  // Formatting: Date column K (11) + currency on F (6) and G (7)
  destSh.getRange(startRow, 11, rowsToAppend.length, 1).setNumberFormat("M/d/yyyy");
  destSh.getRange(startRow, 6,  rowsToAppend.length, 1).setNumberFormat("$#,##0.00");
  destSh.getRange(startRow, 7,  rowsToAppend.length, 1).setNumberFormat("$#,##0.00");

  SpreadsheetApp.getActive().toast(`New Accounts All appended. New rows: ${rowsToAppend.length}`);
  Logger.log(`NA_RF1: New Accounts All appended. New rows: ${rowsToAppend.length} (Combined=${combinedFile.getName()})`);
}



// =====================================================
// =============== ROW SIGNATURE DEDUPE =================
// =====================================================

function NA_RF1_buildExistingRowSignatureSet_(sh) {
  const set = new Set();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return set;

  const width = Math.max(13, sh.getLastColumn());
  const vals = sh.getRange(2, 1, lastRow - 1, width).getValues();
  vals.forEach(r => {
    const row13 = r.slice(0, 13);
    // Normalize money columns if they are strings in existing data
    row13[5] = NA_RF1_parseMoney_(row13[5]); // Invoice Total (F)
    row13[6] = NA_RF1_parseMoney_(row13[6]); // Comm Amount (G)
    const sig = NA_RF1_buildRowSignature_(row13);
    if (sig) set.add(sig);
  });

  return set;
}

/**
 * Signature uses ONLY “meaningful” columns:
 * A State, B Account Name, C Account Number, D OTG Item,
 * F Invoice Total, G Comm Amount, H Provider, I Bill Desc, J Bill Period
 *
 * Ignores:
 * E blank, K date, L statement link, M VP notes
 */
function NA_RF1_buildRowSignature_(row13) {
  if (!row13 || row13.length < 13) return "";

  const state     = String(row13[0] || "").trim();
  const acctName  = String(row13[1] || "").trim();
  const acctNo    = String(row13[2] || "").trim();
  const item      = String(row13[3] || "").trim();
  const invTot    = String(row13[5] === "" ? "" : row13[5]);
  const commAmt   = String(row13[6] === "" ? "" : row13[6]);
  const provider  = String(row13[7] || "").trim();
  const billDesc  = String(row13[8] || "").trim();
  const billPer   = String(row13[9] || "").trim();

  if (!item || !provider) return "";

  return [
    state,
    acctName,
    acctNo,
    NA_RF1_normalizeKey_(item),
    invTot,
    commAmt,
    provider.toUpperCase(),
    billDesc,
    billPer
  ].join("|");
}



// =====================================================
// ============ MOST-RECENT STATEMENT LINKS =============
// =====================================================

/**
 * Returns:
 * {
 *   "Zayo": { formula: '=HYPERLINK("...","...")', fileId: '...', url: '...', name: '...' },
 *   ...
 * }
 *
 * NOTE:
 * - We keep fileId so Zayo can open the statement file for the state fallback.
 */
function NA_RF1_buildProviderStatementInfoMap_() {
  const folder = DriveApp.getFolderById(NA_RF1_STATEMENTS_FOLDER_ID);
  const it = folder.getFiles();

  const files = [];
  while (it.hasNext()) files.push(it.next());

  const requiredPhrase = String(NA_RF1_REQUIRED_STATEMENT_PHRASE || "").toLowerCase();
  const map = {};

  Object.keys(NA_RF1_PROVIDER_FILE_NEEDLES).forEach(provider => {
    const needles = (NA_RF1_PROVIDER_FILE_NEEDLES[provider] || []).map(s => String(s).toLowerCase());

    let bestFile = null;
    let bestTime = 0;

    for (const f of files) {
      const name = String(f.getName() || "");
      const lname = name.toLowerCase();

      if (requiredPhrase && !lname.includes(requiredPhrase)) continue;
      if (lname.includes("combined")) continue;

      let hit = false;
      for (const n of needles) {
        if (n && lname.includes(n)) { hit = true; break; }
      }
      if (!hit) continue;

      const t = f.getLastUpdated ? f.getLastUpdated().getTime() : 0;
      if (!bestFile || t > bestTime) {
        bestFile = f;
        bestTime = t;
      }
    }

    if (bestFile) {
      map[provider] = {
        formula: NA_RF1_makeHyperlinkFormula_(bestFile.getUrl(), bestFile.getName()),
        fileId: bestFile.getId(),
        url: bestFile.getUrl(),
        name: bestFile.getName()
      };
    } else {
      map[provider] = { formula: "", fileId: "", url: "", name: "" };
    }
  });

  return map;
}



// =====================================================
// ================= ZAYO STATE FALLBACK ================
// =====================================================

/**
 * Zayo state fallback:
 * - Open the Zayo carrier statement (Google Sheet)
 * - Read "Collection of Commissions"
 * - Find a row that contains the account name (exact match preferred; substring match fallback)
 * - Return column V only if it’s a valid US state abbreviation
 *
 * Caches results in `cache.map` by normalized account name.
 */
function NA_RF1_getZayoStateFallbackFromStatement_(accountName, statementFileId, cache) {
  const acct = String(accountName || "").trim();
  if (!acct) return "";
  if (!statementFileId) return "";

  const key = NA_RF1_normNameKey_(acct);
  if (!key) return "";

  // If we already looked this account up this run, return cached answer (even if "")
  if (cache && cache.map && Object.prototype.hasOwnProperty.call(cache.map, key)) {
    return cache.map[key] || "";
  }

  // Lazy-load the statement map once (scan sheet and store account->state candidates)
  // This avoids doing an O(rows) scan per account.
  if (cache && !cache.loaded) {
    try {
      NA_RF1_loadZayoCollectionMap_(statementFileId, cache);
    } catch (e) {
      Logger.log("NA_RF1: Zayo state fallback failed to load statement tab. " + e);
      cache.loaded = true; // prevent repeated attempts
    }
  }

  const out = (cache && cache.map) ? (cache.map[key] || "") : "";
  return NA_RF1_isUSStateAbbrev_(out) ? out : "";
}

/**
 * Builds cache.map where key is normalized account name.
 * For each row in Collection of Commissions:
 * - If row contains an account name cell (any cell), we try to map it.
 * - We also support “exact match preferred” later via lookup logic, but we pre-store best effort.
 *
 * Strategy:
 * - We scan each row and attempt to find a cell that looks like an account name:
 *   we don’t know the account-name column, so we match by searching for the account name later.
 * - Instead of guessing the account name column, we build a row index of the row text.
 * - Then for a requested account, we search rows to find a match.
 *
 * Implementation detail:
 * - We store the sheet values and build cache.rowsText[] for fast searching.
 */
function NA_RF1_loadZayoCollectionMap_(statementFileId, cache) {
  const ss = SpreadsheetApp.openById(statementFileId);
  const sh = ss.getSheetByName(NA_RF1_ZAYO_COLLECTION_TAB_NAME);
  if (!sh) throw new Error(`NA_RF1: Zayo statement missing tab "${NA_RF1_ZAYO_COLLECTION_TAB_NAME}".`);

  const vals = sh.getDataRange().getValues();
  if (!vals || vals.length < 2) {
    cache.loaded = true;
    return;
  }

  // Precompute row text (lowercase) for searching
  const rowsText = [];
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i];
    const joined = row.map(c => String(c || "").trim()).join(" | ").toLowerCase();
    rowsText.push(joined);
  }

  cache._zayoVals = vals;
  cache._zayoRowsText = rowsText;
  cache.loaded = true;
}

/**
 * Attempts to find the best row for the accountName and extract col V.
 * We do exact match first (cell equals accountName, case-insensitive).
 * Then substring match (row contains accountName).
 *
 * Because we don’t know the account name column, we search across row cells.
 */
function NA_RF1_findZayoStateFromLoadedCache_(accountName, cache) {
  if (!cache || !cache._zayoVals || !cache._zayoVals.length) return "";

  const acct = String(accountName || "").trim();
  if (!acct) return "";

  const acctLower = acct.toLowerCase();

  const vals = cache._zayoVals;

  // Helper to read Column V (22nd col -> index 21) from a row safely
  const readColV = (row) => {
    const v = (row && row.length >= 22) ? String(row[21] || "").trim() : "";
    return v;
  };

  // 1) Exact cell match anywhere in row (skip header row 0)
  for (let r = 1; r < vals.length; r++) {
    const row = vals[r];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || "").trim();
      if (cell && cell.toLowerCase() === acctLower) {
        const v = readColV(row);
        const cand = String(v || "").trim().toUpperCase();
        return NA_RF1_isUSStateAbbrev_(cand) ? cand : "";
      }
    }
  }

  // 2) Substring match using precomputed row text
  const rowsText = cache._zayoRowsText || [];
  const needle = acctLower;
  for (let r = 1; r < rowsText.length; r++) {
    if (rowsText[r] && rowsText[r].includes(needle)) {
      const v = readColV(vals[r]);
      const cand = String(v || "").trim().toUpperCase();
      return NA_RF1_isUSStateAbbrev_(cand) ? cand : "";
    }
  }

  return "";
}

function NA_RF1_normNameKey_(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\u00A0\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function NA_RF1_isUSStateAbbrev_(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return false;

  // 50 states + DC (no territories unless you want them)
  const STATES = {
    AL:1, AK:1, AZ:1, AR:1, CA:1, CO:1, CT:1, DE:1, FL:1, GA:1,
    HI:1, ID:1, IL:1, IN:1, IA:1, KS:1, KY:1, LA:1, ME:1, MD:1,
    MA:1, MI:1, MN:1, MS:1, MO:1, MT:1, NE:1, NV:1, NH:1, NJ:1,
    NM:1, NY:1, NC:1, ND:1, OH:1, OK:1, OR:1, PA:1, RI:1, SC:1,
    SD:1, TN:1, TX:1, UT:1, VT:1, VA:1, WA:1, WV:1, WI:1, WY:1,
    DC:1
  };
  return !!STATES[s];
}

// Patch: after loading cache, we still need to populate cache.map entries on demand.
// This keeps runtime tight if only a few Zayo rows need fallback.
(function NA_RF1_attachZayoCacheFinder_(){
  // no-op placeholder; leaving as a named IIFE is unnecessary, but kept harmless.
})();

// Override NA_RF1_getZayoStateFallbackFromStatement_ to fill cache.map on-demand
// (kept as same function name; Apps Script uses last definition if duplicated — so DO NOT duplicate).
// Instead: we fill in cache.map in-place below using a helper wrapper:

// (No duplication—just helper used above)
function NA_RF1_getZayoStateFallbackFromStatement_(accountName, statementFileId, cache) {
  const acct = String(accountName || "").trim();
  if (!acct) return "";
  if (!statementFileId) return "";

  const key = NA_RF1_normNameKey_(acct);
  if (!key) return "";

  // already cached
  if (cache && cache.map && Object.prototype.hasOwnProperty.call(cache.map, key)) {
    return cache.map[key] || "";
  }

  // ensure loaded
  if (cache && !cache.loaded) {
    try {
      NA_RF1_loadZayoCollectionMap_(statementFileId, cache);
    } catch (e) {
      Logger.log("NA_RF1: Zayo state fallback failed to load statement tab. " + e);
      cache.loaded = true;
      cache.map[key] = "";
      return "";
    }
  }

  // find and cache
  const found = NA_RF1_findZayoStateFromLoadedCache_(acct, cache);
  cache.map[key] = found || "";
  return cache.map[key] || "";
}



// =====================================================
// ===================== COMP KEY LOAD =================
// =====================================================

function NA_RF1_loadCompKeySet_() {
  const compSS = SpreadsheetApp.openById(NA_RF1_COMP_KEY_SHEET_ID);
  const compSh = compSS.getSheetByName(NA_RF1_COMP_KEY_TAB_NAME);
  if (!compSh) throw new Error("NA_RF1: Missing Comp Key tab: " + NA_RF1_COMP_KEY_TAB_NAME);

  const header = compSh.getRange(1, 1, 1, compSh.getLastColumn()).getValues()[0]
    .map(h => String(h || "").trim());

  const itemColIndex0 = NA_RF1_findPinnedHeaderIndex_(header, NA_RF1_COMP_KEY_ITEM_HEADER);
  if (itemColIndex0 === -1) {
    throw new Error(`NA_RF1: Could not find Comp Key column "${NA_RF1_COMP_KEY_ITEM_HEADER}". Found: ${header.join(" | ")}`);
  }

  const lastRow = compSh.getLastRow();
  const vals = lastRow >= 2
    ? compSh.getRange(2, itemColIndex0 + 1, lastRow - 1, 1).getValues().map(r => r[0])
    : [];

  const set = new Set();
  let countNonEmpty = 0;

  vals.forEach(v => {
    const raw = String(v || "").trim();
    if (!raw) return;
    countNonEmpty++;
    set.add(NA_RF1_normalizeKey_(raw));
    set.add(raw.toLowerCase());
  });

  if (NA_RF1_STRICT_STOP_IF_EMPTY_COMP_KEY && countNonEmpty < NA_RF1_MIN_EXPECTED_COMPKEY_VALUES) {
    throw new Error("NA_RF1: Comp Key appears empty (found " + countNonEmpty + " non-empty values).");
  }

  return set;
}



// =====================================================
// ===================== DEST / HEADERS =================
// =====================================================

function NA_RF1_getOrCreateSheet_(ssId, sheetName) {
  const ss = SpreadsheetApp.openById(ssId);
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  return sh;
}

function NA_RF1_ensureHeaders_(sh) {
  const desired = [
    "State",
    "Account Name",
    "Account Number",
    "OTG Comp Billing item",
    "BLANK",
    "Invoice Total",
    "Commission Amount\n - from Carrier Statement",
    "Provider",
    "Bill Description",
    "Bill/Invoice Period",
    "Date added to Disputes",
    "Associated Carrier Statement",
    "VP NOTES"
  ];

  const lastRow = sh.getLastRow();
  if (lastRow === 0) {
    sh.getRange(1, 1, 1, desired.length).setValues([desired]).setFontWeight("bold");
    sh.setFrozenRows(1);
    return;
  }

  const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), desired.length)).getValues()[0]
    .map(h => String(h || "").trim());

  const mismatch =
    existing.length !== desired.length ||
    desired.some((h, i) => (existing[i] || "") !== h);

  if (mismatch) {
    sh.getRange(1, 1, 1, desired.length).setValues([desired]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
}



// =====================================================
// ===================== COMBINED FILE FINDER =================
// =====================================================

function NA_RF1_findCombinedByYearMonth_(folderId, year, month) {
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
// ===================== MONTH FROM A1 =====================
// =====================================================

function NA_RF1_readTargetMonthFromA1_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const raw = String(sh.getRange("A1").getDisplayValue() || "").trim();
  if (!raw) throw new Error('NA_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');

  const today = new Date();
  const currentYear = today.getFullYear();

  // "October 2025" or "Oct 2025"
  let m = raw.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const mm = NA_RF1_monthNameToIndex_(m[1]);
    let y = parseInt(m[2], 10); if (y < 100) y += 2000;
    return new Date(y, mm, 1);
  }

  // "October"
  m = raw.match(/^([A-Za-z]+)$/);
  if (m) return new Date(currentYear, NA_RF1_monthNameToIndex_(m[1]), 1);

  // "2025-10" or "2025/10"
  m = raw.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);

  // Date parse fallback
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);

  throw new Error('NA_RF1: A1 must contain a valid month (e.g., "October" or "October 2025").');
}

function NA_RF1_monthNameToIndex_(name) {
  const n = String(name || "").toLowerCase().slice(0, 3);
  const map = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  if (!(n in map)) throw new Error("NA_RF1: Unknown month name: " + name);
  return map[n];
}



// =====================================================
// ===================== GENERIC HELPERS =================
// =====================================================

function NA_RF1_findHeaderIndexExact_(headerRow, names, optional) {
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

function NA_RF1_findPinnedHeaderIndex_(headerRow, wantedHeader) {
  const want = String(wantedHeader || "").trim().toLowerCase();
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || "").trim().toLowerCase();
    if (h === want || h.startsWith(want)) return i;
  }
  return -1;
}

function NA_RF1_normalizeKey_(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[\u00A0\u200B]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function NA_RF1_makeHyperlinkFormula_(url, text) {
  const escUrl = String(url).replace(/"/g, '""');
  const escTxt = String(text).replace(/"/g, '""');
  return '=HYPERLINK("' + escUrl + '","' + escTxt + '")';
}

function NA_RF1_parseMoney_(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return v;

  const s0 = String(v).trim();
  if (!s0) return "";

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

  if (!s) return "";

  const n = parseFloat(s);
  if (isNaN(n)) return "";

  return neg ? -Math.abs(n) : n;
}
