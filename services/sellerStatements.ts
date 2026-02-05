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

    // OTG group only: never use a positive OTG when commission is negative (OTG must be the remainder)
    const isOTGGroup = groupRoles.length === 1 && groupRoles[0] === 'OTG';
    const roleSumBeforeSafeguard = isOTGGroup && billingItem === '525251' ? roleSum : undefined;
    let safeguardApplied = false;
    if (isOTGGroup && toNum(row.commissionAmount) < 0 && roleSum > 0) {
      const otherRolesCents = Object.entries(row.roleSplits || {}).reduce((s, [k, v]) =>
        k === 'OTG' ? s : s + Math.round(toNum(v) * 100), 0
      );
      const commissionCents = Math.round(toNum(row.commissionAmount) * 100);
      const otgCents = commissionCents - otherRolesCents;
      roleSum = otgCents / 100;
      safeguardApplied = true;
    }
    if (isOTGGroup && billingItem === '525251') {
      console.log('[525251 OTG seller statement] Row:', {
        accountName: row.accountName,
        commissionAmount: row.commissionAmount,
        roleSplits: { ...row.roleSplits },
        roleSumFromSplits: roleSumBeforeSafeguard,
        safeguardApplied,
        roleSumUsed: roleSum,
      });
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
    if (isOTGGroup && billingItem === '525251') {
      console.log('[525251 OTG seller statement] After adding to bucket:', {
        bucketKey: key,
        accountName: acc.accountName,
        otgCompNow: acc.otgComp,
        sellerCompNow: acc.sellerComp,
      });
    }
    
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

  // 525251 OTG only: log final OTG statement item for 525251
  const otgStatement = statements.find(s => s.roleGroup === 'OTG');
  if (otgStatement) {
    const item525251 = otgStatement.items.find(item => item.otgCompBillingItem === '525251');
    if (item525251) {
      console.log('[525251 OTG seller statement] Final item in OTG statement:', {
        accountName: item525251.accountName,
        otgComp: item525251.otgComp,
        sellerComp: item525251.sellerComp,
      });
    }
  }

  return statements;
};
