
/****************************************************
 * MASTER RUNNER for your 6 codes (with month-row link writeback)
 *
 * What it does:
 * - Runs your selected pipeline steps (toggle via options)
 * - After it finishes, it finds the row on the ACTIVE sheet whose Column A
 *   contains the month from A1 (e.g., "January 2026")
 * - Writes a hyperlink labeled "Disputes Tracker" into Column C of that row
 * - Does NOT write any timestamp/date
 *
 * Assumptions:
 * - A1 contains a month like: "January", "January 2026", "2026-01", "1/2026"
 * - Column A contains the month row label like: "January 2026"
 ****************************************************/

/** Disputes Tracker spreadsheet ID (same as your other scripts) */
const PIPE6_DISPUTES_SHEET_ID = "1DJgNesYSj1hQte64lEJ7UEevRSQlDZx1gNURZ9bwGI4";

/** Where to match + where to write on the runner sheet */
const PIPE6_MONTH_COL = 1;     // Column A has "January 2026"
const PIPE6_LINK_COL  = 3;     // Column C gets hyperlink
const PIPE6_STAMP_COL = null;  // Disable timestamp write

/** Hyperlink label */
const PIPE6_LINK_LABEL = "Disputes Tracker";


function runMonthlyPipeline6(options) {
  const opts = Object.assign({
    runNewAccountsAll: true,
    runZerosChargebacks: false,
    runCanceledMissing: false,
    runChangedRates: false,
    runMonthsHeldNotPaid: false,
    runMonthsHeldPaid: false
  }, options || {});

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("Another run is in progress; exiting.");
    return;
  }

  const startedAt = new Date();
  Logger.log("=== Pipeline6 START ===");

  const results = [];
  try {
    if (opts.runNewAccountsAll) {
      results.push(_runStep6_("NA_RF1_buildNewAccountsAll", NA_RF1_buildNewAccountsAll));
    } else results.push({name:"NA_RF1_buildNewAccountsAll", skipped:true});

    if (opts.runZerosChargebacks) {
      results.push(_runStep6_("ZC_RF1_separateChargebacksAndZerosForSelectedMonth", ZC_RF1_separateChargebacksAndZerosForSelectedMonth));
    } else results.push({name:"ZC_RF1_separateChargebacksAndZerosForSelectedMonth", skipped:true});

    if (opts.runCanceledMissing) {
      results.push(_runStep6_("CM_RF1_copyUnmatchedFromCompKey_ToCanceled_ZMap_NonMRC", CM_RF1_copyUnmatchedFromCompKey_ToCanceled_ZMap_NonMRC));
    } else results.push({name:"CM_RF1_copyUnmatchedFromCompKey_ToCanceled_ZMap_NonMRC", skipped:true});

    if (opts.runChangedRates) {
      results.push(_runStep6_("CR_RF1_flagChangedRatesFromA1", CR_RF1_flagChangedRatesFromA1));
    } else results.push({name:"CR_RF1_flagChangedRatesFromA1", skipped:true});

    if (opts.runMonthsHeldNotPaid) {
      results.push(_runStep6_("ZMHNP_RF1_transferMonthsHeldNotPaid_ALL", ZMHNP_RF1_transferMonthsHeldNotPaid_ALL));
    } else results.push({name:"ZMHNP_RF1_transferMonthsHeldNotPaid_ALL", skipped:true});

    if (opts.runMonthsHeldPaid) {
      results.push(_runStep6_("ZMHP_RF1_copyMonthsHeldPaid_ALL", ZMHP_RF1_copyMonthsHeldPaid_ALL));
    } else results.push({name:"ZMHP_RF1_copyMonthsHeldPaid_ALL", skipped:true});

  } finally {
    lock.releaseLock();
  }

  const totalMs = new Date() - startedAt;
  Logger.log("=== Pipeline6 SUMMARY ===");
  for (const r of results) {
    if (r.skipped) Logger.log(`• ${r.name}: skipped`);
    else if (r.ok) Logger.log(`• ${r.name}: OK in ${_formatDuration6_(r.ms)}`);
    else Logger.log(`• ${r.name}: ERROR in ${_formatDuration6_(r.ms)} — ${r.err}`);
  }
  Logger.log(`=== DONE in ${_formatDuration6_(totalMs)} ===`);

  // ✅ After pipeline completes, write the Disputes Tracker link to Column C
  try {
    PIPE6_writeDisputesTrackerLinkForA1Month_();
    Logger.log("✅ Month row link updated.");
  } catch (e) {
    Logger.log(`⚠️ Month row link writeback failed: ${e && e.message ? e.message : e}`);
  }
}


/* ----------------- helpers ----------------- */

function _runStep6_(name, fn) {
  const t0 = Date.now();
  try {
    if (typeof fn !== "function") throw new Error(`Function not found: ${name}`);
    fn();
    return {name, ok:true, ms: Date.now() - t0};
  } catch (e) {
    Logger.log(`❌ ${name} failed: ${e && e.message ? e.message : e}`);
    return {name, ok:false, ms: Date.now() - t0, err: String(e && e.message ? e.message : e)};
  }
}

function _formatDuration6_(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s  = Math.floor(ms/1000);
  const mm = Math.floor(s/60);
  const ss = s % 60;
  return mm ? `${mm}m ${ss}s` : `${ss}s`;
}


/* ----------------- month-row link writeback ----------------- */

/**
 * Reads month from A1, finds the matching row in column A (e.g. "January 2026"),
 * and writes a hyperlink labeled "Disputes Tracker" into column C of that row.
 */
function PIPE6_writeDisputesTrackerLinkForA1Month_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const rawA1 = String(sh.getRange("A1").getDisplayValue() || "").trim();
  if (!rawA1) throw new Error("PIPE6: A1 is blank.");

  const targetDate = PIPE6_parseMonthFromText_(rawA1);
  if (!(targetDate instanceof Date) || isNaN(targetDate.getTime())) {
    throw new Error(`PIPE6: Could not parse A1 month: "${rawA1}"`);
  }

  const tz = Session.getScriptTimeZone();
  const monthLabel = Utilities.formatDate(targetDate, tz, "MMMM yyyy"); // "January 2026"

  // Scan Column A for a cell that contains that label (case-insensitive)
  const lastRow = sh.getLastRow();
  if (lastRow < 1) throw new Error("PIPE6: Sheet is empty.");

  const colA = sh.getRange(1, PIPE6_MONTH_COL, lastRow, 1).getDisplayValues();
  let hitRow = null;

  const needle = monthLabel.toLowerCase();
  for (let r = 0; r < colA.length; r++) {
    const cell = String(colA[r][0] || "").trim().toLowerCase();
    if (!cell) continue;
    if (cell.includes(needle)) { hitRow = r + 1; break; } // 1-based
  }

  if (!hitRow) {
    throw new Error(`PIPE6: Could not find "${monthLabel}" in column A.`);
  }

  // Build hyperlink formula to Disputes Tracker file
  const disputesUrl = SpreadsheetApp.openById(PIPE6_DISPUTES_SHEET_ID).getUrl();
  const linkFormula = `=HYPERLINK("${String(disputesUrl).replace(/"/g,'""')}","${String(PIPE6_LINK_LABEL).replace(/"/g,'""')}")`;

  // ✅ Write link to Column C ONLY
  sh.getRange(hitRow, PIPE6_LINK_COL).setFormula(linkFormula);

  // Optional timestamp column (disabled)
  if (PIPE6_STAMP_COL && typeof PIPE6_STAMP_COL === "number") {
    sh.getRange(hitRow, PIPE6_STAMP_COL).setValue(new Date());
  }
}


/**
 * Accepts:
 * - "January"
 * - "January 2026"
 * - "2026-01"
 * - "1/2026" or "01/2026"
 * - Any parseable date string
 * Returns Date set to first-of-month.
 */
function PIPE6_parseMonthFromText_(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const now = new Date();
  const currentYear = now.getFullYear();

  // "January 2026"
  let m = s.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const mm = PIPE6_monthNameToIndex_(m[1]);
    let y = parseInt(m[2], 10); if (y < 100) y += 2000;
    return new Date(y, mm, 1);
  }

  // "January"
  m = s.match(/^([A-Za-z]+)$/);
  if (m) {
    return new Date(currentYear, PIPE6_monthNameToIndex_(m[1]), 1);
  }

  // "2026-01" or "2026/1"
  m = s.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = Math.max(1, Math.min(12, parseInt(m[2], 10)));
    return new Date(y, mo - 1, 1);
  }

  // "1/2026" or "01/2026"
  m = s.match(/^(\d{1,2})[-\/](\d{4})$/);
  if (m) {
    const mo = Math.max(1, Math.min(12, parseInt(m[1], 10)));
    const y = parseInt(m[2], 10);
    return new Date(y, mo - 1, 1);
  }

  // Fallback: Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);

  return null;
}

function PIPE6_monthNameToIndex_(name) {
  const n = String(name || "").toLowerCase().slice(0, 3);
  const map = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  if (!(n in map)) throw new Error("PIPE6: Unknown month name: " + name);
  return map[n];
}
