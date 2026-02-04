/**
 * Lumen Carrier Statement Extractor
 * Implements Lumen-specific extraction logic from docs/LUMEN_STATEMENT_PROCESSING.md
 */

import * as XLSX from 'xlsx';
import { CarrierStatementRow } from '../../types';
import { parseCurrency } from '../numberFormat';

/**
 * Checks if row matches repeated header pattern
 */
const isRepeatedHeader = (row: any[]): boolean => {
  const accountName = String(row[20] || '').toLowerCase(); // Column U
  const accountNumber = String(row[15] || '').toLowerCase(); // Column P
  const invoiceTotal = String(row[25] || '').toLowerCase(); // Column Z
  
  return accountName.includes('billing acct name') ||
         accountNumber.includes('billing acct nbr') ||
         invoiceTotal.includes('adjusted compensable revenue');
};

/**
 * Extracts Lumen statement data from workbook
 */
export const extractLumenData = async (
  workbook: XLSX.WorkBook
): Promise<CarrierStatementRow[]> => {
  // Find "Sheet1" or use first sheet
  let sheetName = 'Sheet1';
  let worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    sheetName = workbook.SheetNames[0];
    worksheet = workbook.Sheets[sheetName];
  }
  
  if (!worksheet) {
    throw new Error('No sheets found in Lumen workbook');
  }
  
  // Read all data
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  if (data.length < 2) {
    return [];
  }
  
  const rows: CarrierStatementRow[] = [];
  
  // Start from row 2 (index 1, skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // Skip repeated headers
    if (isRepeatedHeader(row)) {
      continue;
    }
    
    // Fixed column positions (0-based)
    const accountNumber = String(row[15] || '').trim(); // Column P (index 15)
    const accountName = String(row[20] || '').trim(); // Column U (index 20)
    const invoiceTotal = parseCurrency(row[25]); // Column Z (index 25)
    const commissionAmount = parseCurrency(row[27]); // Column AB (index 27)
    
    // Skip if billing item (account number) is blank
    if (!accountNumber) {
      continue;
    }
    
    // Skip if all fields blank
    if (!accountName && !accountNumber && invoiceTotal === 0 && commissionAmount === 0) {
      continue;
    }
    
    // Account Number = Billing Item for Lumen
    rows.push({
      state: '', // Will be looked up from Master Data
      accountName,
      accountNumber,
      otgCompBillingItem: accountNumber, // Same as account number
      invoiceTotal,
      commissionAmount,
      provider: '',
      carrierStatement: 'Lumen',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};
