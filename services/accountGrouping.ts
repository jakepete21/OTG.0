import { MasterRecord } from '../types';

export interface AccountGroup {
  accountId: string;
  accountCarrier: string;
  otgCompBillingItem: string;
  lineItems: MasterRecord[];
  summary: AccountSummary;
}

export interface AccountSummary {
  serviceProvider?: string;
  statusType?: string;
  totalMonthlyComp: number;
  lineItemCount: number;
  comp1?: string;
  // Additional aggregated metrics can be added here
}

/**
 * Groups master records by account using Account **CARRIER** and OTG Comp Billing item
 * Both fields must match for records to be in the same account group
 */
export function groupRecordsByAccount(records: MasterRecord[]): AccountGroup[] {
  const accountMap = new Map<string, AccountGroup>();

  records.forEach(record => {
    // Get account carrier (normalize field name)
    const accountCarrier = getFieldValue(record, 'Account **CARRIER**', 'account **carrier**', 'clientName') || 'Unknown Account';
    
    // Get OTG Comp Billing item
    const otgCompBillingItem = getFieldValue(record, 'OTG Comp Billing item', 'otg comp billing item') || 'Unknown Item';
    
    // Create unique account identifier
    const accountId = `${accountCarrier}|||${otgCompBillingItem}`;

    if (!accountMap.has(accountId)) {
      accountMap.set(accountId, {
        accountId,
        accountCarrier,
        otgCompBillingItem,
        lineItems: [],
        summary: {
          totalMonthlyComp: 0,
          lineItemCount: 0,
        }
      });
    }

    const group = accountMap.get(accountId)!;
    group.lineItems.push(record);
  });

  // Calculate summaries for each group
  const groups = Array.from(accountMap.values());
  groups.forEach(group => {
    group.summary = calculateAccountSummary(group.lineItems);
  });

  // Helper to get state from first line item
  const getState = (group: AccountGroup): string => {
    if (group.lineItems.length === 0) return '';
    const firstItem = group.lineItems[0];
    const st = getFieldValue(firstItem, 'ST', 'st');
    return st || '';
  };

  // Sort by account name, then state, then comp billing item
  return groups.sort((a, b) => {
    // First by account carrier name
    const nameCompare = a.accountCarrier.localeCompare(b.accountCarrier);
    if (nameCompare !== 0) return nameCompare;
    
    // Then by state
    const stateA = getState(a);
    const stateB = getState(b);
    const stateCompare = stateA.localeCompare(stateB);
    if (stateCompare !== 0) return stateCompare;
    
    // Finally by comp billing item
    return a.otgCompBillingItem.localeCompare(b.otgCompBillingItem);
  });
}

/**
 * Helper to get field value with multiple possible field name variations
 */
function getFieldValue(record: MasterRecord, ...fieldNames: string[]): string | undefined {
  for (const fieldName of fieldNames) {
    // Try exact match
    if (record[fieldName] !== undefined && record[fieldName] !== null && record[fieldName] !== '') {
      return String(record[fieldName]);
    }
    
    // Try case-insensitive match
    const lowerFieldName = fieldName.toLowerCase();
    for (const key in record) {
      if (key.toLowerCase() === lowerFieldName) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== '') {
          return String(value);
        }
      }
    }
  }
  return undefined;
}

/**
 * Calculates summary metrics for an account group
 */
function calculateAccountSummary(lineItems: MasterRecord[]): AccountSummary {
  if (lineItems.length === 0) {
    return {
      totalMonthlyComp: 0,
      lineItemCount: 0,
    };
  }

  // Get consistent values (if all items have the same value)
  const serviceProviders = new Set<string>();
  const statusTypes = new Set<string>();
  const comp1Values = new Set<string>();
  
  let totalMonthlyComp = 0;

  lineItems.forEach(item => {
    // Service Provider
    const serviceProvider = getFieldValue(
      item, 
      'Service Provider', 
      'service provider', 
      'serviceType'
    );
    if (serviceProvider) serviceProviders.add(serviceProvider);

    // Status / Type
    const statusType = getFieldValue(
      item, 
      'Status / Type', 
      'status / type', 
      'status',
      'type'
    );
    if (statusType) statusTypes.add(statusType);

    // COMP 1
    const comp1 = getFieldValue(
      item, 
      'COMP 1', 
      'comp 1', 
      'salesperson'
    );
    if (comp1) comp1Values.add(comp1);

    // Monthly Comp to OTG per EXPECTED Comp %
    const monthlyComp = getFieldValue(
      item,
      'Monthly Comp to OTG per EXPECTED Comp %',
      'monthly comp to otg per expected comp %',
      'Monthly Comp to OTG',
      'monthly comp'
    );
    
    // Try to parse as number
    if (monthlyComp) {
      const numValue = parseNumericValue(monthlyComp);
      if (!isNaN(numValue)) {
        totalMonthlyComp += numValue;
      }
    } else {
      // Fallback: calculate from expectedAmount * splitPercentage
      const expectedAmount = typeof item.expectedAmount === 'number' ? item.expectedAmount : 0;
      const splitPercentage = typeof item.splitPercentage === 'number' ? item.splitPercentage : 0;
      totalMonthlyComp += expectedAmount * splitPercentage;
    }
  });

  return {
    serviceProvider: serviceProviders.size === 1 ? Array.from(serviceProviders)[0] : undefined,
    statusType: statusTypes.size === 1 ? Array.from(statusTypes)[0] : undefined,
    totalMonthlyComp,
    lineItemCount: lineItems.length,
    comp1: comp1Values.size === 1 ? Array.from(comp1Values)[0] : undefined,
  };
}

/**
 * Helper to parse numeric values from strings (handles currency, percentages, etc.)
 */
function parseNumericValue(value: string | number): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  // Remove currency symbols, commas, etc.
  const cleaned = String(value).replace(/[^0-9.-]+/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
