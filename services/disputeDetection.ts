import { 
  MasterRecord, 
  CarrierStatementRow, 
  MatchedRow, 
  Dispute, 
  DisputeType 
} from "../types";

/**
 * Helper to normalize billing item for comparison
 */
const normalizeBillingItem = (item: string): string => {
  return String(item || '').trim().toUpperCase();
};

/**
 * Helper to convert to cents for zero detection
 */
const toCents = (v: any): number => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100);
  const s = String(v).replace(/[\$,]/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100);
};

/**
 * 1. New Accounts All - Items in statement NOT in Master Data
 */
export const detectNewAccounts = (
  carrierRows: CarrierStatementRow[],
  masterData: MasterRecord[]
): Dispute[] => {
  if (!carrierRows || carrierRows.length === 0) {
    return [];
  }
  if (!masterData || masterData.length === 0) {
    // If no master data, all carrier rows are new accounts
    return carrierRows.map(row => ({
      id: `new-account-${Date.now()}-${Math.random()}`,
      type: DisputeType.NEW_ACCOUNT,
      accountName: row.accountName,
      otgCompBillingItem: row.otgCompBillingItem,
      state: row.state,
      accountNumber: row.accountNumber,
      actualAmount: row.commissionAmount,
      explanation: `New account found in ${row.carrierStatement} statement that is not in Master Data`,
      dateDetected: new Date(),
      provider: row.provider,
      carrierStatement: row.carrierStatement,
      billDescription: row.billDescription,
      billPeriod: row.billPeriod,
    }));
  }

  // Build set of billing items in master data
  const masterBillingItems = new Set<string>();
  masterData.forEach(record => {
    const billingItem = record['OTG Comp Billing item'] || 
                       record['OTG Comp Billing Item'] ||
                       record['otgCompBillingItem'] ||
                       record.serviceType || '';
    if (billingItem) {
      masterBillingItems.add(normalizeBillingItem(billingItem));
    }
  });

  const disputes: Dispute[] = [];
  const seenSignatures = new Set<string>();

  carrierRows.forEach(row => {
    const billingItem = normalizeBillingItem(row.otgCompBillingItem);
    
    // Skip if exists in master data
    if (masterBillingItems.has(billingItem)) {
      return;
    }

    // Dedupe by full row signature (meaningful columns only)
    const signature = [
      row.accountName,
      row.otgCompBillingItem,
      row.provider,
      row.carrierStatement,
    ].join('|').toLowerCase();

    if (seenSignatures.has(signature)) {
      return;
    }
    seenSignatures.add(signature);

    disputes.push({
      id: `new-account-${Date.now()}-${Math.random()}`,
      type: DisputeType.NEW_ACCOUNT,
      accountName: row.accountName,
      otgCompBillingItem: row.otgCompBillingItem,
      state: row.state,
      accountNumber: row.accountNumber,
      actualAmount: row.commissionAmount,
      explanation: `New account found in ${row.carrierStatement} statement that is not in Master Data`,
      dateDetected: new Date(),
      provider: row.provider,
      carrierStatement: row.carrierStatement,
      billDescription: row.billDescription,
      billPeriod: row.billPeriod,
    });
  });

  return disputes;
};

/**
 * 2. Zeros and Chargebacks
 */
export const detectZerosAndChargebacks = (
  matchedRows: MatchedRow[]
): Dispute[] => {
  if (!matchedRows || matchedRows.length === 0) {
    return [];
  }

  const disputes: Dispute[] = [];
  const ZERO_TOLERANCE = 0.005; // Anything with abs(value) < 0.005 displays as $0.00

  matchedRows.forEach(row => {
    const commissionCents = toCents(row.commissionAmount);
    const absCommission = Math.abs(commissionCents / 100);

    // Zero detection: rounds to $0.00
    if (absCommission < ZERO_TOLERANCE) {
      disputes.push({
        id: `zero-${Date.now()}-${Math.random()}`,
        type: DisputeType.ZERO,
        accountName: row.accountName,
        otgCompBillingItem: row.otgCompBillingItem,
        state: row.state,
        accountNumber: row.accountNumber,
        actualAmount: row.commissionAmount,
        expectedAmount: row.expectedCompPercent 
          ? row.invoiceTotal * (row.expectedCompPercent / 100)
          : undefined,
        explanation: `Commission amount rounds to $0.00 (actual: $${row.commissionAmount.toFixed(4)})`,
        dateDetected: new Date(),
        provider: row.provider,
        carrierStatement: row.carrierStatement,
        billDescription: row.billDescription,
        billPeriod: row.billPeriod,
      });
    }

    // Chargeback detection: negative commission
    if (row.commissionAmount < 0) {
      disputes.push({
        id: `chargeback-${Date.now()}-${Math.random()}`,
        type: DisputeType.CHARGEBACK,
        accountName: row.accountName,
        otgCompBillingItem: row.otgCompBillingItem,
        state: row.state,
        accountNumber: row.accountNumber,
        actualAmount: row.commissionAmount,
        explanation: `Negative commission amount (chargeback): $${row.commissionAmount.toFixed(2)}`,
        dateDetected: new Date(),
        provider: row.provider,
        carrierStatement: row.carrierStatement,
        billDescription: row.billDescription,
        billPeriod: row.billPeriod,
      });
    }
  });

  return disputes;
};

/**
 * 3. Canceled / Missing - Items in Master Data NOT in statement
 */
export const detectCanceledMissing = (
  carrierRows: CarrierStatementRow[],
  masterData: MasterRecord[]
): Dispute[] => {
  if (!masterData || masterData.length === 0) {
    return [];
  }

  // Build set of billing items found in carrier statements
  const foundBillingItems = new Set<string>();
  (carrierRows || []).forEach(row => {
    if (row.otgCompBillingItem) {
      foundBillingItems.add(normalizeBillingItem(row.otgCompBillingItem));
    }
  });

  const disputes: Dispute[] = [];

  masterData.forEach(record => {
    const billingItem = record['OTG Comp Billing item'] || 
                       record['OTG Comp Billing Item'] ||
                       record['otgCompBillingItem'] ||
                       record.serviceType || '';
    
    if (!billingItem) return;

    const normalized = normalizeBillingItem(billingItem);

    // Skip if found in statements
    if (foundBillingItems.has(normalized)) {
      return;
    }

    // Check for ZMap (column H contains "zmap")
    const columnH = record['H'] || record['Column H'] || '';
    const isZMap = String(columnH || '').toLowerCase().includes('zmap');

    // Check for Non-MRC Billing (column W != "MRC" and non-blank)
    const columnW = record['W'] || record['Column W'] || record['Billing Type'] || '';
    const isNonMRC = columnW && String(columnW).trim().toUpperCase() !== 'MRC';

    let disputeType = DisputeType.CANCELED;
    let explanation = 'Item in Master Data not found in carrier statements';

    if (isZMap) {
      disputeType = DisputeType.CANCELED; // Still canceled, but could be categorized differently
      explanation = 'ZMap item in Master Data not found in carrier statements';
    } else if (isNonMRC) {
      disputeType = DisputeType.CANCELED; // Still canceled, but could be categorized differently
      explanation = 'Non-MRC billing item in Master Data not found in carrier statements';
    }

    disputes.push({
      id: `canceled-${Date.now()}-${Math.random()}`,
      type: disputeType,
      accountName: record.clientName || record['Account **CARRIER**'] || '',
      otgCompBillingItem: billingItem,
      expectedAmount: record.expectedAmount || record['Monthly Unit Price'] || 0,
      explanation,
      dateDetected: new Date(),
      provider: record['Service Provider'] || record.serviceType || '',
    });
  });

  return disputes;
};

/**
 * 4. Changed Rates - Compare current vs previous month
 * Note: This requires historical data. For now, we'll return empty array.
 * In a full implementation, you'd need to store previous month's data.
 */
export const detectChangedRates = (
  matchedRows: MatchedRow[],
  previousMonthData?: MatchedRow[]
): Dispute[] => {
  const disputes: Dispute[] = [];

  if (!previousMonthData || previousMonthData.length === 0) {
    // No previous month data available
    return disputes;
  }

  // Aggregate by billing item for current month
  const currentMonthTotals = new Map<string, number>();
  matchedRows.forEach(row => {
    const key = normalizeBillingItem(row.otgCompBillingItem);
    const current = currentMonthTotals.get(key) || 0;
    currentMonthTotals.set(key, current + row.commissionAmount);
  });

  // Aggregate by billing item for previous month
  const previousMonthTotals = new Map<string, number>();
  previousMonthData.forEach(row => {
    const key = normalizeBillingItem(row.otgCompBillingItem);
    const current = previousMonthTotals.get(key) || 0;
    previousMonthTotals.set(key, current + row.commissionAmount);
  });

  const THRESHOLD = 50; // $50 threshold

  // Compare and flag differences > $50
  currentMonthTotals.forEach((currentTotal, billingItem) => {
    const previousTotal = previousMonthTotals.get(billingItem) || 0;
    const difference = currentTotal - previousTotal;

    if (Math.abs(difference) > THRESHOLD) {
      // Find a representative row for this billing item
      const representativeRow = matchedRows.find(
        r => normalizeBillingItem(r.otgCompBillingItem) === billingItem
      );

      if (representativeRow) {
        disputes.push({
          id: `changed-rate-${Date.now()}-${Math.random()}`,
          type: DisputeType.CHANGED_RATE,
          accountName: representativeRow.accountName,
          otgCompBillingItem: representativeRow.otgCompBillingItem,
          state: representativeRow.state,
          accountNumber: representativeRow.accountNumber,
          expectedAmount: previousTotal,
          actualAmount: currentTotal,
          difference,
          explanation: `Commission changed from $${previousTotal.toFixed(2)} to $${currentTotal.toFixed(2)} (difference: $${difference.toFixed(2)})`,
          dateDetected: new Date(),
          provider: representativeRow.provider,
          carrierStatement: representativeRow.carrierStatement,
        });
      }
    }
  });

  return disputes;
};

/**
 * 5. Months Held Not Paid - Zayo-specific logic
 * Note: This requires Zayo-specific data structure. For now, returns empty.
 * In a full implementation, you'd parse the "Months" column from Zayo statements.
 */
export const detectMonthsHeldNotPaid = (
  matchedRows: MatchedRow[]
): Dispute[] => {
  // Filter for Zayo rows with "Paid = No" flag
  // This would require parsing Zayo-specific columns
  // For now, return empty array
  const disputes: Dispute[] = [];
  
  // TODO: Implement when Zayo data structure is available
  // Would need to:
  // 1. Filter for Zayo carrier
  // 2. Check "Paid" flag = "No"
  // 3. Parse "Months" column for month tokens
  // 4. Group by billing item
  
  return disputes;
};

/**
 * 6. Months Held Paid - Zayo-specific logic
 * Note: Similar to Months Held Not Paid, requires Zayo-specific structure
 */
export const detectMonthsHeldPaid = (
  matchedRows: MatchedRow[]
): Dispute[] => {
  // This is typically not a dispute, but a record of paid months
  // Return empty for now
  const disputes: Dispute[] = [];
  
  // TODO: Implement when Zayo data structure is available
  
  return disputes;
};

/**
 * Run all dispute detection functions
 */
export const detectAllDisputes = (
  carrierRows: CarrierStatementRow[],
  matchedRows: MatchedRow[],
  masterData: MasterRecord[],
  previousMonthData?: MatchedRow[]
): Dispute[] => {
  const disputes: Dispute[] = [];

  // 1. New Accounts
  disputes.push(...detectNewAccounts(carrierRows, masterData));

  // 2. Zeros and Chargebacks
  disputes.push(...detectZerosAndChargebacks(matchedRows));

  // 3. Canceled / Missing
  disputes.push(...detectCanceledMissing(carrierRows, masterData));

  // 4. Changed Rates
  disputes.push(...detectChangedRates(matchedRows, previousMonthData));

  // 5. Months Held Not Paid (Zayo-specific)
  disputes.push(...detectMonthsHeldNotPaid(matchedRows));

  // Note: Months Held Paid is typically not a dispute, so we skip it

  return disputes;
};
