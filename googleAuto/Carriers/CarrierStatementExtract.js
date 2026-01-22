
/******************* REQUIRED CONSTANTS FOR RUNNER *******************/

// Destination tab names in the new Combined workbook
const DEST_ZAYO_SHEET       = "Zayo";
const DEST_LUMEN_SHEET      = "Lumen";
const DEST_GOTO_SHEET       = "GoTo";
const DEST_TBO_SHEET        = "TBO";
const DEST_METTEL_SHEET     = "MetTel";
const DEST_ALLSTREAM_SHEET  = "Allstream";

// Standard 6-column schema used by most carriers
const STANDARD_HEADERS = [
  "State",
  "Account Name",
  "Account Number",
  "OTG Comp Billing item",
  "Invoice Total",
  "Commission Amount"
];

// GoTo writes 7 columns in your code (includes Type)
const GOTO_HEADERS = [
  "State",
  "Account Name",
  "Account Number",
  "OTG Comp Billing item",
  "Invoice Total",
  "Commission Amount",
  "Type"
];

// Zayo collector I gave you returns 9 columns
const ZAYO_HEADERS = [
  "State",
  "Account Name",
  "Account Number",
  "OTG Comp Billing item",
  "Invoice Total",
  "Commission Amount",
  "Provider",
  "Bill Description",
  "Bill/Invoice Period"
];


/** GoTo: writes rows in this exact schema:
 * [State, Account Name, Account Number, OTG Comp Billing item, Invoice Total, Commission Amount, Type]
 *
 * NOTE: Per your latest instruction, the Data tab NO LONGER reads columns I/J/K for extra totals.
 * It ONLY uses the specific columns described in each collector.
 *
 * ADDITION:
 *  - If OTG Comp Billing item == "CN-568463-1409", subtract 118.29 from Commission Amount
 *    (applies everywhere we compute/pull commission amounts for GoTo).
 */
function processGoToWorkbook(goToFile, destSs) {
  // ---- Config ----
  const DEST_GOTO_SHEET    = 'GoTo';
  const TAB_DATA           = 'Data';       // REQUIRED
  const TAB_EQUIPMENT      = 'Equipment';  // optional
  const TAB_ONETIME        = 'One-Time';   // optional
  const TAB_CANCELED       = 'Canceled';   // optional
  const TAB_ASSIST         = 'Assist';     // optional
  const TAB_CAD            = 'CAD';        // optional
  const TAB_2G             = '2G Energy';  // optional

  const START_ROW_GOTO     = 4; // Data/Equipment start
  const START_ROW_SIMPLE   = 2; // One-Time / Canceled / Assist start

  // ---- Special rule ----
  const SPECIAL_BILLING_ITEM = "CN-568463-1409";
  const SPECIAL_COMMISSION_SUBTRACT = 118.29;

  // ---- Helpers (scoped) ----
  const isBlank = v => String(v == null ? '' : v).trim() === '';
  const toNumber = val => {
    if (val == null || val === '') return 0;
    const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  // Normalize billing item for safe matching
  const normBillingItem = v => String(v == null ? '' : v).trim();

  // Apply the special commission adjustment when applicable
  function applySpecialCommissionAdjustment_(billingItem, commissionVal) {
    const b = normBillingItem(billingItem);
    if (b === SPECIAL_BILLING_ITEM) {
      return toNumber(commissionVal) - SPECIAL_COMMISSION_SUBTRACT;
    }
    return toNumber(commissionVal);
  }

  const getTab = (ss, name) => ss.getSheetByName(name);
  const mustTab = (ss, name) => {
    const sh = ss.getSheetByName(name);
    if (!sh) throw new Error(`GoTo: missing REQUIRED tab "${name}"`);
    return sh;
  };

  // --------------------------
  // Collectors
  // --------------------------

  /** Data (REQUIRED)
   * Source:
   *  - Account Name   = Col C
   *  - OTG Comp Billing item = Col B
   *  - Invoice Total  = Col G
   *  - Commission Amt = Col H
   * Output schema:
   *  [State, Account Name, Account Number(blank), OTG Comp Billing item, Invoice Total, Commission Amount, Type]
   *
   * IMPORTANT: No longer reads columns I/J/K.
   */
  function collectFromData(sh) {
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < START_ROW_GOTO) return { rows: [] };

    const raw = sh.getRange(START_ROW_GOTO, 1, lastRow - START_ROW_GOTO + 1, lastCol).getValues();

    const stopIdx = raw.findIndex(row => String(row[0]).toLowerCase().includes('customer details'));
    const v = (stopIdx >= 0) ? raw.slice(0, stopIdx) : raw;

    const COL_B = 1, COL_C = 2, COL_G = 6, COL_H = 7;
    const out = [];

    v.forEach(row => {
      const compBillingItem = row[COL_B]; // B
      if (String(compBillingItem).toLowerCase().includes('customer totals')) return;

      const acctName   = row[COL_C]; // C
      const invoiceTot = row[COL_G]; // G
      const commAmtRaw = row[COL_H]; // H

      if ([acctName, compBillingItem, invoiceTot, commAmtRaw].every(isBlank)) return;

      const commAmt = applySpecialCommissionAdjustment_(compBillingItem, commAmtRaw);

      const state = getStateForBillingItem_(compBillingItem);
      out.push([state, acctName, '', normBillingItem(compBillingItem), invoiceTot, commAmt, 'GoTo']);
    });

    return { rows: out };
  }

  /** Equipment (optional): group by I; sum F & G; star first A
   * Source:
   *   Account Name   = *A
   *   OTG Comp Billing item = I
   *   Invoice Total  = sum(F)
   *   Commission Amt = sum(G)
   */
  function collectFromEquipment(sh) {
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < START_ROW_GOTO) return [];

    const raw = sh.getRange(START_ROW_GOTO, 1, lastRow - START_ROW_GOTO + 1, lastCol).getValues();

    const IDX_A = 0, IDX_F = 5, IDX_G = 6, IDX_I = 8;
    const grouped = {};

    raw.forEach(row => {
      const compBillingItem = row[IDX_I];
      if (isBlank(compBillingItem)) return;

      const key = normBillingItem(compBillingItem);
      if (!grouped[key]) grouped[key] = { aVal: null, invSum: 0, commSum: 0, billingItem: key };

      if (isBlank(grouped[key].aVal)) grouped[key].aVal = row[IDX_A];
      grouped[key].invSum  += toNumber(row[IDX_F]); // Invoice Total bucket
      grouped[key].commSum += toNumber(row[IDX_G]); // Commission bucket
    });

    return Object.values(grouped).map(data => {
      const acctNameStar = isBlank(data.aVal) ? '' : ('*' + data.aVal);
      const state = getStateForBillingItem_(data.billingItem);

      // Apply special adjustment to the grouped commission total
      const commAdj = applySpecialCommissionAdjustment_(data.billingItem, data.commSum);

      return [state, acctNameStar, '', data.billingItem, data.invSum, commAdj, 'GoTo - Equipment'];
    });
  }

  /** One-Time (optional)
   * Source:
   *   A -> Account Name
   *   B -> OTG Comp Billing item
   *   E -> Invoice Total
   *   I -> Commission Amount
   */
  function collectFromOneTime(sh) {
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < START_ROW_SIMPLE) return [];

    const raw = sh.getRange(START_ROW_SIMPLE, 1, lastRow - 1, lastCol).getValues();

    const IDX_A = 0, IDX_B = 1, IDX_E = 4, IDX_I = 8;
    const out = [];

    raw.forEach(row => {
      const compBillingItem = row[IDX_B];
      if (isBlank(compBillingItem)) return;

      const acctName = row[IDX_A];
      const invTotal = row[IDX_E];
      const commAmtRaw  = row[IDX_I];

      const commAmt = applySpecialCommissionAdjustment_(compBillingItem, commAmtRaw);

      const state = getStateForBillingItem_(compBillingItem);
      out.push([state, acctName, '', normBillingItem(compBillingItem), invTotal, commAmt, 'GoTo - One-Time']);
    });

    return out;
  }

  /** Canceled (optional): swap A<->B; totals blank
   * Source:
   *   A -> OTG Comp Billing item (swapped)
   *   B -> Account Name (swapped)
   */
  function collectFromCanceled(sh) {
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < START_ROW_SIMPLE) return [];

    const raw = sh.getRange(START_ROW_SIMPLE, 1, lastRow - 1, lastCol).getValues();

    const IDX_A = 0, IDX_B = 1;
    const out = [];

    raw.forEach(row => {
      const A = row[IDX_A], B = row[IDX_B];
      if (isBlank(A) && isBlank(B)) return;

      const acctName = B;              // swapped
      const compBillingItem = A;       // swapped
      const state = getStateForBillingItem_(compBillingItem);

      out.push([state, acctName, '', normBillingItem(compBillingItem), '', '', 'GoTo - Canceled']);
    });

    return out;
  }

  /** Assist (optional) (your new mapping)
   * Source:
   *   A -> Account Name
   *   C -> OTG Comp Billing item
   *   E -> Invoice Total
   *   H -> Commission Amount
   * Type = "GoTo (Assist)"
   */
  function collectFromAssist(sh) {
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < START_ROW_SIMPLE) return [];

    const raw = sh.getRange(START_ROW_SIMPLE, 1, lastRow - 1, lastCol).getValues();

    const IDX_A = 0; // Account Name
    const IDX_C = 2; // OTG Comp Billing item
    const IDX_E = 4; // Invoice Total
    const IDX_H = 7; // Commission Amount

    const out = [];

    raw.forEach(row => {
      const acctName = String(row[IDX_A] || '').trim();
      const compBillingItem = String(row[IDX_C] || '').trim();

      if (!acctName && !compBillingItem) return;
      if (!compBillingItem) return;

      const invTotal = row[IDX_E];
      const commAmtRaw  = row[IDX_H];

      const commAmt = applySpecialCommissionAdjustment_(compBillingItem, commAmtRaw);

      const state = getStateForBillingItem_(compBillingItem);
      out.push([state, acctName, '', normBillingItem(compBillingItem), invTotal, commAmt, 'GoTo (Assist)']);
    });

    return out;
  }

  /** Generic top-section scrape: CAD / 2G Energy
   * Source:
   *   C -> Account Name
   *   B -> OTG Comp Billing item
   *   G -> Invoice Total
   *   H -> Commission Amount
   */
  function collectFromTopSection_(sh, sheetLabel) {
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) return [];

    const vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const aCol = vals.map(r => String(r[0] || '').trim().toLowerCase());

    const startA = aCol.findIndex(s => s === 'customer summary');
    if (startA === -1) return [];

    const endA = aCol.findIndex((s, idx) => idx > startA && s === 'customer details');
    const sectionEnd = (endA === -1 ? lastRow - 1 : endA);

    let bStart = -1, bEnd = -1;
    for (let r = startA + 1; r < sectionEnd; r++) {
      const bTxt = String(vals[r][1] || '').trim().toLowerCase();
      if (bStart === -1 && bTxt === 'customer number') bStart = r;
      if (bTxt === 'customer totals - usd') { bEnd = r; break; }
    }
    if (bStart === -1 || bEnd === -1 || bEnd <= bStart) return [];

    const out = [];
    for (let r = bStart + 1; r < bEnd; r++) {
      const compBillingItem = vals[r][1]; // B
      if (isBlank(compBillingItem)) continue;

      const acctName = vals[r][2]; // C
      const invTotal = vals[r][6]; // G
      const commAmtRaw  = vals[r][7]; // H

      if ([acctName, compBillingItem, invTotal, commAmtRaw].every(isBlank)) continue;

      const commAmt = applySpecialCommissionAdjustment_(compBillingItem, commAmtRaw);

      const state = getStateForBillingItem_(compBillingItem);
      out.push([state, acctName, '', normBillingItem(compBillingItem), invTotal, commAmt, `GoTo - ${sheetLabel}`]);
    }
    return out;
  }

  // ---- Open workbook and gather tabs (only Data required) ----
  const wb = SpreadsheetApp.openById(goToFile.getId());
  const shData      = mustTab(wb, TAB_DATA);
  const shEquip     = getTab(wb, TAB_EQUIPMENT);
  const shOneTime   = getTab(wb, TAB_ONETIME);
  const shCanceled  = getTab(wb, TAB_CANCELED);
  const shAssist    = getTab(wb, TAB_ASSIST);
  const shCAD       = getTab(wb, TAB_CAD);
  const sh2G        = getTab(wb, TAB_2G);

  // ---- Collect ----
  const clientsObj = collectFromData(shData);
  const equipment  = shEquip    ? collectFromEquipment(shEquip) : [];
  const onetime    = shOneTime  ? collectFromOneTime(shOneTime) : [];
  const canceled   = shCanceled ? collectFromCanceled(shCanceled) : [];
  const assist     = shAssist   ? collectFromAssist(shAssist) : [];
  const cadRows    = shCAD      ? collectFromTopSection_(shCAD, 'CAD') : [];
  const twoGRows   = sh2G       ? collectFromTopSection_(sh2G, '2G Energy') : [];

  const combined = []
    .concat(clientsObj.rows)
    .concat(equipment)
    .concat(onetime)
    .concat(canceled)
    .concat(assist)
    .concat(cadRows)
    .concat(twoGRows);

  // ---- Write once ----
  // Ensure your GOTO_HEADERS matches:
  // ["State","Account Name","Account Number","OTG Comp Billing item","Invoice Total","Commission Amount","Type"]
  writeToDest(destSs, combined, DEST_GOTO_SHEET, GOTO_HEADERS);

  return {
    clients:      clientsObj.rows.length,
    equipment:    equipment.length,
    oneTime:      onetime.length,
    canceled:     canceled.length,
    assist:       assist.length,
    cad:          cadRows.length,
    twoGEnergy:   twoGRows.length,
    totalWritten: combined.length
  };
}











/** TBO: billingItem = Supplier Account. */
function collectTBORows_fromFile(file) {
  const ss = SpreadsheetApp.openById(file.getId());
  let sh = ss.getSheetByName('Data') || ss.getSheets()[0];

  const grid = sh.getDataRange().getValues();
  if (grid.length < 2) return [];

  const REQUIRED = {
    name: "Customer Business Name",
    account: "Supplier Account",
    bill: "Total Bill",
    commission: "Total Commission"
  };

  const headerPositions = findHeaderPositions_(grid, REQUIRED, 10);
  const nameCol = headerPositions.name.col;
  const acctCol = headerPositions.account.col;
  const billCol = headerPositions.bill.col;
  const commCol = headerPositions.commission.col;

  const headerRow = Math.max(
    headerPositions.name.row,
    headerPositions.account.row,
    headerPositions.bill.row,
    headerPositions.commission.row
  );
  const dataStartRow = headerRow + 1;

  const agg = new Map();

  for (let r = dataStartRow; r < grid.length; r++) {
    const nameVal = String(grid[r][nameCol] || '').trim();
    const acctVal = String(grid[r][acctCol] || '').trim();
    if (!nameVal || !acctVal) continue;

    const billVal = toNumber(grid[r][billCol]);
    const commVal = toNumber(grid[r][commCol]);

    const key = `${nameVal}||${acctVal}`;
    const cur = agg.get(key) || { name: nameVal, acct: acctVal, billSum: 0, commSum: 0 };
    cur.billSum += billVal;
    cur.commSum += commVal;
    agg.set(key, cur);
  }

  const rows = [];
  for (const { name, acct, billSum, commSum } of agg.values()) {
    const billingItem = acct;
    const state = getStateForBillingItem_(billingItem);
    const accountNumber = '';
    rows.push([state, name, accountNumber, billingItem, billSum, commSum]);
  }
  return rows;

  function normalizeHeader(s) {
    return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
  }
  function findHeaderPositions_(grid, requiredMap, maxRowsToScan) {
    const maxR = Math.min(maxRowsToScan, grid.length);
    const needed = Object.fromEntries(Object.keys(requiredMap).map(k => [k, null]));
    const targets = {};
    for (const key in requiredMap) targets[key] = normalizeHeader(requiredMap[key]);

    for (let rr = 0; rr < maxR; rr++) {
      const row = grid[rr];
      for (let cc = 0; cc < row.length; cc++) {
        const h = normalizeHeader(row[cc]);
        if (!h) continue;
        for (const key in targets) {
          if (needed[key] == null && h === targets[key]) needed[key] = { row: rr, col: cc };
        }
      }
      if (Object.values(needed).every(v => v != null)) break;
    }

    const missing = Object.entries(needed).filter(([, pos]) => pos == null).map(([k]) => requiredMap[k]);
    if (missing.length) throw new Error(`TBO: missing header(s): ${missing.join(", ")}`);
    return needed;
  }
}

/** MetTel: billingItem = COL_D */
function collectMetTelRows_fromFile(file) {
  const ss = SpreadsheetApp.openById(file.getId());
  const sh = ss.getSheets()[0];

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  const COL_C = 2, COL_D = 3, COL_N = 13, COL_P = 15;
  const rows = [];

  for (let r = 1; r < data.length; r++) {
    const acctName = data[r][COL_C];
    const billingItem = data[r][COL_D];
    const invoiceTotal = data[r][COL_N];
    const commissionAmount = data[r][COL_P];

    if ([acctName, billingItem, invoiceTotal, commissionAmount].every(isBlank)) continue;
    if (isBlank(billingItem)) continue;

    const state = getStateForBillingItem_(billingItem);
    const accountNumber = '';
    rows.push([state, acctName, accountNumber, billingItem, invoiceTotal, commissionAmount]);
  }
  return rows;
}

// /** Allstream: billingItem = IDX_E */
// function collectAllstreamRows_fromFile(file) {
//   const ss = SpreadsheetApp.openById(file.getId());
//   const sh = ss.getSheetByName('OneTel H R');
//   if (!sh) throw new Error(`Allstream: tab "OneTel H R" not found in ${ss.getName()}`);

//   const START_ROW = 14;
//   const lastRow = sh.getLastRow();
//   const lastCol = sh.getLastColumn();
//   if (lastRow < START_ROW) return [];

//   const rows = sh.getRange(START_ROW, 1, lastRow - START_ROW + 1, lastCol).getValues();

//   const IDX_E = 4;
//   const IDX_F = 5;
//   const IDX_I = 8;
//   const IDX_K = 10;

//   const out = [];

//   for (let i = 0; i < rows.length; i++) {
//     const r = rows[i];
//     if (r.length <= Math.max(IDX_E, IDX_F, IDX_I, IDX_K)) continue;

//     const acctName = r[IDX_F];
//     const billingItem = r[IDX_E];
//     const invoiceTotal = toNumber(r[IDX_I]);
//     const commissionAmount = toNumber(r[IDX_K]);

//     if ([acctName, billingItem, invoiceTotal, commissionAmount].every(isBlank)) continue;
//     if (isBlank(billingItem)) continue;

//     const state = getStateForBillingItem_(billingItem);
//     const accountNumber = '';
//     out.push([state, acctName, accountNumber, billingItem, invoiceTotal, commissionAmount]);
//   }
//   return out;
// }
/** Allstream:
 *  - Always tries to read "OneTel H R" (existing behavior)
 *  - ALSO tries "OneTel H" (if present) and parses NEW SOLD REVENUE / CHANGES & CANCELS / ADJUSTMENTS
 *  - Returns 7 cols: [State, Account Name, Account Number, OTG Comp Billing item, Invoice Total, Commission Amount, Type]
 */
function collectAllstreamRows_fromFile(file) {
  const ss = SpreadsheetApp.openById(file.getId());

  const out = [];

  // -------------------------
  // Part A) Existing "OneTel H R" logic (kept)
  // -------------------------
  const shHR = ss.getSheetByName('OneTel H R');
  if (shHR) {
    const START_ROW = 14;
    const lastRow = shHR.getLastRow();
    const lastCol = shHR.getLastColumn();
    if (lastRow >= START_ROW) {
      const rows = shHR.getRange(START_ROW, 1, lastRow - START_ROW + 1, lastCol).getValues();

      const IDX_E = 4;  // billing item
      const IDX_F = 5;  // account name
      const IDX_I = 8;  // invoice total
      const IDX_K = 10; // commission amount

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.length <= Math.max(IDX_E, IDX_F, IDX_I, IDX_K)) continue;

        const acctName = r[IDX_F];
        const billingItem = r[IDX_E];
        const invoiceTotal = toNumber(r[IDX_I]);
        const commissionAmount = toNumber(r[IDX_K]);

        if ([acctName, billingItem, invoiceTotal, commissionAmount].every(isBlank)) continue;
        if (isBlank(billingItem)) continue;

        const state = getStateForBillingItem_(billingItem);
        const accountNumber = ''; // keep as-is (your old behavior)

        // Type/classification blank for HR rows
        out.push([state, acctName, accountNumber, billingItem, invoiceTotal, commissionAmount, '']);
      }
    }
  }

  // -------------------------
  // Part B) New "OneTel H" parsing (optional)
  // -------------------------
  const shH = ss.getSheetByName('OneTel H');
  if (shH) {
    const grid = shH.getDataRange().getValues();
    if (grid.length) {
      // Parse each requested section
      out.push(...parseAllstreamSection_(grid, 'NEW SOLD REVENUE', 'Total New Sold Revenue'));
      out.push(...parseAllstreamSection_(grid, 'CHANGES & CANCELS', 'Subtotal', { endMarkerColumn: 2 })); // col C = idx 2
      out.push(...parseAllstreamSection_(grid, 'ADJUSTMENTS', 'Subtotal', { endMarkerColumn: 2 }));       // col C = idx 2
    }
  }

  return out;

  // =========================
  // Helpers scoped to Allstream
  // =========================

  /**
   * Parses a section in "OneTel H" tab.
   * @param {any[][]} grid entire sheet values
   * @param {string} startHeader text to find in Column A
   * @param {string} endMarker text that signals the end of section
   * @param {object=} options { endMarkerColumn: number } where 0=A,1=B,2=C... default A
   * @returns {any[][]} rows in 7-col output schema
   */
  function parseAllstreamSection_(grid, startHeader, endMarker, options) {
    const opts = options || {};
    const endCol = (typeof opts.endMarkerColumn === 'number') ? opts.endMarkerColumn : 0;

    const norm = (s) => String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ' ');
    const startNeedle = norm(startHeader);
    const endNeedle = norm(endMarker);

    // 1) Find the section start row by looking in column A
    let startRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const a = norm(grid[r][0]);
      if (a === startNeedle) { startRow = r; break; }
    }
    if (startRow === -1) return [];

    // 2) Walk rows after the header until end marker is found
    const rowsOut = [];
    let currentCategory = ''; // e.g. "Residual Adjustments" -> "Residual Adjustment"

    // Tracks an "active account block" so totals can appear on later line(s)
    let active = null; // { acctNum, acctName, category, lastMoney }

    const flushActive = () => {
      if (!active) return;
      const total = toNumber(active.lastMoney);
      if (!active.acctNum || !active.acctName || !total) { active = null; return; }

      const billingItem = active.acctNum;      // per your requirement
      const acctName = active.acctName;
      const commissionAmount = total;          // per your requirement
      const type = active.category || startHeader; // fallback if we didn’t detect a category

      const state = getStateForBillingItem_(billingItem);
      const accountNumber = ''; // you asked to place acct # into OTG Comp Billing item column

      // Invoice Total blank for this "OneTel H" parse (you only asked for commission)
      rowsOut.push([state, acctName, accountNumber, billingItem, '', commissionAmount, type]);
      active = null;
    };

    const isAccountNumberCell = (v) => /^\d{4,}$/.test(String(v || '').trim()); // 4+ digits
    const extractMoneyFromRow = (row) => {
      // Find the last currency/number-looking token in the entire row
      const text = row.map(c => String(c == null ? '' : c)).join(' ');
      const matches = text.match(/\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g);
      if (!matches || !matches.length) return null;
      return matches[matches.length - 1];
    };

    const cleanAccountName = (raw) => {
      let s = String(raw || '').trim();
      if (!s) return '';

      // Remove parentheses notes
      s = s.replace(/\([^)]*\)/g, '').trim();

      // Common pattern: "Denver Public Library Oct Billing ..." -> want "Denver Public Library"
      // Heuristic: cut at " Oct " if present, else cut at " Billing" if present.
      const octIdx = s.search(/\sOct\s/i);
      if (octIdx > 0) s = s.slice(0, octIdx).trim();

      const billIdx = s.search(/\sBilling/i);
      if (billIdx > 0) s = s.slice(0, billIdx).trim();

      // Collapse whitespace
      s = s.replace(/\s+/g, ' ').trim();
      return s;
    };

    const singularizeCategory = (s) => {
      s = String(s || '').trim();
      if (!s) return '';
      // "Residual Adjustments" -> "Residual Adjustment", "Spiffs" -> "Spiff"
      if (/\bADJUSTMENTS\b/i.test(s) && !/\bRESIDUAL\b/i.test(s)) return 'Adjustment';
      if (s.endsWith('s')) s = s.slice(0, -1);
      return s.trim();
    };

    for (let r = startRow + 1; r < grid.length; r++) {
      const row = grid[r];

      // End marker check (default column A unless overridden)
      const endCell = norm(row[endCol]);
      if (endCell.includes(endNeedle)) {
        flushActive();
        break;
      }

      const colAraw = String(row[0] == null ? '' : row[0]).trim();
      const colAnorm = norm(row[0]);

      // Update category when we see a non-empty text label in column A
      // Skip subtotal-like lines
      const looksLikeSubtotal = /SUBTOTAL/i.test(String(row[0] || '')) || /SUBTOTAL/i.test(String(row[2] || ''));
      if (colAraw && !isAccountNumberCell(colAraw) && !looksLikeSubtotal) {
        // Example: "Residual Adjustments", "Spiffs"
        currentCategory = singularizeCategory(colAraw);
      }

      // Detect a new account row when column A is numeric
      if (isAccountNumberCell(colAraw)) {
        // flush prior account (we are starting a new one)
        flushActive();

        const acctNum = colAraw;

        // Account name could be in B/C/D depending on layout; pick first nonblank among them
        const nameCandidate =
          String(row[1] || '').trim() ||
          String(row[2] || '').trim() ||
          String(row[3] || '').trim() ||
          String(row[4] || '').trim();

        const acctName = cleanAccountName(nameCandidate);

        active = {
          acctNum,
          acctName,
          category: currentCategory || '',
          lastMoney: extractMoneyFromRow(row) // might be null; we’ll keep scanning below
        };

        continue;
      }

      // If we are inside an active account block, keep scanning rows for money
      if (active) {
        const m = extractMoneyFromRow(row);
        if (m) active.lastMoney = m;

        // If we hit a "Residual Adjustment Subtotal" line or similar, flush the account
        // (this helps when the account’s money is confirmed by a subtotal line)
        const rowText = row.map(c => String(c || '')).join(' ').toLowerCase();
        if (rowText.includes('subtotal')) {
          // don’t flush on "Spiff Subtotal $0.00" if that’s clearly not the current acct,
          // but in practice subtotal lines usually occur after the account calc line.
          // We'll flush if we have a money value.
          if (active.lastMoney != null) flushActive();
        }
      }
    }

    // If section ends without explicit end marker
    flushActive();
    return rowsOut;
  }
}



/** =========================
 *  MATCHES + HIGHLIGHT
 *  ========================= */
function findHeaderColumn_(sh, headerName) {
  const lastCol = sh.getLastColumn();
  if (!lastCol) return null;
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h || '').trim().toLowerCase().replace(/\s+/g,' '));
  const idx = headers.indexOf(String(headerName).trim().toLowerCase().replace(/\s+/g,' '));
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

/**
 * Matches tab = carrier rows whose OTG Comp Billing item exists in comp key OTG Comp Billing item.
 * NOTE: For Zayo we still only pull the first 6 cols into Matches (State..Commission)
 */
function compareAndCopyWholeRowsInto(destSs, { keyHeader }) {
  const key = keyHeader || 'OTG Comp Billing item';

  // comp set from comp key sheet
  const compSs = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const compSh = compSs.getSheetByName(TARGET_SHEET_NAME);
  if (!compSh) throw new Error(`compare: comp tab "${TARGET_SHEET_NAME}" not found`);

  const compSet = getColumnValuesByHeaderAsSet_(compSh, key);
  log(`compare: comp set size ${compSet.size}`);

  const sourceTabs = [DEST_ZAYO_SHEET, DEST_LUMEN_SHEET, DEST_GOTO_SHEET, DEST_TBO_SHEET, DEST_METTEL_SHEET, DEST_ALLSTREAM_SHEET]
    .filter(name => !!destSs.getSheetByName(name));

  const matches = [];
  const outHeaders = STANDARD_HEADERS.concat(['Source Tab']);

  sourceTabs.forEach(tab => {
    const sh = destSs.getSheetByName(tab);
    const keyCol = findHeaderColumn_(sh, key);
    if (!keyCol) return;

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) return;

    const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    data.forEach(row => {
      const v = String(row[keyCol - 1] || '').trim();
      if (!v) return;
      if (compSet.has(v)) {
        const six = row.slice(0, 6);
        matches.push(six.concat([tab]));
      }
    });
  });

  writeToDest(destSs, matches, 'Matches', outHeaders);
  log(`compare: wrote matches ${matches.length}`);

  return { wrote: matches.length, tabs: sourceTabs };
}

/** Highlight carrier rows that ARE in comp key but NOT in Matches */
function highlightCompKeyNotMatched_(combinedSs) {
  const LIGHT_RED = '#f4cccc';
  const KEY_HEADER = 'OTG Comp Billing item';

  const compSs = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const compKeySheet = compSs.getSheetByName(TARGET_SHEET_NAME);
  if (!compKeySheet) {
    log('Comp Key sheet not found. Skipping highlight pass.');
    return;
  }

  const compSet = getColumnValuesByHeaderAsSet_(compKeySheet, KEY_HEADER);
  const matchesSheet = combinedSs.getSheetByName('Matches');
  const matchesSet = matchesSheet ? getColumnValuesByHeaderAsSet_(matchesSheet, KEY_HEADER) : new Set();

  const carrierTabs = [DEST_ZAYO_SHEET, DEST_LUMEN_SHEET, DEST_GOTO_SHEET, DEST_TBO_SHEET, DEST_METTEL_SHEET, DEST_ALLSTREAM_SHEET];

  carrierTabs.forEach(tabName => {
    const sh = combinedSs.getSheetByName(tabName);
    if (!sh) return;

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) return;

    const keyCol = findHeaderColumn_(sh, KEY_HEADER);
    if (!keyCol) return;

    const values = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
    const bgRange = sh.getRange(2, 1, lastRow - 1, lastCol);
    const bgs = bgRange.getBackgrounds();

    let changed = false;
    for (let i = 0; i < values.length; i++) {
      const v = String(values[i][0] || '').trim();
      if (!v) continue;
      if (compSet.has(v) && !matchesSet.has(v)) {
        for (let c = 0; c < lastCol; c++) bgs[i][c] = LIGHT_RED;
        changed = true;
      }
    }
    if (changed) bgRange.setBackgrounds(bgs);
  });

  log('Highlight pass complete.');
}

/** =========================
 *  FINAL FORMATTING
 *  ========================= */
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

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h || '').trim().toLowerCase().replace(/\s+/g,' '));

  headerNames.map(h => String(h).trim().toLowerCase().replace(/\s+/g,' '))
    .forEach(name => {
      const idx = headers.indexOf(name);
      if (idx !== -1) sh.getRange(2, idx + 1, lastRow - 1, 1).setNumberFormat('$#,##0.00');
    });
}








/****************************************************
 * MISSING COLLECTORS (drop-in)
 * Provides:
 *  - collectZayoRows_fromFile(file)
 *  - collectLumenRows_fromFile(file)
 *  - collectMetTelRows_fromFile(file)
 *  - collectAllstreamRows_fromFile(file)
 *
 * Designed to be robust if your statement formats vary.
 ****************************************************/

/** ------------ Safe header helpers ------------ */

function _normHdr_(s) {
  return String(s || "")
    .replace(/[\u00A0\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function _findHdrIdx_(headerRow, candidates, optional) {
  const H = headerRow.map(_normHdr_);
  const wants = (candidates || []).map(_normHdr_);

  for (const w of wants) {
    const idx = H.indexOf(w);
    if (idx !== -1) return idx;
    // loose match: startsWith
    for (let i = 0; i < H.length; i++) {
      if (H[i] === w || H[i].startsWith(w)) return i;
    }
  }
  if (optional) return null;
  throw new Error(`Missing required header: ${candidates && candidates[0] ? candidates[0] : "(unknown)"}`);
}

function _toNumMoney_(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (!s) return 0;

  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/\$/g, "")
       .replace(/,/g, "")
       .replace(/\s+/g, "")
       .replace(/[^\d.\-]/g, "");

  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

function _isBlank_(v) {
  return String(v == null ? "" : v).trim() === "";
}

/**
 * Attempts to map a billing item to a State.
 * If you already have getStateForBillingItem_ defined, we use it.
 * Otherwise returns "".
 */
function _stateForBilling_(billingItem) {
  try {
    if (typeof getStateForBillingItem_ === "function") return getStateForBillingItem_(billingItem);
  } catch (e) {}
  return "";
}

/**
 * LUMEN
 * Fixed-column extraction with repeated-header suppression
 *
 * Source columns:
 *   U  -> Account Name
 *   P  -> Account Number
 *   P  -> OTG Comp Billing item
 *   Z  -> Invoice Total
 *   AB -> Commission Amount
 *
 * Output:
 * [State, Account Name, Account Number, OTG Comp Billing item, Invoice Total, Commission Amount]
 */
function collectLumenRows_fromFile(file) {
  const ss = SpreadsheetApp.openById(file.getId());
  const sh = ss.getSheetByName('Sheet1') || ss.getSheets()[0];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const START_ROW = 2;

  // Column indexes (1-based)
  const COL_P  = 16; // Account Number / Billing Item
  const COL_U  = 21; // Account Name
  const COL_Z  = 26; // Invoice Total
  const COL_AB = 28; // Commission Amount

  const numRows = lastRow - START_ROW + 1;

  const acctNumVals  = sh.getRange(START_ROW, COL_P,  numRows, 1).getValues();
  const acctNameVals = sh.getRange(START_ROW, COL_U,  numRows, 1).getValues();
  const invVals      = sh.getRange(START_ROW, COL_Z,  numRows, 1).getValues();
  const commVals     = sh.getRange(START_ROW, COL_AB, numRows, 1).getValues();

  const out = [];

  for (let i = 0; i < numRows; i++) {
    const acctName = String(acctNameVals[i][0] || '').trim();
    const acctNum  = String(acctNumVals[i][0]  || '').trim();
    const billingItem = acctNum;
    const inv = invVals[i][0];
    const com = commVals[i][0];

    // ---- Skip repeated section headers ----
    if (
      /^billing acct name$/i.test(acctName) ||
      /^billing acct nbr$/i.test(acctNum) ||
      /^adjusted compensable revenue$/i.test(String(inv || ''))
    ) {
      continue;
    }

    if (!acctName && !acctNum && isBlank(inv) && isBlank(com)) continue;
    if (!billingItem) continue;

    const state = getStateForBillingItem_(billingItem);

    out.push([
      state,
      acctName,
      acctNum,
      billingItem,
      inv,
      com
    ]);
  }

  return out;
}



/** ------------ ZAYO ------------ */
/**
 * Zayo is often a workbook with "Collection of Commissions".
 * This collector will:
 * - Prefer sheet: "Collection of Commissions"
 * - Look for Paid flag + months + account/billing info if present
 *
 * IMPORTANT:
 * Your runner writes Zayo using ZAYO_HEADERS. If your ZAYO_HEADERS expects 9 columns,
 * ensure this returns that many columns.
 *
 * This implementation returns a "best-effort" Zayo table with the columns:
 * [State, Account Name, Account Number, OTG Comp Billing item, Invoice Total, Commission Amount, Provider, Bill Description, Bill/Invoice Period]
 *
 * If you want a different Zayo schema, tell me your exact ZAYO_HEADERS and I’ll align it.
 */


function collectZayoRows_fromFile(file) {
  const ss = SpreadsheetApp.openById(file.getId());

  // ✅ Prefer EXACT tab name
  const sh = ss.getSheetByName("Collection of Commissions") || ss.getSheets()[0];

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(v => String(v || ""));
  const rows = values.slice(1);

  // Try header-based columns
  const idxState   = _findHdrIdx_(header, ["State", "ST"], true);
  const idxAcct    = _findHdrIdx_(header, ["Account Name", "Customer Name", "Name"], true);
  const idxAcctN   = _findHdrIdx_(header, ["Account Number", "BAN"], true);

  // "Service" / billing item column
  const idxItem    = _findHdrIdx_(header, ["OTG Comp Billing item", "Service Number", "Billing Item", "Service", "Svc Name"], true);

  // ✅ Columns you asked for
  const idxSvcName = _findHdrIdx_(header, ["Svc Name", "Service Name", "Service"], true);
  const idxBAN     = _findHdrIdx_(header, ["Billing Account Number", "BAN", "Billing Acct Nbr", "Billing Account #"], true);

  const idxInv     = _findHdrIdx_(header, ["Invoice Total", "Invoice Amount", "Total Invoice"], true);
  const idxComm    = _findHdrIdx_(header, ["Commission Amount", "Total Commissions", "Commission"], true);
  const idxDesc    = _findHdrIdx_(header, ["Bill Description", "Description"], true);
  const idxPer     = _findHdrIdx_(header, ["Bill/Invoice Period", "Invoice Period", "Reporting Period"], true);
  const idxProv    = _findHdrIdx_(header, ["Provider"], true);

  // Fallbacks for common Zayo combined layout if headers are missing
  const FB = {
    acctName: 11, // L
    item: 12,     // M
    acctNum: 10,  // K
    inv: 31,      // AF
    comm: 32      // AG
  };

  const out = [];

  rows.forEach(r => {
    // Account Name
    let acctName = (idxAcct != null)
      ? String(r[idxAcct] || "").trim()
      : (r.length > FB.acctName ? String(r[FB.acctName] || "").trim() : "");

    // Original billing item candidate
    let itemRaw = (idxItem != null)
      ? String(r[idxItem] || "").trim()
      : (r.length > FB.item ? String(r[FB.item] || "").trim() : "");

    // Account number
    const acctNum = (idxAcctN != null)
      ? String(r[idxAcctN] || "").trim()
      : (r.length > FB.acctNum ? String(r[FB.acctNum] || "").trim() : "");

    // ---- Special ENA rule ----
    const svcNameVal = (idxSvcName != null) ? String(r[idxSvcName] || "").trim() : "";
    const svcNameIsBlank = isBlank(svcNameVal);

    if (svcNameIsBlank) {
      // Pull Billing Account Number into OTG Comp Billing item
      const banVal = (idxBAN != null) ? String(r[idxBAN] || "").trim() : "";
      if (banVal) itemRaw = banVal;

      // Add star to Account Name
      if (acctName && !acctName.startsWith("*")) acctName = "*" + acctName;
    }

    if (!acctName && !itemRaw) return;
    if (!itemRaw) return;

    // Invoice / commission
    const inv = (idxInv != null) ? r[idxInv] : (r.length > FB.inv ? r[FB.inv] : "");
    const com = (idxComm != null) ? r[idxComm] : (r.length > FB.comm ? r[FB.comm] : "");

    // ✅ State ONLY from Comp Key via OTG Comp Billing item (unless the sheet already has a real 2-letter state)
    let state = (idxState != null) ? String(r[idxState] || "").trim() : "";
    if (!/^[A-Z]{2}$/.test(state)) {
      state = getStateForBillingItem_(itemRaw);
    }

    // Provider / desc / period
    let prov = (idxProv != null) ? String(r[idxProv] || "").trim() : "Zayo";
    if (svcNameIsBlank) prov = "ENA"; // ✅ Column K (Provider) for ENA cases

    const desc  = (idxDesc != null) ? (r[idxDesc] || "") : "";
    const per   = (idxPer != null) ? (r[idxPer] || "") : "";

    out.push([
      state,
      acctName,
      acctNum,
      itemRaw,
      _isBlank_(inv) ? "" : _toNumMoney_(inv),
      _isBlank_(com) ? "" : _toNumMoney_(com),
      prov,
      desc,
      per
    ]);
  });

  return out;
}



