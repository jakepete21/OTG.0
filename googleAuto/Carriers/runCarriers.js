

// Flip any carrier to false to skip it entirely (preflight, processing, formatting)
/** ================= CONFIG ================= */

// Flip any carrier to false to skip it entirely
const ENABLE = {
    GoTo: true,
    Lumen: true,
    MetTel: true,
    TBO: true,
    Zayo: true,
    Allstream: true,
    CompKeyHighlight: true,
  };
  
  /***************** RUNNER ONLY *****************/
  
  function runCarrierStatementPipeline() {
    Logger.clear();
  
    const targetMonth = readTargetMonthFromA1(); // reads A1
    const yyyymm = formatYYYYMM(targetMonth);
  
    // Your offsets mean: look BACK that many months from the target month
    const need = {
      GoTo:      ENABLE.GoTo      ? shiftMonth(targetMonth, -GOTO_OFFSET)       : null,
      Lumen:     ENABLE.Lumen     ? shiftMonth(targetMonth, -LUMEN_OFFSET)      : null,
      MetTel:    ENABLE.MetTel    ? shiftMonth(targetMonth, -METTEL_OFFSET)     : null,
      TBO:       ENABLE.TBO       ? shiftMonth(targetMonth, -TBO_OFFSET)        : null,
      Zayo:      ENABLE.Zayo      ? shiftMonth(targetMonth, -ZAYO_OFFSET)       : null,
      Allstream: ENABLE.Allstream ? shiftMonth(targetMonth, -ALLSTREAM_OFFSET)  : null,
    };
  
    const folder = DriveApp.getFolderById(FOLDER_ID);
  
    // ---- resolve files ----
    const missing = [];
  
    const goToFile      = ENABLE.GoTo      ? findFileByCarrierMonthSafe_(folder, ['GoTo'],  need.GoTo) : null;
    const lumenFile     = ENABLE.Lumen     ? findFileByCarrierMonthSafe_(folder, ['Lumen'], need.Lumen) : null;
    const mettelFile    = ENABLE.MetTel    ? findFileByCarrierMonthSafe_(folder, ['MetTel'], need.MetTel) : null;
    const tboFile       = ENABLE.TBO       ? findFileByCarrierMonthSafe_(folder, ['TBO'],   need.TBO) : null;
    const zayoFile      = ENABLE.Zayo      ? findFileByCarrierMonthSafe_(folder, ['Zayo'],  need.Zayo) : null;
    const allstreamFile = ENABLE.Allstream ? findFileByCarrierMonthSafe_(folder, ['Allstream', 'OneTel H'], need.Allstream) : null;
  
    if (ENABLE.GoTo      && !goToFile)      missing.push(`GoTo (${formatYYYYMM(need.GoTo)})`);
    if (ENABLE.Lumen     && !lumenFile)     missing.push(`Lumen (${formatYYYYMM(need.Lumen)})`);
    if (ENABLE.MetTel    && !mettelFile)    missing.push(`MetTel (${formatYYYYMM(need.MetTel)})`);
    if (ENABLE.TBO       && !tboFile)       missing.push(`TBO (${formatYYYYMM(need.TBO)})`);
    if (ENABLE.Zayo      && !zayoFile)      missing.push(`Zayo (${formatYYYYMM(need.Zayo)})`);
    if (ENABLE.Allstream && !allstreamFile) missing.push(`Allstream (${formatYYYYMM(need.Allstream)})`);
  
    if (missing.length) {
      Logger.log('Missing required statement file(s): ' + missing.join(', '));
      throw new Error('Aborting due to missing files: ' + missing.join(', '));
    }
  
    // ---- create destination spreadsheet ----
    const destName = `COMBINED Carrier Statement ${yyyymm} Seller Statements`;
    const destSs = SpreadsheetApp.create(destName);
    moveFileToFolder_(destSs.getId(), DEST_FOLDER_ID);
  
    // ---- write carriers ----
    // Zayo uses ZAYO_HEADERS (9 cols) and collector returns embedded header row
    if (ENABLE.Zayo) {
      writeToDest(destSs, collectZayoRows_fromFile(zayoFile), DEST_ZAYO_SHEET, ZAYO_HEADERS);
    }
  
    // Others use STANDARD_HEADERS (6 cols)
    if (ENABLE.Lumen)     writeToDest(destSs, collectLumenRows_fromFile(lumenFile), DEST_LUMEN_SHEET, STANDARD_HEADERS);
    if (ENABLE.GoTo)      processGoToWorkbook(goToFile, destSs);
    if (ENABLE.TBO)       writeToDest(destSs, collectTBORows_fromFile(tboFile), DEST_TBO_SHEET, STANDARD_HEADERS);
    if (ENABLE.MetTel)    writeToDest(destSs, collectMetTelRows_fromFile(mettelFile), DEST_METTEL_SHEET, STANDARD_HEADERS);
    if (ENABLE.Allstream) writeToDest(destSs, collectAllstreamRows_fromFile(allstreamFile), DEST_ALLSTREAM_SHEET, STANDARD_HEADERS);
  
    // ---- Matches tab (keys off OTG Comp Billing item) ----
    compareAndCopyWholeRowsInto(destSs, { keyHeader: 'OTG Comp Billing item' });
  
    // ✅ Build RD/RM/OTG statement tabs from Matches
    summarizeFinalStatementsInto(destSs);
  
    // ---- build Deposit Totals ----
    buildDepositTotals_(destSs);
  
    // ---- highlight pass ----
    if (ENABLE.CompKeyHighlight) highlightCompKeyNotMatched_(destSs);
  
    // ---- basic formatting ----
    destSs.getSheets().forEach(sh => {
      setSheetBaseFont_(sh);
      formatCurrencyByHeader_(sh, ['Invoice Total', 'Commission Amount']);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).setFontWeight('bold');
    });
  
    appendToTracker_(targetMonth, destSs);
  
    Logger.log('Created spreadsheet: ' + destSs.getUrl());
  }
  
  
  
  /************* Runner dependencies (helpers) *************/
  
  function findFileByCarrierMonthSafe_(folder, fragments, monthDate) {
    if (!monthDate) return null;
    return findFileByCarrierMonth(folder, fragments, monthDate);
  }
  
  function moveFileToFolder_(fileId, folderId) {
    const f = DriveApp.getFileById(fileId);
    const folder = DriveApp.getFolderById(folderId);
    folder.addFile(f);
    DriveApp.getRootFolder().removeFile(f);
  }
  
  
  /** ================= HELPERS (new) ================= */
  
  /** Compute need{} only for enabled carriers so we never produce undefined months. */
  function makeNeed_(targetMonth) {
    const need = {};
    if (ENABLE.GoTo)      need.GoTo      = shiftMonth(targetMonth, -GOTO_OFFSET);
    if (ENABLE.Lumen)     need.Lumen     = shiftMonth(targetMonth, -LUMEN_OFFSET);
    if (ENABLE.MetTel)    need.MetTel    = shiftMonth(targetMonth, -METTEL_OFFSET);
    if (ENABLE.TBO)       need.TBO       = shiftMonth(targetMonth, -TBO_OFFSET);
    if (ENABLE.Zayo)      need.Zayo      = shiftMonth(targetMonth, -ZAYO_OFFSET);
    if (ENABLE.Allstream) need.Allstream = shiftMonth(targetMonth, -ALLSTREAM_OFFSET);
    return need;
  }
  
  /** Safe wrapper: If monthDate is missing or feature disabled, return null instead of crashing. */
  function findFileByCarrierMonthSafe_(folder, nameFragments, monthDate, opts) {
    if (!monthDate) return null;
    return findFileByCarrierMonth(folder, nameFragments, monthDate, opts);
  }
  
  /** Read the target month from cell A1 of the active sheet. */
  function readTargetMonthFromA1() {
    const sh = SpreadsheetApp.getActiveSheet();
    const v = sh.getRange('A1').getValue();
  
    if (v instanceof Date) {
      return new Date(v.getFullYear(), v.getMonth(), 1);
    }
  
    const raw = String(v || '').trim();
    if (!raw) throw new Error('A1 must contain a month (e.g., "September").');
  
    const mYy = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (mYy) {
      const year  = +mYy[1];
      const month = +mYy[2] - 1;
      return new Date(year, month, 1);
    }
  
    const MONTHS = {
      jan:0, january:0,
      feb:1, february:1,
      mar:2, march:2,
      apr:3, april:3,
      may:4,
      jun:5, june:5,
      jul:6, july:6,
      aug:7, august:7,
      sep:8, sept:8, september:8,
      oct:9, october:9,
      nov:10, november:10,
      dec:11, december:11
    };
  
    const key = raw.toLowerCase();
    if (key in MONTHS) {
      const now = new Date();
      return new Date(now.getFullYear(), MONTHS[key], 1);
    }
  
    const tryDate = new Date(raw);
    if (!isNaN(tryDate)) {
      return new Date(tryDate.getFullYear(), tryDate.getMonth(), 1);
    }
  
    throw new Error('A1 must contain a valid month name (e.g., "September").');
  }
  
  /** Overwrite headers (row 1) on a sheet if it exists; create it if missing. */
  function forceHeadersIfSheetExists_(ss, sheetName, headers) {
    let sh = ss.getSheetByName(sheetName);
    if (!sh) sh = ss.insertSheet(sheetName);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  /** Bold first row and freeze it on all sheets in the spreadsheet. */
  function boldAndFreezeHeaderRow_(ss) {
    ss.getSheets().forEach(sh => {
      const lastCol = Math.max(1, sh.getLastColumn());
      sh.getRange(1, 1, 1, lastCol).setFontWeight('bold');
      sh.setFrozenRows(1);
    });
  }
  
  /** Append the run (month + link) to the local "Tracker" sheet. */
  function appendToTracker_(targetMonth, destSs) {
    const homeSs = SpreadsheetApp.getActive();
    let sh = homeSs.getSheetByName('Tracker');
    if (!sh) sh = homeSs.insertSheet('Tracker');
  
    const monthName = targetMonth.toLocaleString('default', { month: 'long' });
    const yearNum   = targetMonth.getFullYear();
    const label     = `${monthName} ${yearNum}`;
    const url       = destSs.getUrl();
  
    const firstEmptyRow = Math.max(3, sh.getLastRow() + 1);
  
    sh.getRange(firstEmptyRow, 1).setValue(label);
  
    const rich = SpreadsheetApp.newRichTextValue()
      .setText(url)
      .setLinkUrl(url)
      .build();
    sh.getRange(firstEmptyRow, 2).setRichTextValue(rich);
  }
  
  /** ================= FINAL FORMATTING (new) ================= */
  function applyFinalFormatting_(ss, { carriers }) {
    const carrierTabs = [];
    if (carriers.Zayo)      carrierTabs.push('Zayo');
    if (carriers.Lumen)     carrierTabs.push('Lumen');
    if (carriers.MetTel)    carrierTabs.push('MetTel');
    if (carriers.TBO)       carrierTabs.push('TBO');
    if (carriers.GoTo)      carrierTabs.push('GoTo');
    if (carriers.Allstream) carrierTabs.push('Allstream');
  
    const matchesTab = 'Matches';
  
    carrierTabs.forEach(tab => {
      const sh = ss.getSheetByName(tab);
      if (!sh) return;
      setSheetBaseFont_(sh);
      formatCurrencyByHeader_(sh, ['Invoice Total', 'Commission Amount']);
    });
  
    (function(){
      const sh = ss.getSheetByName(matchesTab);
      if (!sh) return;
      setSheetBaseFont_(sh);
      formatCurrencyByHeader_(sh, ['Invoice Total', 'Commission Amount']);
    })();
  
    ss.getSheets().forEach(sh => {
      const name = sh.getName();
      if (/- Statement$/.test(name)) setSheetBaseFont_(sh);
    });
  
    formatDepositTotals_(ss);
  }
  
  function setSheetBaseFont_(sh) {
    const lastRow = Math.max(1, sh.getLastRow());
    const lastCol = Math.max(1, sh.getLastColumn());
    sh.getRange(1, 1, lastRow, lastCol)
      .setFontFamily('Calibri')
      .setFontSize(10)
      .setHorizontalAlignment('left');
  }
  
  function formatCurrencyByHeader_(sh, headerNames) {
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;
  
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim().toLowerCase());
    const wanted = headerNames.map(h => String(h).trim().toLowerCase());
  
    const cols = [];
    wanted.forEach(name => {
      const idx = headers.indexOf(name);
      if (idx !== -1) cols.push(idx + 1);
    });
  
    cols.forEach(c => {
      sh.getRange(2, c, lastRow - 1, 1).setNumberFormat('$#,##0.00');
    });
  }
  
  function formatDepositTotals_(ss) {
    const sh = ss.getSheetByName('Deposit Totals');
    if (!sh) return;
    setSheetBaseFont_(sh);
  
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;
  
    const headersRaw = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const headerNorm = headersRaw.map(h => String(h || '').trim().toLowerCase());
  
    const totalCols = [];
    headerNorm.forEach((h, i) => {
      if (h === 'total' || h.endsWith(' total') || h.includes('total')) totalCols.push(i + 1);
    });
  
    totalCols.forEach(c => {
      sh.getRange(2, c, lastRow - 1, 1).setNumberFormat('$#,##0.00');
    });
  }
  
  
  /** ================= COMP KEY HIGHLIGHT PASS =================
   * UPDATED:
   *  - Uses "OTG Comp Billing item" (not Service Number / col B)
   *  - Compares against Matches using the same header
   */
  function highlightCompKeyNotMatched_(combinedSs) {
    const LIGHT_RED = '#f4cccc';
    const matchesTabName = 'Matches';
    const KEY_HEADER = 'OTG Comp Billing item';
  
    const carrierTabs = [];
    if (ENABLE.Zayo)      carrierTabs.push('Zayo');
    if (ENABLE.Lumen)     carrierTabs.push('Lumen');
    if (ENABLE.GoTo)      carrierTabs.push('GoTo');
    if (ENABLE.TBO)       carrierTabs.push('TBO');
    if (ENABLE.MetTel)    carrierTabs.push('MetTel');
    if (ENABLE.Allstream) carrierTabs.push('Allstream');
  
    const compKeySheet = findSheetByNameInsensitive_(combinedSs, 'Comp Key');
    if (!compKeySheet) {
      log('Comp Key sheet not found. Skipping highlight pass.');
      return;
    }
  
    const compSet = getColumnValuesByHeaderAsSet_(compKeySheet, KEY_HEADER);
    if (!compSet.size) {
      log(`No values found under "${KEY_HEADER}". Skipping highlight pass.`);
      return;
    }
  
    const matchesSheet = combinedSs.getSheetByName(matchesTabName);
    const matchesSet = matchesSheet
      ? getColumnValuesByHeaderAsSet_(matchesSheet, KEY_HEADER)
      : new Set();
  
    carrierTabs.forEach(tabName => {
      const sh = combinedSs.getSheetByName(tabName);
      if (!sh) return;
  
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow < 2) return;
  
      const keyCol = findHeaderColumn_(sh, KEY_HEADER);
      if (!keyCol) {
        log(`Highlight pass: "${KEY_HEADER}" not found on ${tabName}. Skipping.`);
        return;
      }
  
      const values = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
      const bgRange = sh.getRange(2, 1, lastRow - 1, lastCol);
      const currentBgs = bgRange.getBackgrounds();
  
      let changed = false;
  
      for (let i = 0; i < values.length; i++) {
        const v = String(values[i][0] || '').trim();
        if (!v) continue;
  
        const onCompKey = compSet.has(v);
        const onMatches = matchesSet.has(v);
  
        if (onCompKey && !onMatches) {
          for (let c = 0; c < lastCol; c++) currentBgs[i][c] = LIGHT_RED;
          changed = true;
        }
      }
  
      if (changed) {
        bgRange.setBackgrounds(currentBgs);
        log(`Highlight pass done for ${tabName}`);
      }
    });
  }
  
  
  /** ================= HELPER UTILITIES ================= */
  
  function findSheetByNameInsensitive_(ss, name) {
    const lower = name.toLowerCase();
    return ss.getSheets().find(s => s.getName().toLowerCase() === lower) || null;
  }
  
  function findHeaderColumn_(sh, headerName) {
    const lastCol = sh.getLastColumn();
    if (!lastCol) return null;
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(h => String(h || '').trim().toLowerCase());
    const idx = headers.indexOf(String(headerName).trim().toLowerCase());
    return idx === -1 ? null : idx + 1;
  }
  
  function getColumnValuesByHeaderAsSet_(sh, headerName) {
    const col = findHeaderColumn_(sh, headerName);
    if (!col) return new Set();
  
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return new Set();
  
    const vals = sh.getRange(2, col, lastRow - 1, 1).getValues();
    const set = new Set();
    vals.forEach(r => {
      const v = String(r[0] || '').trim();
      if (v) set.add(v);
    });
    return set;
  }
  
  /***********************
   * MISSING SHARED HELPERS
   * (Drop-in block)
   ***********************/
  
  /**
   * Simple logger wrapper used throughout your code.
   * Keeps the old `log()` calls working.
   */
  function log(msg) {
    Logger.log(msg);
  }
  
  /**
   * Shift a date by delta months, normalized to the 1st of month at midnight.
   */
  function shiftMonth(dateObj, deltaMonths) {
    const d = (dateObj instanceof Date) ? new Date(dateObj.getTime()) : new Date(dateObj);
    if (!(d instanceof Date) || isNaN(d.getTime())) throw new Error("shiftMonth: invalid date");
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + Number(deltaMonths || 0));
    return d;
  }
  
  /**
   * Formats a date as YYYY-MM (e.g. 2026-01)
   */
  function formatYYYYMM(dateObj) {
    const d = (dateObj instanceof Date) ? dateObj : new Date(dateObj);
    if (!(d instanceof Date) || isNaN(d.getTime())) throw new Error("formatYYYYMM: invalid date");
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  
  /**
   * Builds a few useful month tokens for file-name matching:
   * - YYYY-MM
   * - YYYYMM
   * - MonthName YYYY (January 2026)
   * - Mon YYYY (Jan 2026)
   */
  function _monthNeedles_(monthDate) {
    const d = (monthDate instanceof Date) ? monthDate : new Date(monthDate);
    if (isNaN(d.getTime())) return [];
    const y = d.getFullYear();
    const m1 = d.getMonth(); // 0-based
  
    const yyyyMm = formatYYYYMM(d);            // 2026-01
    const yyyymm = `${y}${String(m1 + 1).padStart(2, "0")}`; // 202601
  
    const monthLong = d.toLocaleString("default", { month: "long" }); // January
    const monthShort = d.toLocaleString("default", { month: "short" }); // Jan
  
    // Some files use "Jan-2026" or "Jan_2026"
    const longY = `${monthLong} ${y}`;       // January 2026
    const shortY = `${monthShort} ${y}`;     // Jan 2026
    const shortDashY = `${monthShort}-${y}`; // Jan-2026
  
    return [
      yyyyMm,
      yyyymm,
      longY,
      shortY,
      shortDashY
    ].map(s => String(s).toLowerCase());
  }
  
  /**
   * Find a file in a folder for a carrier + month.
   *
   * Looks for:
   * - all fragments (e.g. ["GoTo"] or ["Allstream","OneTel H"])
   * - AND at least one month needle (YYYY-MM, Month YYYY, etc.)
   *
   * Returns the MOST RECENT updated match.
   */
  
  function findFileByCarrierMonth(folder, fragments, monthDate, opts) {
    if (!folder) throw new Error("findFileByCarrierMonth: folder is required");
    if (!monthDate) throw new Error("findFileByCarrierMonth: monthDate is required");
  
    const options = opts || {};
    const requireSheets = (options.requireGoogleSheets !== false);
    const allowAny = !!options.allowAnyMimeType;
  
    const d = (monthDate instanceof Date) ? monthDate : new Date(monthDate);
    if (isNaN(d.getTime())) throw new Error("findFileByCarrierMonth: invalid monthDate");
  
    const year = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyyMm = `${year}-${mm}`;
    const monthLong = d.toLocaleString("default", { month: "long" });
    const monthShort = d.toLocaleString("default", { month: "short" });
  
    const fragNeedles = (fragments || [])
      .map(s => String(s || "").trim().toLowerCase())
      .filter(Boolean);
  
    if (!fragNeedles.length) throw new Error("findFileByCarrierMonth: fragments[] is required");
  
    const isZayo = fragNeedles.some(f => f === "zayo");
  
    // ✅ Zayo-specific statement-month matchers (NOT RCVD)
    const zayoMonthRegexes = isZayo ? [
      new RegExp(`carrier\\s+statement\\s+zayo\\s+${yyyyMm}(\\b|\\D)`, "i"),
      new RegExp(`\\-\\s*zayo\\s+${monthLong}\\s+${year}(\\b|\\D)`, "i"),
      new RegExp(`\\-\\s*zayo\\s+${monthShort}\\s+${year}(\\b|\\D)`, "i")
    ] : null;
  
    // Generic month needles (unchanged behavior for non-Zayo)
    const genericMonthNeedles = _monthNeedles_(d);
  
    const it = folder.getFiles();
    const candidates = [];
  
    while (it.hasNext()) {
      const f = it.next();
  
      if (!allowAny && requireSheets) {
        try {
          if (f.getMimeType && f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
        } catch (e) {}
      }
  
      const name = String(f.getName() || "");
      const lname = name.toLowerCase();
  
      // Must include all fragments
      let ok = true;
      for (const frag of fragNeedles) {
        if (!lname.includes(frag)) { ok = false; break; }
      }
      if (!ok) continue;
  
      // ---- Month matching ----
      let monthOk = false;
  
      if (isZayo) {
        // ✅ Zayo: ONLY match statement month contexts
        monthOk = zayoMonthRegexes.some(re => re.test(name));
      } else {
        // Existing behavior for all other carriers
        for (const n of genericMonthNeedles) {
          if (lname.includes(n)) { monthOk = true; break; }
        }
      }
  
      if (!monthOk) continue;
  
      let ts = 0;
      try { ts = f.getLastUpdated ? f.getLastUpdated().getTime() : 0; } catch (e) {}
      candidates.push({ file: f, ts });
    }
  
    if (!candidates.length) return null;
  
    // Same tie-breaker as before
    candidates.sort((a, b) => b.ts - a.ts);
    return candidates[0].file;
  }
  
  
  /**
   * Write data to a destination spreadsheet tab.
   * - Creates sheet if missing
   * - Overwrites headers row 1
   * - Clears old data rows
   * - Writes new data (starting row 2)
   *
   * NOTE: If the first row of data looks like the header row, it will be dropped.
   */
  function writeToDest(destSs, rows, sheetName, headers) {
    if (!destSs) throw new Error("writeToDest: destSs is required");
    if (!sheetName) throw new Error("writeToDest: sheetName is required");
  
    let sh = destSs.getSheetByName(sheetName);
    if (!sh) sh = destSs.insertSheet(sheetName);
  
    const hdrs = (headers || []).map(h => String(h ?? ""));
    if (!hdrs.length) throw new Error(`writeToDest: headers required for "${sheetName}"`);
  
    // Normalize rows
    let data = Array.isArray(rows) ? rows.slice() : [];
    if (data.length) {
      // If the first row equals the headers (common when a collector returns embedded header row)
      const r0 = data[0].map(v => String(v ?? "").trim());
      const h0 = hdrs.map(v => String(v ?? "").trim());
      const looksLikeHeader = (r0.length >= h0.length) && h0.every((h, i) => r0[i] === h);
      if (looksLikeHeader) data = data.slice(1);
    }
  
    // Clear and write headers
    sh.clearContents();
    sh.getRange(1, 1, 1, hdrs.length).setValues([hdrs]);
  
    if (data.length) {
      // Ensure rectangular
      const width = hdrs.length;
      const out = data.map(r => {
        const row = Array.isArray(r) ? r.slice(0, width) : [];
        while (row.length < width) row.push("");
        return row;
      });
  
      sh.getRange(2, 1, out.length, width).setValues(out);
    }
  
    return sh;
  }
  
  function _toNum_(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v;
    const s = String(v).replace(/,/g, "").replace(/\$/g, "").trim();
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  
  /**
   * Cached lookup for State (ST) by OTG Comp Billing item.
   * Loads Comp Key once per execution.
   */
  function getStateForBillingItem_(billingItem) {
    if (!billingItem) return '';
  
    // Static cache on the function
    if (!getStateForBillingItem_._map) {
      const map = new Map();
  
      const compSs = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
      const compSh = compSs.getSheetByName(TARGET_SHEET_NAME);
      if (!compSh) {
        getStateForBillingItem_._map = map;
        return '';
      }
  
      const lastRow = compSh.getLastRow();
      const lastCol = compSh.getLastColumn();
      if (lastRow < 2) {
        getStateForBillingItem_._map = map;
        return '';
      }
  
      const headers = compSh.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, ' '));
  
      const keyIdx = headers.indexOf('otg comp billing item');
      const stIdx  = headers.indexOf('st');
      if (keyIdx === -1 || stIdx === -1) {
        getStateForBillingItem_._map = map;
        return '';
      }
  
      const data = compSh.getRange(2, 1, lastRow - 1, lastCol).getValues();
      data.forEach(r => {
        const k = String(r[keyIdx] || '').trim();
        if (k) map.set(k, String(r[stIdx] || '').trim());
      });
  
      getStateForBillingItem_._map = map;
    }
  
    const key = String(billingItem).trim();
    return getStateForBillingItem_._map.get(key) || '';
  }
  
  /**
   * Converts currency / numeric-looking values to a Number.
   * Safe for $, commas, parentheses, blanks.
   */
  function toNumber(val) {
    if (val == null || val === '') return 0;
    if (typeof val === 'number') return val;
  
    let s = String(val).trim();
    if (!s) return 0;
  
    let neg = false;
    if (s.startsWith('(') && s.endsWith(')')) {
      neg = true;
      s = s.slice(1, -1);
    }
  
    s = s.replace(/\$/g, '')
         .replace(/,/g, '')
         .replace(/[^\d.\-]/g, '');
  
    const n = parseFloat(s);
    if (isNaN(n)) return 0;
    return neg ? -Math.abs(n) : n;
  }
  
  /**
   * Returns true if value is null, undefined, or empty after trim.
   */
  function isBlank(v) {
    return String(v == null ? '' : v).trim() === '';
  }
  
  