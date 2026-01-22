/**
 * MetTel Carrier Statement Extractor
 * Implements MetTel-specific extraction logic from docs/METTEL_STATEMENT_PROCESSING.md
 */

import * as XLSX from 'xlsx';
import { CarrierStatementRow } from '../../types';

/**
 * Parses currency string to number
 */
const parseCurrency = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).replace(/[\$,()]/g, '').trim();
  if (str.startsWith('-') || str.startsWith('(')) {
    return -Math.abs(parseFloat(str.replace(/[^0-9.]/g, '')) || 0);
  }
  return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
};

/**
 * Extracts MetTel statement data from workbook
 */
export const extractMetTelData = async (
  workbook: XLSX.WorkBook
): Promise<CarrierStatementRow[]> => {
  // Use first sheet
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error('No sheets found in MetTel workbook');
  }
  
  // Read all data
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: false 
  }) as any[][];
  
  if (data.length < 2) {
    return [];
  }
  
  const rows: CarrierStatementRow[] = [];
  
  // Start from row 2 (index 1, skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // Fixed column positions (0-based)
    const accountName = String(row[2] || '').trim(); // Column C (index 2)
    const billingItem = String(row[3] || '').trim(); // Column D (index 3)
    const invoiceTotal = parseCurrency(row[13]); // Column N (index 13)
    const commissionAmount = parseCurrency(row[15]); // Column P (index 15)
    
    // Skip if billing item is blank (required)
    if (!billingItem) {
      continue;
    }
    
    // Skip if all fields blank
    if (!accountName && !billingItem && invoiceTotal === 0 && commissionAmount === 0) {
      continue;
    }
    
    rows.push({
      state: '', // Will be looked up from Master Data
      accountName,
      accountNumber: '', // Always blank for MetTel
      otgCompBillingItem: billingItem,
      invoiceTotal,
      commissionAmount,
      provider: '',
      carrierStatement: 'MetTel',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};
