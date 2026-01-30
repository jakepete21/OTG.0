import { MatchedRow, SellerStatement, SellerStatementItem } from "../types";

// Statement groups (role groups)
const STATEMENT_GROUPS = [
  { roleGroup: 'RD1/2', roles: ['RD1', 'RD2'] },
  { roleGroup: 'RD3/4', roles: ['RD3', 'RD4'] },
  { roleGroup: 'RM1/2', roles: ['RM1', 'RM2'] },
  { roleGroup: 'RM3/4', roles: ['RM3', 'RM4'] },
  { roleGroup: 'OVR/RD5', roles: ['OVR', 'RD5'] },
  { roleGroup: 'OTG', roles: ['OTG'] },
];

/**
 * Helper to convert value to number
 */
const toNum = (v: any): number => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

/**
 * Aggregates matched rows by OTG Comp Billing item for a specific role group
 */
const summarizeGroup = (
  matchedRows: MatchedRow[],
  groupRoles: string[]
): SellerStatementItem[] => {
  const buckets = new Map<string, SellerStatementItem>();
  const rowCounts = new Map<string, number>(); // Track how many rows aggregate into each bucket
  
  // Track statistics for this group
  let rowsIncluded = 0;
  let rowsExcluded = 0;
  let totalCommissionIncluded = 0;
  let totalCommissionExcluded = 0;

  matchedRows.forEach(row => {
    const billingItem = String(row.otgCompBillingItem || '').trim();
    if (!billingItem) return;

    // Calculate role sum for this group
    let roleSum = 0;
    let anyRoleNonZero = false;

    groupRoles.forEach(roleName => {
      const roleValue = row.roleSplits[roleName as keyof typeof row.roleSplits] || 0;
      roleSum += toNum(roleValue);
      if (toNum(roleValue) !== 0) {
        anyRoleNonZero = true;
      }
    });
    
    // Debug logging for billing item "757355"
    if (billingItem === '757355') {
      console.log(`[757355] In ${groupRoles.join('/')} group - Commission: $${row.commissionAmount}, RD1: $${row.roleSplits.RD1 || 0}, RD2: $${row.roleSplits.RD2 || 0}, OVR: $${row.roleSplits.OVR || 0}, OTG: $${row.roleSplits.OTG || 0}`);
    }

    // Only include rows that actually contribute to this statement group
    if (!anyRoleNonZero) {
      rowsExcluded++;
      totalCommissionExcluded += toNum(row.commissionAmount);
      return;
    }
    
    rowsIncluded++;
    totalCommissionIncluded += toNum(row.commissionAmount);

    // Keep ENA accounts separate so they don't merge with regular accounts for same billing item
    // Aggregate by billing item only (per Google automation: "Group by billing item")
    const isENA = String(row.provider || '').toUpperCase() === 'ENA';
    const key = isENA ? `${billingItem}__ena` : billingItem;

    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        state: row.state || '',
        accountName: row.accountName || '',
        otgCompBillingItem: billingItem,
        otgComp: 0,     // Total Commission Amount
        sellerComp: 0,  // Sum of roles for group
        provider: row.provider || '',
        vpNotes: row.vpNotes || '',
      };
      buckets.set(key, acc);
    }

    // Accumulate - this should aggregate multiple statement rows with same billing item
    acc.otgComp += toNum(row.commissionAmount);
    acc.sellerComp += roleSum;
    
    // Track row count for this bucket
    rowCounts.set(key, (rowCounts.get(key) || 0) + 1);

    // Keep first non-blanks
    if (!acc.state && row.state) acc.state = row.state;
    if (!acc.accountName && row.accountName) acc.accountName = row.accountName;
    if (!acc.provider && row.provider) acc.provider = row.provider;
    if (!acc.vpNotes && row.vpNotes) acc.vpNotes = row.vpNotes;
  });

  // Convert to array and sort
  const list = Array.from(buckets.values())
    .sort((a, b) => {
      const pa = (a.provider || '').toLowerCase();
      const pb = (b.provider || '').toLowerCase();
      if (pa !== pb) return pa < pb ? -1 : 1;
      
      const aa = (a.accountName || '').toLowerCase();
      const ab = (b.accountName || '').toLowerCase();
      if (aa !== ab) return aa < ab ? -1 : 1;
      
      const sa = (a.otgCompBillingItem || '').toLowerCase();
      const sb = (b.otgCompBillingItem || '').toLowerCase();
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });

  // Log top aggregated items (billing items with most rows)
  const topAggregated = Array.from(rowCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({
      billingItem: key.replace('__star', ''),
      rowCount: count,
      otgComp: buckets.get(key)?.otgComp || 0,
    }));
  

  return list;
};

/**
 * Generates seller statements from matched rows
 */
export const generateSellerStatements = (
  matchedRows: MatchedRow[]
): SellerStatement[] => {
  if (!matchedRows || matchedRows.length === 0) {
    // Return empty statements for all groups
    return STATEMENT_GROUPS.map(group => ({
      roleGroup: group.roleGroup,
      items: [],
      totalOtgComp: 0,
      totalSellerComp: 0,
    }));
  }


  const statements: SellerStatement[] = [];

  STATEMENT_GROUPS.forEach(group => {
    const items = summarizeGroup(matchedRows, group.roles);

    // Calculate totals
    const totalOtgComp = items.reduce((sum, item) => sum + item.otgComp, 0);
    const totalSellerComp = items.reduce((sum, item) => sum + item.sellerComp, 0);

    statements.push({
      roleGroup: group.roleGroup,
      items,
      totalOtgComp,
      totalSellerComp,
    });
  });

  // Verify totals
  // NOTE: totalOtgCompAcrossAllGroups will be inflated because the same billing item
  // appears in multiple role groups (each group shows the full commission for items
  // that contribute to that group). This is expected behavior.
  // Instead, we verify that totalSellerCompAcrossAllGroups equals the total commission,
  // since role splits should sum to 100% of the commission.
  const totalOtgCompAcrossAllGroups = statements.reduce((sum, s) => sum + s.totalOtgComp, 0);
  const totalSellerCompAcrossAllGroups = statements.reduce((sum, s) => sum + s.totalSellerComp, 0);
  const totalCommissionFromRows = matchedRows.reduce((sum, r) => sum + (r.commissionAmount || 0), 0);
  const totalRoleSplitsFromRows = matchedRows.reduce((sum, r) => {
    const roleSum = Object.values(r.roleSplits || {}).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
    return sum + roleSum;
  }, 0);
  
  // Log totals for debugging
  console.log(`[generateSellerStatements] Totals verification:`);
  console.log(`  - Total commission from matched rows: $${totalCommissionFromRows.toFixed(2)}`);
  console.log(`  - Total role splits from matched rows: $${totalRoleSplitsFromRows.toFixed(2)}`);
  console.log(`  - Total seller comp across all groups: $${totalSellerCompAcrossAllGroups.toFixed(2)}`);
  console.log(`  - Total OTG comp across all groups: $${totalOtgCompAcrossAllGroups.toFixed(2)}`);
  console.log(`  - Statements breakdown:`, statements.map(s => ({
    roleGroup: s.roleGroup,
    itemsCount: s.items.length,
    totalOtgComp: s.totalOtgComp.toFixed(2),
    totalSellerComp: s.totalSellerComp.toFixed(2),
    // Verify totals match sum of items
    itemsSumOtgComp: s.items.reduce((sum, item) => sum + item.otgComp, 0).toFixed(2),
    itemsSumSellerComp: s.items.reduce((sum, item) => sum + item.sellerComp, 0).toFixed(2),
  })));
  
  // Debug logging for billing item "757355" - check if it appears in RD1/2 statement
  const rd12Statement = statements.find(s => s.roleGroup === 'RD1/2');
  if (rd12Statement) {
    const item757355 = rd12Statement.items.find(item => item.otgCompBillingItem === '757355');
    if (item757355) {
      console.log(`[757355] Found in RD1/2 seller statement - Seller Comp: $${item757355.sellerComp.toFixed(2)}, OTG Comp: $${item757355.otgComp.toFixed(2)}`);
    } else {
      console.log(`[757355] NOT found in RD1/2 seller statement. Checked ${rd12Statement.items.length} items.`);
    }
  }

  return statements;
};
