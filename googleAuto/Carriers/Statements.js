
/**
 * Build the final statement tabs from the NEW Matches sheet.
 * Groups by "OTG Comp Billing item" and aggregates:
 *  - OTG Comp $    = total Commission Amount   (Seller comp dollars)
 *  - Seller Comp $ = sum of the role(s) for that statement group (e.g., RD1+RD2)
 *
 * Creates these tabs:
 *   RD1/2, RD3/4, RM1/2, RM3/4, OVR/RD5, OTG
 *
 * Returns: { wroteTabs: string[], totalRows: number }
 */
function summarizeFinalStatementsInto(ss) {
    const MATCHES_SHEET_NAME = 'Matches';
    const CLEAR_OLD_TABS = true;
  
    const sh = ss.getSheetByName(MATCHES_SHEET_NAME);
    if (!sh) throw new Error('Missing sheet: ' + MATCHES_SHEET_NAME);
  
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return { wroteTabs: [], totalRows: 0 };
  
    const header = data[0].map(h => String(h || '').trim());
    const rows   = data.slice(1);
  
    const idxMap = indexByHeader_local(header);
    const getIdx = (name) => idxMap.get(String(name).trim().toLowerCase());
  
    // Required columns in NEW Matches
    const COL_STATE       = getIdx('state');
    const COL_ACCT_NAME   = getIdx('account name');
    const COL_BILLINGITEM = getIdx('otg comp billing item');
    const COL_COMM_AMT    = getIdx('commission amount');
    const COL_PROVIDER    = getIdx('provider');
    const COL_VPNOTES     = getIdx('vp notes');
  
    if ([COL_ACCT_NAME, COL_BILLINGITEM, COL_COMM_AMT, COL_PROVIDER].some(x => x == null)) {
      throw new Error(
        'summarizeFinalStatementsInto: Matches is missing required headers. ' +
        'Need at least: State, Account Name, OTG Comp Billing item, Commission Amount, Provider, VP NOTES'
      );
    }
  
    // Role columns (discoverable by header name)
    const roleIndexByName = new Map();
    header.forEach((h, i) => {
      const up = String(h || '').trim().toUpperCase();
      if (up) roleIndexByName.set(up, i);
    });
  
    // Statement groups (no includeCommAmt anymore)
    const GROUPS = [
      { tab: 'RD1/2',   roles: ['RD1','RD2'] },
      { tab: 'RD3/4',   roles: ['RD3','RD4'] },
      { tab: 'RM1/2',   roles: ['RM1','RM2'] },
      { tab: 'RM3/4',   roles: ['RM3','RM4'] },
      { tab: 'OVR/RD5', roles: ['OVR','RD5'] },
      { tab: 'OTG',     roles: ['OTG'] },
    ];
  
    const wroteTabs = [];
    let totalRowsOut = 0;
  
    GROUPS.forEach(group => {
      const { list, count } = summarizeGroup_local(rows, group.roles);
      writeStatementTab_local(ss, group.tab, list, { clear: CLEAR_OLD_TABS });
      wroteTabs.push(group.tab);
      totalRowsOut += count;
    });
  
    SpreadsheetApp.getActive().toast('Done building final statement tabs.');
    return { wroteTabs, totalRows: totalRowsOut };
  
    // ===================== Local helpers =====================
  
    /**
     * Aggregate by OTG Comp Billing item.
     * NEW mapping:
     *  - OTG Comp $    = sum(Commission Amount)
     *  - Seller Comp $ = sum(role cols in group)
     */
    function summarizeGroup_local(allRows, groupRoles) {
      const buckets = new Map();
  
      allRows.forEach((r) => {
        const billingItem = String(r[COL_BILLINGITEM] || '').trim();
        if (!billingItem) return;
  
        const state    = (COL_STATE != null) ? String(r[COL_STATE] || '').trim() : '';
        const acctName = String(r[COL_ACCT_NAME] || '').trim();
        const provider = String(r[COL_PROVIDER] || '').trim();
        const vpNotes  = (COL_VPNOTES != null) ? String(r[COL_VPNOTES] || '').trim() : '';
  
        // total commission amount from Matches
        const commissionAmount = toNum_local(r[COL_COMM_AMT]);
  
        // group role dollars
        let roleSum = 0;
        let anyRoleNonZero = false;
  
        groupRoles.forEach(roleName => {
          const idx = roleIndexByName.get(String(roleName).toUpperCase());
          const v = (idx != null) ? toNum_local(r[idx]) : 0;
          roleSum += v;
          if (v !== 0) anyRoleNonZero = true;
        });
  
        // Only include rows that actually contribute to this statement group
        if (!anyRoleNonZero) return;
  
        // Preserve star behavior: keep * rows separate so they don't merge with non-* for same billing item
        const hasStar = String(acctName || '').includes('*');
        const key = hasStar ? `${billingItem}__star` : billingItem;
  
        let acc = buckets.get(key);
        if (!acc) {
          acc = {
            state: state || '',
            accountName: acctName || '',
            billingItem: billingItem,
            // swapped meanings:
            otgComp: 0,     // will hold total Commission Amount
            sellerComp: 0,  // will hold sum of roles for group
            provider: provider || '',
            vpNotes: vpNotes || ''
          };
          buckets.set(key, acc);
        }
  
        // ✅ swap:
        acc.otgComp    += commissionAmount;
        acc.sellerComp += roleSum;
  
        // keep first nonblanks
        if (!acc.state && state) acc.state = state;
        if (!acc.accountName && acctName) acc.accountName = acctName;
        if (!acc.provider && provider) acc.provider = provider;
        if (!acc.vpNotes && vpNotes) acc.vpNotes = vpNotes;
      });
  
      const list = Array.from(buckets.values())
        .sort((a, b) => {
          const pa = (a.provider || '').toLowerCase();
          const pb = (b.provider || '').toLowerCase();
          if (pa !== pb) return pa < pb ? -1 : 1;
          const aa = (a.accountName || '').toLowerCase();
          const ab = (b.accountName || '').toLowerCase();
          if (aa !== ab) return aa < ab ? -1 : 1;
          const sa = (a.billingItem || '').toLowerCase();
          const sb = (b.billingItem || '').toLowerCase();
          return sa < sb ? -1 : sa > sb ? 1 : 0;
        });
  
      return { list, count: list.length };
    }
  
    /**
     * Writes the statement tab in the requested format (same for ALL tabs):
     *   State | Account Name | OTG Comp Billing item | OTG Comp $ | Seller Comp $ | Provider | VP NOTES
     */
    function writeStatementTab_local(ss, sheetName, list, options) {
      const clear = !!(options && options.clear);
  
      const outName = sanitize_local(sheetName);
      let outSh = ss.getSheetByName(outName);
      if (!outSh) outSh = ss.insertSheet(outName);
      else if (clear) outSh.clearContents();
  
      const headers = [
        'State',
        'Account Name',
        'OTG Comp Billing item',
        'OTG Comp $',
        'Seller Comp $',
        'Provider',
        'VP NOTES'
      ];
  
      outSh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      outSh.setFrozenRows(1);
  
      if (list.length) {
        const rowsOut = list.map(item => ([
          item.state || '',
          item.accountName || '',
          item.billingItem || '',
          round2_(item.otgComp),     // ✅ OTG Comp $ = total Commission Amount
          round2_(item.sellerComp),  // ✅ Seller Comp $ = role sum
          item.provider || '',
          item.vpNotes || ''
        ]));
  
        outSh.getRange(2, 1, rowsOut.length, headers.length).setValues(rowsOut);
  
        // Sort by Provider → Account Name → Billing Item
        outSh.getRange(2, 1, rowsOut.length, headers.length).sort([
          { column: 6, ascending: true }, // Provider
          { column: 2, ascending: true }, // Account Name
          { column: 3, ascending: true }  // Billing item
        ]);
  
        // Totals row
        const lastRow = rowsOut.length + 1;
        const totalRow = lastRow + 2;
  
        outSh.getRange(totalRow, 1).setValue('TOTALS').setFontWeight('bold');
        // OTG Comp $ (col 4)
        outSh.getRange(totalRow, 4).setFormula(`=SUM(D2:D${lastRow})`).setFontWeight('bold');
        // Seller Comp $ (col 5)
        outSh.getRange(totalRow, 5).setFormula(`=SUM(E2:E${lastRow})`).setFontWeight('bold');
  
        // Formatting
        const usedLastRow = totalRow;
        outSh.getRange(1, 1, usedLastRow, headers.length)
          .setFontFamily('Calibri')
          .setFontSize(10)
          .setHorizontalAlignment('left');
  
        // Currency formats
        outSh.getRange(2, 4, lastRow - 1, 2).setNumberFormat('$#,##0.00'); // D & E
        outSh.getRange(totalRow, 4, 1, 2).setNumberFormat('$#,##0.00');
      } else {
        outSh.getRange(1, 1, 1, headers.length)
          .setFontFamily('Calibri')
          .setFontSize(10)
          .setHorizontalAlignment('left');
      }
    }
  
    function indexByHeader_local(headerRow) {
      const map = new Map();
      headerRow.forEach((h, i) => {
        const k = String(h || '').trim().toLowerCase();
        if (k) map.set(k, i);
      });
      return map;
    }
  
    function toNum_local(v) {
      const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? 0 : n;
    }
  
    function round2_(n) {
      return +((+n || 0).toFixed(2));
    }
  
    function sanitize_local(name) {
      return String(name || '')
        // Google Sheets disallows: \ ? * [ ]
        // It DOES allow "/" so we keep it.
        .replace(/[\\\?\*\[\]]/g, '')
        .slice(0, 99) || 'Role';
    }
  }
  