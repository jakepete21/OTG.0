/**
 * TBO Carrier Statement Extractor
 * Implements TBO-specific extraction logic from docs/TBO_STATEMENT_PROCESSING.md
 */

import * as XLSX from 'xlsx';
import { CarrierStatementRow } from '../../types';
import { parseCurrency } from '../numberFormat';

/**
 * Normalizes header name for matching
 */
const normalizeHeader = (s: string): string => {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
};

/**
 * Finds header row and column indices
 */
const findHeaders = (data: any[][]): {
  headerRow: number;
  nameCol: number;
  accountCol: number;
  billCol: number;
  commissionCol: number;
} | null => {
  // Search first 10 rows for headers
  for (let rowIdx = 0; rowIdx < Math.min(10, data.length); rowIdx++) {
    const row = data[rowIdx];
    
    let nameCol = -1;
    let accountCol = -1;
    let billCol = -1;
    let commissionCol = -1;
    
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const header = normalizeHeader(String(row[colIdx] || ''));
      
      if (header.includes('customer business name')) {
        nameCol = colIdx;
      }
      if (header.includes('supplier account')) {
        accountCol = colIdx;
      }
      if (header.includes('total bill')) {
        billCol = colIdx;
      }
      if (header.includes('total commission')) {
        commissionCol = colIdx;
      }
    }
    
    // If all required headers found, return
    if (nameCol >= 0 && accountCol >= 0 && billCol >= 0 && commissionCol >= 0) {
      return {
        headerRow: rowIdx,
        nameCol,
        accountCol,
        billCol,
        commissionCol,
      };
    }
  }
  
  return null;
};

/**
 * Extracts TBO statement data from workbook
 */
export const extractTBOData = async (
  workbook: XLSX.WorkBook
): Promise<CarrierStatementRow[]> => {
  // Find "Data" tab or use first sheet
  let sheetName = 'Data';
  let worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    sheetName = workbook.SheetNames[0];
    worksheet = workbook.Sheets[sheetName];
  }
  
  if (!worksheet) {
    throw new Error('No sheets found in TBO workbook');
  }
  
  // Read all data
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  if (data.length === 0) {
    return [];
  }
  
  // Find headers
  const headers = findHeaders(data);
  if (!headers) {
    throw new Error('Required headers not found in TBO statement');
  }
  
  // Aggregate by Customer Business Name + Supplier Account
  const groups = new Map<string, {
    accountName: string;
    billingItem: string;
    invoiceTotal: number;
    commissionAmount: number;
  }>();
  
  // Start from row after header row
  for (let i = headers.headerRow + 1; i < data.length; i++) {
    const row = data[i];
    
    const accountName = String(row[headers.nameCol] || '').trim();
    const supplierAccount = String(row[headers.accountCol] || '').trim();
    
    // Skip if name or account blank
    if (!accountName || !supplierAccount) {
      continue;
    }
    
    // Create group key
    const groupKey = `${accountName}||${supplierAccount}`;
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        accountName,
        billingItem: supplierAccount,
        invoiceTotal: 0,
        commissionAmount: 0,
      });
    }
    
    const group = groups.get(groupKey)!;
    group.invoiceTotal += parseCurrency(row[headers.billCol]);
    group.commissionAmount += parseCurrency(row[headers.commissionCol]);
  }
  
  // Convert groups to rows
  const rows: CarrierStatementRow[] = [];
  groups.forEach((group) => {
    rows.push({
      state: '', // Will be looked up from Master Data
      accountName: group.accountName,
      accountNumber: '', // Always blank for TBO
      otgCompBillingItem: group.billingItem,
      invoiceTotal: group.invoiceTotal,
      commissionAmount: group.commissionAmount,
      provider: '',
      carrierStatement: 'TBO',
      billDescription: undefined,
      billPeriod: undefined,
    });
  });
  
  return rows;
};
