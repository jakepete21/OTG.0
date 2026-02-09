import { MasterRecord, CarrierStatementRow, MatchedRow, RoleSplits } from "../types";
import { getStateForBillingItem } from "./stateLookup";

// Role percentage map (from Google Apps Script)
const ROLE_PERCENTAGE_MAP: Record<string, number> = {
  RD1: 20,
  RD2: 10,
  RD3: 20,
  RD4: 10,
  RD5: 20,
  RM1: 20,
  RM2: 10,
  RM3: 20,
  RM4: 10,
  OVR: 10,
  HA1: 20,
  HA2: 10,
  HA3: 20,
  HA4: 10,
  HA5: 100,
  HA6: 90,
  'RD2-05': 5,
  'RD4-05': 5,
  'RM1-15': 15,
};

// Special role mappings
const SPECIAL_ROLE_MAP: Record<string, { base: string; pct: number }> = {
  'RD2-05': { base: 'RD2', pct: 5 },
  'RD4-05': { base: 'RD4', pct: 5 },
  'RM1-15': { base: 'RM1', pct: 15 },
};

/**
 * Normalizes a string for matching (uppercase, trim, remove extra spaces)
 */
const normalizeKey = (s: string): string => {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
};

/**
 * Checks if a role is HA* pattern
 */
const isHA = (role: string): boolean => {
  return /^HA\d+$/i.test(String(role || '').trim());
};

/**
 * Checks if a value is a valid role code
 */
const isValidRoleCode = (value: string): boolean => {
  if (!value || typeof value !== 'string') return false;
  const upper = value.trim().toUpperCase();
  
  // Skip empty, N/A, and descriptive text values
  if (!upper || upper === 'N/A' || upper === 'NOT ON OG COMP KEY' || 
      upper.includes('NOT ON') || upper.includes('MISSING') ||
      upper.length > 20) { // Role codes are short (RD1, OVR, etc.)
    return false;
  }
  
  // Check if it's in the role percentage map
  if (ROLE_PERCENTAGE_MAP[upper]) return true;
  
  // Check if it matches HA pattern
  if (isHA(upper)) return true;
  
  // Check if it matches OTG pattern (OTG, OTG.0-ZF, etc.)
  if (/^OTG/i.test(upper)) return true;
  
  return false;
};

/**
 * Converts value to cents (prevents rounding drift)
 */
/**
 * Helper to convert value to number
 */
const toNum = (v: any): number => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

const toCents = (v: any): number => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100);
  const s = String(v).replace(/[\$,]/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100);
};

/**
 * Converts cents to number with 2 decimal places
 */
const centsToNum = (c: number): number => {
  return +(c / 100).toFixed(2);
};

/**
 * Builds a map of OTG Comp Billing item -> MasterRecord data
 * Now stores ALL records for each billing item to handle duplicates
 */
const buildCompMap = (masterData: MasterRecord[]): Map<string, {
  masterRecord: MasterRecord;
  codes: string[];
  provider?: string;
  vpNotes?: string;
}[]> => {
  const map = new Map();

  masterData.forEach(record => {
    // Get OTG Comp Billing item from master record
    // It might be in a custom column, so check common field names
    const billingItem = record['OTG Comp Billing item'] || 
                       record['OTG Comp Billing Item'] ||
                       record['otgCompBillingItem'] ||
                       record.serviceType || // Fallback
                       '';

    if (!billingItem) return;

    const key = normalizeKey(billingItem);

    // Extract COMP 1-4 roles
    const codes: string[] = [];
    for (let i = 1; i <= 4; i++) {
      // Try multiple variations of COMP field names, prioritizing regular COMP fields
      // Check regular COMP fields first
      let compField = record[`COMP ${i}`] || 
                      record[`Comp ${i}`] || 
                      record[`COMP${i}`] ||
                      record[`Comp${i}`] ||
                      record[`COMP-${i}`] ||
                      record[`Comp-${i}`] ||
                      '';
      
      // COMP 1 is always considered valid if it has a value (bypasses isValidRoleCode check)
      // For COMP 2-4, only use "before 07/2025" variant if regular COMP field is empty or invalid
      if (i === 1) {
        // COMP 1: always add if it has a non-empty value (skip isValidRoleCode validation)
        // Do NOT check "before 07/2025 COMP 1" - user wants it ignored
        if (compField && String(compField).trim() !== '' && String(compField).trim().toUpperCase() !== 'N/A') {
          const compFieldStr = String(compField).trim();
          const compFieldUpper = compFieldStr.toUpperCase();
          codes.push(compFieldUpper);
        }
      } else {
        // For COMP 2-4: only use "before 07/2025" variant if regular COMP field is empty or invalid
        if (!compField || !isValidRoleCode(String(compField))) {
          const beforeField = record[`before 07/2025 COMP ${i}`] ||
                             record[`before 07/2025 Comp ${i}`] ||
                             '';
          // Use before field only if it's a valid role code
          if (beforeField && isValidRoleCode(String(beforeField))) {
            compField = beforeField;
          }
        }
        
        const compFieldStr = String(compField).trim();
        const compFieldUpper = compFieldStr.toUpperCase();
        
        // Only add valid role codes for COMP 2-4
        if (isValidRoleCode(compFieldStr)) {
          codes.push(compFieldUpper);
        }
      }
    }

    // Get provider and VP notes
    const provider = record['Service Provider'] || record['serviceProvider'] || '';
    const vpNotes = record['VP NOTES'] || record['VP NOTE'] || record['NOTES'] || '';
    const accountName = record.clientName || record['Account **CARRIER**'] || '';

    const recordData = {
      masterRecord: record,
      codes,
      provider: String(provider).trim(),
      vpNotes: String(vpNotes).trim(),
      accountName: String(accountName).trim(),
    };

    // Store all records for this billing item (handle duplicates)
    if (!map.has(key)) {
      map.set(key, [recordData]);
    } else {
      map.get(key)!.push(recordData);
    }
  });

  return map;
};

/** True if this candidate has at least one valid role code (splits listed) */
const hasValidSplits = (codes: string[]): boolean => {
  if (!codes || codes.length === 0) return false;
  return codes.some(c => c && String(c).trim() !== '' && String(c).trim().toUpperCase() !== 'N/A');
};

/**
 * Finds the best matching Master Data record from a list of candidates
 * Uses account name matching if available (e.g. ZNS vs non-ZNS by name).
 * When multiple candidates exist and only some have splits listed, prefer the one with splits.
 */
const findBestMatch = (
  candidates: Array<{
    masterRecord: MasterRecord;
    codes: string[];
    provider?: string;
    vpNotes?: string;
    accountName: string;
  }>,
  statementRow: CarrierStatementRow
): {
  masterRecord: MasterRecord;
  codes: string[];
  provider?: string;
  vpNotes?: string;
} | null => {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  // When multiple candidates and only some have splits, prefer those with splits
  if (candidates.length > 1) {
    const withSplits = candidates.filter(c => hasValidSplits(c.codes));
    if (withSplits.length > 0 && withSplits.length < candidates.length) {
      candidates = withSplits;
    }
  }

  // If only one candidate, use it
  if (candidates.length === 1) {
    const candidate = candidates[0];
    return {
      masterRecord: candidate.masterRecord,
      codes: candidate.codes,
      provider: candidate.provider,
      vpNotes: candidate.vpNotes,
    };
  }

  // Try to match by account name (normalized)
  const statementAccountName = normalizeKey(statementRow.accountName || '');
  
  if (statementAccountName) {
    // Find exact account name match
    const exactMatch = candidates.find(c => 
      normalizeKey(c.accountName) === statementAccountName
    );
    if (exactMatch) {
      return {
        masterRecord: exactMatch.masterRecord,
        codes: exactMatch.codes,
        provider: exactMatch.provider,
        vpNotes: exactMatch.vpNotes,
      };
    }

    // Find partial account name match
    const partialMatch = candidates.find(c => {
      const masterAccount = normalizeKey(c.accountName);
      return masterAccount && statementAccountName.includes(masterAccount) || 
             masterAccount.includes(statementAccountName);
    });
    if (partialMatch) {
      return {
        masterRecord: partialMatch.masterRecord,
        codes: partialMatch.codes,
        provider: partialMatch.provider,
        vpNotes: partialMatch.vpNotes,
      };
    }
  }

  // Prefer records with non-N/A codes
  const nonNAMatch = candidates.find(c => 
    c.codes.length > 0 && c.codes[0] !== 'N/A'
  );
  if (nonNAMatch) {
    return {
      masterRecord: nonNAMatch.masterRecord,
      codes: nonNAMatch.codes,
      provider: nonNAMatch.provider,
      vpNotes: nonNAMatch.vpNotes,
    };
  }

  // Fallback: use first candidate
  const first = candidates[0];
  return {
    masterRecord: first.masterRecord,
    codes: first.codes,
    provider: first.provider,
    vpNotes: first.vpNotes,
  };
};

/**
 * Calculates role splits for a commission amount
 */
const calculateRoleSplits = (
  commissionAmount: number,
  codes: string[],
  debugBillingItem?: string
): RoleSplits => {
  const splits: RoleSplits = {
    RD1: 0, RD2: 0, RD3: 0, RD4: 0,
    RM1: 0, RM2: 0, RM3: 0, RM4: 0,
    OVR: 0, RD5: 0,
    HA1: 0, HA2: 0, HA3: 0, HA4: 0, HA5: 0, HA6: 0,
    OTG: 0,
  };

  const amtCents = toCents(commissionAmount);

  // Rule #1: If commission is 3 cents or less, put it ALL in OTG
  if (Math.abs(amtCents) <= 3) {
    splits.OTG = centsToNum(amtCents);
    return splits;
  }

  // Compute splits from comp codes
  let allocatedCents = 0;
  

  codes.forEach(code0 => {
    const raw = String(code0 || '').trim().toUpperCase();
    if (!raw) return;

    const special = SPECIAL_ROLE_MAP[raw];
    const roleKey = special ? special.base : raw;

    // OTG / OTG.0-ZF etc. must never get a percentage in the loop — OTG is always the remainder (Rule #2)
    if (/^OTG/i.test(roleKey)) {
      return;
    }

    const pct = special?.pct ?? ROLE_PERCENTAGE_MAP[raw] ?? ROLE_PERCENTAGE_MAP[roleKey] ?? 0;
    

    if (!pct || pct <= 0) {
      return;
    }

    // Share rounded to nearest cent
    const shareCents = Math.round(amtCents * (pct / 100));

    if (!shareCents) return;
    allocatedCents += shareCents;

    // Handle HA* roles
    if (isHA(roleKey)) {
      // HA1, HA2, HA3, HA4: ignore — do not allocate to HA or OTG here; remainder will go to OTG (Rule #2)
      if (roleKey === 'HA1' || roleKey === 'HA2' || roleKey === 'HA3' || roleKey === 'HA4') {
        return;
      }
      // HA5, HA6: aggregate into OTG seller statement only. Add share to OTG only (do not also
      // add to HA5/HA6) so we don't double-count and the remainder step gives correct OTG.
      const currentOtgCents = toCents(splits.OTG || 0);
      splits.OTG = centsToNum(currentOtgCents + shareCents);
      return;
    }

    // Only output known roles; otherwise OTG
    if (roleKey in splits) {
      const currentCents = toCents(splits[roleKey as keyof RoleSplits] || 0);
      splits[roleKey as keyof RoleSplits] = centsToNum(currentCents + shareCents);
    } else {
      const currentOtgCents = toCents(splits.OTG || 0);
      splits.OTG = centsToNum(currentOtgCents + shareCents);
    }
  });

  // Rule #2: Force remainder into OTG so roles sum == commission
  const sumNow = Object.values(splits).reduce((s, v) => s + toCents(v || 0), 0);
  const diff = amtCents - sumNow;
  if (diff !== 0) {
    const currentOtgCents = toCents(splits.OTG || 0);
    splits.OTG = centsToNum(currentOtgCents + diff);
  }

  // Final check: ensure sum equals commission (fix rounding)
  const finalSum = Object.values(splits).reduce((s, v) => s + toCents(v || 0), 0);
  const finalDiff = amtCents - finalSum;
  if (finalDiff !== 0) {
    const currentOtgCents = toCents(splits.OTG || 0);
    splits.OTG = centsToNum(currentOtgCents + finalDiff);
  }

  // Safeguard: for negative commission, OTG must be the remainder (never positive, never 10% of |amount|)
  if (amtCents < 0) {
    const otherRolesCents = Object.entries(splits).reduce((s, [k, v]) =>
      k === 'OTG' ? s : s + toCents(v || 0), 0
    );
    const otgShouldBeCents = amtCents - otherRolesCents;
    splits.OTG = centsToNum(otgShouldBeCents);
  }

  return splits;
};

/**
 * Matches carrier statement rows against master data.
 * Returns both matched rows and unmatched rows (carrier lines not in comp key).
 */
export function matchCarrierStatements(
  carrierRows: CarrierStatementRow[],
  masterData: MasterRecord[]
): { matchedRows: MatchedRow[]; unmatchedRows: CarrierStatementRow[] } {
  if (!carrierRows || carrierRows.length === 0) {
    return { matchedRows: [], unmatchedRows: [] };
  }
  if (!masterData || masterData.length === 0) {
    return { matchedRows: [], unmatchedRows: [...carrierRows] };
  }

  const compMap = buildCompMap(masterData);
  const matchedRows: MatchedRow[] = [];
  const unmatchedRows: CarrierStatementRow[] = [];
  
  // Debug: Count how many statement rows have duplicate billing items
  const billingItemCounts = new Map<string, number>();
  const billingItemExamples = new Map<string, any[]>(); // Store example rows for each billing item
  carrierRows.forEach(row => {
    if (row.otgCompBillingItem) {
      const key = normalizeKey(row.otgCompBillingItem);
      billingItemCounts.set(key, (billingItemCounts.get(key) || 0) + 1);
      if (!billingItemExamples.has(key) || billingItemExamples.get(key)!.length < 2) {
        if (!billingItemExamples.has(key)) {
          billingItemExamples.set(key, []);
        }
        billingItemExamples.get(key)!.push({
          accountName: row.accountName,
          commissionAmount: row.commissionAmount,
          invoiceTotal: row.invoiceTotal,
        });
      }
    }
  });
  

  let unmatchedCount = 0;
  let matchedCount = 0;
  let duplicateMatchCount = 0;

  carrierRows.forEach(row => {
    const billingItem = row.otgCompBillingItem;
    if (!billingItem) {
      unmatchedCount++;
      unmatchedRows.push(row);
      return;
    }

    const key = normalizeKey(billingItem);
    const candidates = compMap.get(key);

    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      unmatchedCount++;
      unmatchedRows.push(row);
      return;
    }

    // Find the BEST matching Master Data record from candidates
    // Use account name matching to pick the right one when duplicates exist
    const matchData = findBestMatch(candidates, row);

    if (!matchData) {
      unmatchedCount++;
      unmatchedRows.push(row);
      return;
    }

    if (billingItem === '525251') {
      const masterAccount = matchData.masterRecord.clientName || matchData.masterRecord['Account **CARRIER**'] || '';
      console.log('[525251] Using Comp Key record:', {
        accountName: masterAccount,
        codes: matchData.codes,
        hasSplits: hasValidSplits(matchData.codes),
        candidateCount: candidates.length,
        candidatesWithSplits: candidates.filter(c => hasValidSplits(c.codes)).map(c => ({
          accountName: c.accountName,
          codes: c.codes,
        })),
      });
    }

    // Check if codes array is valid (allow empty codes - they'll just result in all OTG)
    if (!Array.isArray(matchData.codes)) {
      unmatchedCount++;
      unmatchedRows.push(row);
      return;
    }

    // Track when we had duplicates but found a match
    if (candidates.length > 1) {
      duplicateMatchCount++;
    }

    matchedCount++;

    // Provider is already set correctly in extractor (ENA rule)
    let provider = row.provider || matchData.provider || '';

    // Lookup State from Master Data if missing in statement
    let state = row.state || '';
    if (!state || !/^[A-Z]{2}$/.test(state)) {
      state = getStateForBillingItem(row.otgCompBillingItem, masterData);
    }

    const roleSplits = calculateRoleSplits(row.commissionAmount, matchData.codes, billingItem);

    // Get expected comp percent from master record
    const expectedCompPercent = matchData.masterRecord['EXPECTED/Mo. OTG Comp %'] ||
                                matchData.masterRecord['expectedCompPercent'] ||
                                matchData.masterRecord.splitPercentage;

    // Create ONE matched row per statement row
    const matchedRow: MatchedRow = {
      ...row,
      state, // Use looked-up state
      matchedMasterId: matchData.masterRecord.id,
      expectedCompPercent: typeof expectedCompPercent === 'number' 
        ? expectedCompPercent 
        : parseFloat(String(expectedCompPercent || '0').replace(/[^0-9.]/g, '')) / 100,
      roleSplits,
      provider: provider || row.provider || '',
      vpNotes: matchData.vpNotes || '',
    };

    matchedRows.push(matchedRow);
  });

  // Calculate totals for verification
  const totalCommission = matchedRows.reduce((sum, r) => sum + (r.commissionAmount || 0), 0);
  const totalInvoice = matchedRows.reduce((sum, r) => sum + (r.invoiceTotal || 0), 0);
  
  // Calculate role split totals
  const roleTotals: Record<string, number> = {
    RD1: 0, RD2: 0, RD3: 0, RD4: 0,
    RM1: 0, RM2: 0, RM3: 0, RM4: 0,
    OVR: 0, RD5: 0, OTG: 0,
  };
  matchedRows.forEach(r => {
    Object.keys(roleTotals).forEach(role => {
      roleTotals[role as keyof typeof roleTotals] += toNum(r.roleSplits[role as keyof typeof r.roleSplits] || 0);
    });
  });
  
  // Sample a few matched rows to verify calculations
  const sampleRows = matchedRows.slice(0, 5).map(r => ({
    billingItem: r.otgCompBillingItem,
    accountName: r.accountName,
    commissionAmount: r.commissionAmount,
    invoiceTotal: r.invoiceTotal,
    roleSplits: r.roleSplits,
    codes: compMap.get(normalizeKey(r.otgCompBillingItem))?.[0]?.codes || [],
  }));
  
  // Find rows with RD1/RD2 splits for debugging
  const rd12Rows = matchedRows.filter(r => {
    const rd1 = toNum(r.roleSplits.RD1 || 0);
    const rd2 = toNum(r.roleSplits.RD2 || 0);
    return rd1 > 0 || rd2 > 0;
  });
  const rd12TotalCommission = rd12Rows.reduce((sum, r) => sum + (r.commissionAmount || 0), 0);
  const rd12TotalSplits = rd12Rows.reduce((sum, r) => {
    return sum + toNum(r.roleSplits.RD1 || 0) + toNum(r.roleSplits.RD2 || 0);
  }, 0);

  return { matchedRows, unmatchedRows };
}
