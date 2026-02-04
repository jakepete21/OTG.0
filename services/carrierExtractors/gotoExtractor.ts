/**
 * GoTo Carrier Statement Extractor
 * Implements GoTo-specific extraction logic from docs/GOTO_STATEMENT_PROCESSING.md
 */

import * as XLSX from 'xlsx';
import { CarrierStatementRow } from '../../types';
import { parseCurrency } from '../numberFormat';

/**
 * Special commission adjustment rule: CN-568463-1409 → subtract 118.29
 */
const applyCommissionAdjustment = (
  billingItem: string,
  commissionAmount: number
): number => {
  if (billingItem === 'CN-568463-1409') {
    return commissionAmount - 118.29;
  }
  return commissionAmount;
};

/**
 * Processes Data tab (required)
 */
const processDataTab = (worksheet: XLSX.WorkSheet): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  const rows: CarrierStatementRow[] = [];
  
  // Start from row 4 (index 3)
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    
    // Stop condition: "customer details" in column A
    if (String(row[0] || '').toLowerCase().includes('customer details')) {
      break;
    }
    
    // Skip rows where billing item contains "customer totals"
    const billingItem = String(row[1] || '').trim(); // Column B (index 1)
    if (billingItem.toLowerCase().includes('customer totals')) {
      continue;
    }
    
    if (!billingItem) continue;
    
    const accountName = String(row[2] || '').trim(); // Column C (index 2)
    const invoiceTotal = parseCurrency(row[6]); // Column G (index 6)
    let commissionAmount = parseCurrency(row[7]); // Column H (index 7)
    
    // Apply special commission adjustment
    commissionAmount = applyCommissionAdjustment(billingItem, commissionAmount);
    
    rows.push({
      state: '', // Will be looked up from Master Data
      accountName,
      accountNumber: '',
      otgCompBillingItem: billingItem,
      invoiceTotal,
      commissionAmount,
      provider: '',
      carrierStatement: 'GoTo',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};

/**
 * Processes Equipment tab (optional, with grouping)
 */
const processEquipmentTab = (worksheet: XLSX.WorkSheet): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  // Group by billing item (Column I, index 8)
  const groups = new Map<string, {
    accountName: string;
    invoiceTotal: number;
    commissionAmount: number;
  }>();
  
  // Start from row 4 (index 3)
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const billingItem = String(row[8] || '').trim(); // Column I (index 8)
    
    if (!billingItem) continue;
    
    // Get first non-blank account name (Column A, index 0)
    let accountName = String(row[0] || '').trim();
    
    const invoiceTotal = parseCurrency(row[5]); // Column F (index 5)
    let commissionAmount = parseCurrency(row[6]); // Column G (index 6)
    
    // Apply special commission adjustment
    commissionAmount = applyCommissionAdjustment(billingItem, commissionAmount);
    
    if (!groups.has(billingItem)) {
      groups.set(billingItem, {
        accountName: accountName || '',
        invoiceTotal: 0,
        commissionAmount: 0,
      });
    }
    
    const group = groups.get(billingItem)!;
    if (!group.accountName && accountName) {
      group.accountName = accountName;
    }
    group.invoiceTotal += invoiceTotal;
    group.commissionAmount += commissionAmount;
  }
  
  const rows: CarrierStatementRow[] = [];
  groups.forEach((group, billingItem) => {
    rows.push({
      state: '',
      accountName: group.accountName,
      accountNumber: '',
      otgCompBillingItem: billingItem,
      invoiceTotal: group.invoiceTotal,
      commissionAmount: group.commissionAmount,
      provider: '',
      carrierStatement: 'GoTo',
      billDescription: undefined,
      billPeriod: undefined,
    });
  });
  
  return rows;
};

/**
 * Processes One-Time tab (optional)
 */
const processOneTimeTab = (worksheet: XLSX.WorkSheet): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  const rows: CarrierStatementRow[] = [];
  
  // Start from row 2 (index 1)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const accountName = String(row[0] || '').trim(); // Column A (index 0)
    const billingItem = String(row[1] || '').trim(); // Column B (index 1)
    
    if (!billingItem) continue;
    
    const invoiceTotal = parseCurrency(row[4]); // Column E (index 4)
    let commissionAmount = parseCurrency(row[8]); // Column I (index 8)
    
    // Apply special commission adjustment
    commissionAmount = applyCommissionAdjustment(billingItem, commissionAmount);
    
    rows.push({
      state: '',
      accountName,
      accountNumber: '',
      otgCompBillingItem: billingItem,
      invoiceTotal,
      commissionAmount,
      provider: '',
      carrierStatement: 'GoTo',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};

/**
 * Processes Canceled tab (optional, columns swapped)
 */
const processCanceledTab = (worksheet: XLSX.WorkSheet): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  const rows: CarrierStatementRow[] = [];
  
  // Start from row 2 (index 1)
  // Columns A and B are swapped
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const accountName = String(row[1] || '').trim(); // Column B (normally billing item)
    const billingItem = String(row[0] || '').trim(); // Column A (normally account name)
    
    if (!billingItem) continue;
    
    rows.push({
      state: '',
      accountName,
      accountNumber: '',
      otgCompBillingItem: billingItem,
      invoiceTotal: 0, // Blank for canceled
      commissionAmount: 0, // Blank for canceled
      provider: '',
      carrierStatement: 'GoTo',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};

/**
 * Processes Assist tab (optional)
 */
const processAssistTab = (worksheet: XLSX.WorkSheet): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  const rows: CarrierStatementRow[] = [];
  
  // Start from row 2 (index 1)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const accountName = String(row[0] || '').trim(); // Column A (index 0)
    const billingItem = String(row[2] || '').trim(); // Column C (index 2)
    
    if (!billingItem) continue;
    
    const invoiceTotal = parseCurrency(row[4]); // Column E (index 4)
    let commissionAmount = parseCurrency(row[7]); // Column H (index 7)
    
    // Apply special commission adjustment
    commissionAmount = applyCommissionAdjustment(billingItem, commissionAmount);
    
    rows.push({
      state: '',
      accountName,
      accountNumber: '',
      otgCompBillingItem: billingItem,
      invoiceTotal,
      commissionAmount,
      provider: '',
      carrierStatement: 'GoTo',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};

/**
 * Processes CAD or 2G Energy tab (section-based parsing)
 */
const processSectionBasedTab = (
  worksheet: XLSX.WorkSheet,
  type: 'CAD' | '2G Energy'
): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  const rows: CarrierStatementRow[] = [];
  
  // Find section starting with "Customer Summary" in Column A
  let sectionStart = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').toLowerCase().includes('customer summary')) {
      sectionStart = i;
      break;
    }
  }
  
  if (sectionStart === -1) {
    return rows; // Section not found
  }
  
  // Find subsection starting with "Customer Number" in Column B
  let subsectionStart = -1;
  for (let i = sectionStart; i < data.length; i++) {
    if (String(data[i][1] || '').toLowerCase().includes('customer number')) {
      subsectionStart = i + 1; // Start from next row
      break;
    }
  }
  
  if (subsectionStart === -1) {
    return rows;
  }
  
  // Process until "Customer Totals - USD" in Column B
  for (let i = subsectionStart; i < data.length; i++) {
    const row = data[i];
    
    if (String(row[1] || '').toLowerCase().includes('customer totals')) {
      break;
    }
    
    const accountName = String(row[2] || '').trim(); // Column C (index 2)
    const billingItem = String(row[1] || '').trim(); // Column B (index 1)
    
    if (!billingItem) continue;
    
    const invoiceTotal = parseCurrency(row[6]); // Column G (index 6)
    let commissionAmount = parseCurrency(row[7]); // Column H (index 7)
    
    // Apply special commission adjustment
    commissionAmount = applyCommissionAdjustment(billingItem, commissionAmount);
    
    rows.push({
      state: '',
      accountName,
      accountNumber: '',
      otgCompBillingItem: billingItem,
      invoiceTotal,
      commissionAmount,
      provider: '',
      carrierStatement: 'GoTo',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};

/**
 * Extracts GoTo statement data from workbook
 */
export const extractGoToData = async (
  workbook: XLSX.WorkBook
): Promise<CarrierStatementRow[]> => {
  const allRows: CarrierStatementRow[] = [];
  
  // Data tab is required
  const dataSheet = workbook.Sheets['Data'];
  if (!dataSheet) {
    throw new Error('GoTo workbook must have a "Data" tab');
  }
  
  allRows.push(...processDataTab(dataSheet));
  
  // Process optional tabs
  const equipmentSheet = workbook.Sheets['Equipment'];
  if (equipmentSheet) {
    allRows.push(...processEquipmentTab(equipmentSheet));
  }
  
  const oneTimeSheet = workbook.Sheets['One-Time'];
  if (oneTimeSheet) {
    allRows.push(...processOneTimeTab(oneTimeSheet));
  }
  
  const canceledSheet = workbook.Sheets['Canceled'];
  if (canceledSheet) {
    allRows.push(...processCanceledTab(canceledSheet));
  }
  
  const assistSheet = workbook.Sheets['Assist'];
  if (assistSheet) {
    allRows.push(...processAssistTab(assistSheet));
  }
  
  const cadSheet = workbook.Sheets['CAD'];
  if (cadSheet) {
    allRows.push(...processSectionBasedTab(cadSheet, 'CAD'));
  }
  
  const twoGEnergySheet = workbook.Sheets['2G Energy'];
  if (twoGEnergySheet) {
    allRows.push(...processSectionBasedTab(twoGEnergySheet, '2G Energy'));
  }
  
  return allRows;
};
