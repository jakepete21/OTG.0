
function compareAndCopyWholeRowsInto(srcSs) {
    const MATCHES_TAB = 'Matches';
  
    // Source carrier tabs to scan
    const SOURCE_SHEETS_LOCAL = [
      { name: 'Zayo' },
      { name: 'Lumen' },
      { name: 'GoTo' },
      { name: 'TBO' },
      { name: 'MetTel' },
      { name: 'Allstream' },
    ];
  
    // Split percentages
    const rolePercentageMapLocal = (typeof rolePercentageMap !== 'undefined')
      ? rolePercentageMap
      : {
          RD1:20, RD2:10, RD3:20, RD4:10, RD5:20,
          RM1:20, RM2:10, RM3:20, RM4:10,
          OVR:10,
          HA1:20, HA2:10, HA3:20, HA4:10, HA5:100, HA6:90,
          'RD2-05': 5,
          'RD4-05': 5,
          'RM1-15': 15,
        };
  
    const SPECIAL_ROLE_MAP = {
      'RD2-05': { base: 'RD2', pct: 5 },
      'RD4-05': { base: 'RD4', pct: 5 },
      'RM1-15': { base: 'RM1', pct: 15 },
    };
  
    const MATCH_HEADERS = [
      'State',
      'Account Name',
      'Account Number',
      'OTG Comp Billing item',
      'Invoice Total',
      'Commission Amount',
      'Carrier Statement',
      'Provider',
      'Bill/Invoice Period',
      'Bill Description',
      'RD1',
      'RD2',
      'RD3',
      'RD4',
      'RM1',
      'RM2',
      'RM3',
      'RM4',
      'OVR',
      'RD5',
      'OTG',
      'VP NOTES'
    ];
  
    // Role columns (these are K..U in the output given the header list above)
    const OUT_ROLE_COLS = [
      'RD1','RD2','RD3','RD4',
      'RM1','RM2','RM3','RM4',
      'OVR',
      'RD5',
      'OTG'
    ];
  
    const isHA = (role) => /^HA\d+$/i.test(String(role || '').trim());
  
    if (!TARGET_SPREADSHEET_ID || !TARGET_SHEET_NAME) {
      throw new Error('compareAndCopyWholeRowsInto: TARGET_SPREADSHEET_ID / TARGET_SHEET_NAME not set.');
    }
  
    // --- Load comp key map: BILLING_ITEM -> { codes[], provider, vpNotes }
    const compSs = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    const compMap = buildCompMap_local(compSs, TARGET_SHEET_NAME, true, true);
  
    // --- Create/clear Matches tab
    let matchSheet = srcSs.getSheetByName(MATCHES_TAB);
    if (!matchSheet) matchSheet = srcSs.insertSheet(MATCHES_TAB);
    matchSheet.clearContents();
  
    matchSheet.getRange(1, 1, 1, MATCH_HEADERS.length).setValues([MATCH_HEADERS]);
    matchSheet.setFrozenRows(1);
    matchSheet.getRange(1, 1, 1, MATCH_HEADERS.length).setFontWeight('bold');
  
    const outputRows = [];
  
    // --- helpers for safe cents math
    const toCents = (v) => {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return Math.round(v * 100);
      const s = String(v).replace(/[\$,]/g, '').trim();
      if (!s) return 0;
      const n = parseFloat(s);
      return isNaN(n) ? 0 : Math.round(n * 100);
    };
  
    const centsToNum = (c) => {
      // Return number with 2dp; formatting happens later
      return +(c / 100).toFixed(2);
    };
  
    const isZeroCents = (c) => !c || c === 0;
  
    SOURCE_SHEETS_LOCAL.forEach(cfg => {
      const sh = srcSs.getSheetByName(cfg.name);
      if (!sh) return;
  
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow < 2) return;
  
      const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
      const hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(norm);
      const idx = (name) => hdr.indexOf(norm(name)); // 0-based
  
      const iState       = idx('state');
      const iAcctName    = idx('account name');
      const iAcctNum     = idx('account number');
      const iBillingItem = idx('otg comp billing item');
      const iInvTotal    = idx('invoice total');
      const iCommAmt     = idx('commission amount');
  
      if ([iAcctName, iBillingItem, iInvTotal, iCommAmt].some(v => v === -1)) return;
  
      const iBillPeriod = idx('bill/invoice period');
      const iBillDesc   = idx('bill description');
  
      const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  
      rows.forEach(row => {
        const billingItem = String(row[iBillingItem] || '').trim();
        if (!billingItem) return;
  
        const key = billingItem.toUpperCase();
        const matchData = compMap.get(key);
        if (!matchData || !Array.isArray(matchData.codes) || matchData.codes.length === 0) return;
  
        const state = (iState !== -1) ? row[iState] : '';
        const acctName = (iAcctName !== -1) ? row[iAcctName] : '';
        const acctNum  = (iAcctNum !== -1) ? row[iAcctNum]  : '';
  
        const invoiceTotal   = row[iInvTotal];
        const commissionAmt  = row[iCommAmt];
  
        const carrierStatement = cfg.name;
        let provider = matchData.provider || '';
        const vpNotes = matchData.vpNotes || '';
  
        // Provider override rule: * account on Zayo => ENA
        if (String(acctName || '').startsWith('*') && String(cfg.name).toLowerCase() === 'zayo') {
          provider = 'ENA';
        }
  
        const billPeriod = (iBillPeriod !== -1) ? row[iBillPeriod] : '';
        const billDesc   = (iBillDesc   !== -1) ? row[iBillDesc]   : '';
  
        // ✅ Commission Amount in CENTS (prevents rounding drift)
        const amtCents = toCents(commissionAmt);
  
        // Init all output role cents
        const splitsCents = {};
        OUT_ROLE_COLS.forEach(r => splitsCents[r] = 0);
  
        // ✅ Rule #1: if Commission Amount is 3 cents or less, put it ALL in OTG and skip splits
        if (Math.abs(amtCents) <= 3) {
          splitsCents.OTG = amtCents;
        } else {
          // Compute splits from comp codes, rounding each share to cents
          let allocatedCents = 0;
  
          (matchData.codes || []).forEach(code0 => {
            const raw = String(code0 || '').trim().toUpperCase();
            if (!raw) return;
  
            const special = SPECIAL_ROLE_MAP[raw];
            const roleKey = special ? special.base : raw;
  
            const pct =
              (special && special.pct) ??
              rolePercentageMapLocal[raw] ??
              rolePercentageMapLocal[roleKey] ??
              0;
  
            if (!pct || pct <= 0) return;
  
            // shareCents rounded to nearest cent
            const shareCents = Math.round(amtCents * (pct / 100));
  
            if (!shareCents) return;
            allocatedCents += shareCents;
  
            // Anything HA* goes into OTG
            if (isHA(roleKey)) {
              splitsCents.OTG += shareCents;
              return;
            }
  
            // Only output known roles; otherwise OTG
            if (roleKey in splitsCents) {
              splitsCents[roleKey] += shareCents;
            } else {
              splitsCents.OTG += shareCents;
            }
          });
  
          // ✅ Rule #2 (tie-out): force remainder into OTG so roles sum == commission
          // Remainder is computed against total allocated across all roles INCLUDING OTG shares we already counted above.
          // To be safe, we compute current sum and adjust OTG by the difference.
          const sumNow = OUT_ROLE_COLS.reduce((s, r) => s + (splitsCents[r] || 0), 0);
          const diff = amtCents - sumNow;
          if (diff !== 0) splitsCents.OTG += diff;
        }
  
        // ✅ Final check (header-based concept): ensure sum(K..U) == F in cents; if not, fix OTG
        const finalSum = OUT_ROLE_COLS.reduce((s, r) => s + (splitsCents[r] || 0), 0);
        const finalDiff = amtCents - finalSum;
        if (finalDiff !== 0) {
          // last-resort nudge (should be rare with cents math)
          splitsCents.OTG += finalDiff;
        }
  
        // Build output row
        const out = [];
        out.push(state);
        out.push(acctName);
        out.push(acctNum);
        out.push(billingItem);
        out.push(invoiceTotal);
        out.push(commissionAmt);
        out.push(carrierStatement);
        out.push(provider);
        out.push(billPeriod);
        out.push(billDesc);
  
        // Roles in fixed order: write blanks for 0, numbers otherwise
        OUT_ROLE_COLS.forEach(role => {
          const c = splitsCents[role] || 0;
          out.push(isZeroCents(c) ? '' : centsToNum(c));
        });
  
        out.push(vpNotes);
  
        outputRows.push(out);
      });
    });
  
    if (outputRows.length) {
      matchSheet.getRange(2, 1, outputRows.length, MATCH_HEADERS.length).setValues(outputRows);
    }
  
    Logger.log(`Matches: wrote ${outputRows.length} row(s).`);
    return { wrote: outputRows.length };
  }
  
  
  function buildCompMap_local(compSpreadsheet, tabName, includeProvider, includeVpNotes) {
    const sh = compSpreadsheet.getSheetByName(tabName);
    if (!sh) throw new Error(`buildCompMap_local: comp tab not found: "${tabName}"`);
  
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const H = new Map(headers.map((h, i) => [norm(h), i]));
  
    // Account key header
    const ACCOUNT_HDR = 'OTG COMP BILLING ITEM';
    let colAccount = null;
    for (const [h, i] of H.entries()) {
      if (h === ACCOUNT_HDR || h.startsWith(ACCOUNT_HDR)) { colAccount = i; break; }
    }
    if (colAccount == null) {
      throw new Error(`buildCompMap_local: required header "${ACCOUNT_HDR}" not found.`);
    }
  
    // Provider (optional)
    const colProvider = includeProvider ? (H.get('SERVICE PROVIDER') ?? null) : null;
  
    // VP NOTES (optional)
    const colVpNotes = includeVpNotes
      ? (H.get('VP NOTES') ?? H.get('VP NOTE') ?? H.get('NOTES') ?? null)
      : null;
  
    // COMP 1..4
    const compNames = ['COMP 1', 'COMP 2', 'COMP 3', 'COMP 4'].map(norm);
    const compCols = compNames.map(n => {
      const idx = H.get(n);
      if (idx == null) throw new Error(`buildCompMap_local: required header "${n}" not found.`);
      return idx;
    });
  
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return new Map();
  
    const numRows = lastRow - 1;
  
    const keyVals  = sh.getRange(2, colAccount + 1, numRows, 1).getValues();
    const compVals = sh.getRange(2, compCols[0] + 1, numRows, compCols.length).getValues();
  
    const provVals = (includeProvider && colProvider != null)
      ? sh.getRange(2, colProvider + 1, numRows, 1).getValues()
      : [];
  
    const vpVals = (includeVpNotes && colVpNotes != null)
      ? sh.getRange(2, colVpNotes + 1, numRows, 1).getValues()
      : [];
  
    const out = new Map();
  
    for (let r = 0; r < numRows; r++) {
      const keyRaw = String(keyVals[r][0] || '').trim();
      if (!keyRaw) continue;
  
      const key = keyRaw.toUpperCase();
  
      const codes = compVals[r]
        .map(v => String(v || '').trim().toUpperCase())
        .filter(Boolean);
  
      const provider = (includeProvider && provVals[r] && provVals[r][0] != null)
        ? String(provVals[r][0]).trim()
        : '';
  
      const vpNotes = (includeVpNotes && vpVals[r] && vpVals[r][0] != null)
        ? String(vpVals[r][0]).trim()
        : '';
  
      if (!out.has(key)) {
        out.set(key, { codes, provider, vpNotes });
      } else {
        // prefer non-N/A codes if duplicates exist
        const existing = out.get(key);
        const existingNA = (existing.codes[0] || '') === 'N/A';
        const incomingNA = (codes[0] || '') === 'N/A';
        if (existingNA && !incomingNA) out.set(key, { codes, provider, vpNotes });
      }
    }
  
    return out;
  }
  