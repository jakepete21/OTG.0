/**
 * Allstream Carrier Statement Extractor
 * Implements Allstream-specific extraction logic from docs/ALLSTREAM_STATEMENT_PROCESSING.md
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
 * Cleans account name (removes parentheses, month/billing suffixes)
 */
const cleanAccountName = (raw: string): string => {
  let s = String(raw || '').trim();
  
  // Remove parentheses notes
  s = s.replace(/\([^)]*\)/g, '').trim();
  
  // Remove month/billing suffixes
  const octIdx = s.search(/\sOct\s/i);
  if (octIdx > 0) {
    s = s.slice(0, octIdx).trim();
  }
  
  const billIdx = s.search(/\sBilling/i);
  if (billIdx > 0) {
    s = s.slice(0, billIdx).trim();
  }
  
  // Collapse whitespace
  return s.replace(/\s+/g, ' ').trim();
};

/**
 * Extracts last currency value from row
 */
const extractLastMoney = (row: any[]): number => {
  const moneyPattern = /\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
  let lastMatch: string | null = null;
  
  const rowStr = row.map(c => String(c || '')).join(' ');
  const matches = rowStr.match(moneyPattern);
  
  if (matches && matches.length > 0) {
    lastMatch = matches[matches.length - 1];
  }
  
  return lastMatch ? parseCurrency(lastMatch) : 0;
};

/**
 * Processes OneTel H R tab (primary tab)
 */
const processOneTelHRTab = (worksheet: XLSX.WorkSheet): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  const rows: CarrierStatementRow[] = [];
  
  // Start from row 14 (index 13)
  for (let i = 13; i < data.length; i++) {
    const row = data[i];
    
    const billingItem = String(row[4] || '').trim(); // Column E (index 4)
    const accountName = String(row[5] || '').trim(); // Column F (index 5)
    const invoiceTotal = parseCurrency(row[8]); // Column I (index 8)
    const commissionAmount = parseCurrency(row[10]); // Column K (index 10)
    
    // Skip if billing item blank
    if (!billingItem) {
      continue;
    }
    
    // Skip if all fields blank
    if (!accountName && !billingItem && invoiceTotal === 0 && commissionAmount === 0) {
      continue;
    }
    
    rows.push({
      state: '',
      accountName,
      accountNumber: '',
      otgCompBillingItem: billingItem,
      invoiceTotal,
      commissionAmount,
      provider: '',
      carrierStatement: 'Allstream',
      billDescription: undefined,
      billPeriod: undefined,
    });
  }
  
  return rows;
};

/**
 * Processes OneTel H tab (secondary tab with section-based parsing)
 */
const processOneTelHTab = (worksheet: XLSX.WorkSheet): CarrierStatementRow[] => {
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true 
  }) as any[][];
  
  const rows: CarrierStatementRow[] = [];
  
  // Process sections: NEW SOLD REVENUE, CHANGES & CANCELS, ADJUSTMENTS
  const sections = [
    { name: 'NEW SOLD REVENUE', endMarker: 'Total New Sold Revenue' },
    { name: 'CHANGES & CANCELS', endMarker: 'Subtotal' },
    { name: 'ADJUSTMENTS', endMarker: 'Subtotal' },
  ];
  
  for (const section of sections) {
    // Find section start
    let sectionStart = -1;
    for (let i = 0; i < data.length; i++) {
      if (normalizeHeader(String(data[i][0] || '')).includes(normalizeHeader(section.name))) {
        sectionStart = i + 1; // Start from next row
        break;
      }
    }
    
    if (sectionStart === -1) continue;
    
    // Track active account
    let activeAccount: {
      acctNum: string;
      acctName: string;
      category: string;
      lastMoney: number;
    } | null = null;
    
    // Process until end marker
    for (let i = sectionStart; i < data.length; i++) {
      const row = data[i];
      
      // Check for end marker
      const colA = String(row[0] || '').toLowerCase();
      const colC = String(row[2] || '').toLowerCase();
      
      if (section.name === 'NEW SOLD REVENUE' && colA.includes('total new sold revenue')) {
        // Flush active account
        if (activeAccount && activeAccount.acctNum && activeAccount.acctName && activeAccount.lastMoney !== 0) {
          rows.push({
            state: '',
            accountName: cleanAccountName(activeAccount.acctName),
            accountNumber: '',
            otgCompBillingItem: activeAccount.acctNum,
            invoiceTotal: 0, // Blank for OneTel H
            commissionAmount: activeAccount.lastMoney,
            provider: '',
            carrierStatement: 'Allstream',
            billDescription: undefined,
            billPeriod: undefined,
          });
        }
        break;
      }
      
      if ((section.name === 'CHANGES & CANCELS' || section.name === 'ADJUSTMENTS') && 
          colC.includes('subtotal')) {
        // Flush active account
        if (activeAccount && activeAccount.acctNum && activeAccount.acctName && activeAccount.lastMoney !== 0) {
          rows.push({
            state: '',
            accountName: cleanAccountName(activeAccount.acctName),
            accountNumber: '',
            otgCompBillingItem: activeAccount.acctNum,
            invoiceTotal: 0,
            commissionAmount: activeAccount.lastMoney,
            provider: '',
            carrierStatement: 'Allstream',
            billDescription: undefined,
            billPeriod: undefined,
          });
        }
        activeAccount = null;
        continue;
      }
      
      // Check for account number (4+ digits in Column A)
      const colAValue = String(row[0] || '').trim();
      const accountNumMatch = colAValue.match(/\d{4,}/);
      
      if (accountNumMatch) {
        // Flush previous account
        if (activeAccount && activeAccount.acctNum && activeAccount.acctName && activeAccount.lastMoney !== 0) {
          rows.push({
            state: '',
            accountName: cleanAccountName(activeAccount.acctName),
            accountNumber: '',
            otgCompBillingItem: activeAccount.acctNum,
            invoiceTotal: 0,
            commissionAmount: activeAccount.lastMoney,
            provider: '',
            carrierStatement: 'Allstream',
            billDescription: undefined,
            billPeriod: undefined,
          });
        }
        
        // Start new account
        const accountName = [row[1], row[2], row[3], row[4]]
          .map(c => String(c || '').trim())
          .find(c => c) || '';
        
        activeAccount = {
          acctNum: accountNumMatch[0],
          acctName: accountName,
          category: section.name,
          lastMoney: extractLastMoney(row),
        };
      } else if (activeAccount) {
        // Accumulate commission
        const money = extractLastMoney(row);
        if (money !== 0) {
          activeAccount.lastMoney = money;
        }
        
        // Update category if found
        if (colAValue && !colAValue.match(/^\d/)) {
          // Singularize category
          let category = colAValue;
          if (category.endsWith('s') && category.length > 1) {
            category = category.slice(0, -1);
          }
          activeAccount.category = category;
        }
      }
    }
    
    // Flush final account
    if (activeAccount && activeAccount.acctNum && activeAccount.acctName && activeAccount.lastMoney !== 0) {
      rows.push({
        state: '',
        accountName: cleanAccountName(activeAccount.acctName),
        accountNumber: '',
        otgCompBillingItem: activeAccount.acctNum,
        invoiceTotal: 0,
        commissionAmount: activeAccount.lastMoney,
        provider: '',
        carrierStatement: 'Allstream',
        billDescription: undefined,
        billPeriod: undefined,
      });
    }
  }
  
  return rows;
};

/**
 * Extracts Allstream statement data from workbook
 */
export const extractAllstreamData = async (
  workbook: XLSX.WorkBook
): Promise<CarrierStatementRow[]> => {
  const allRows: CarrierStatementRow[] = [];
  
  // Process OneTel H R tab (primary)
  const oneTelHRSheet = workbook.Sheets['OneTel H R'];
  if (oneTelHRSheet) {
    allRows.push(...processOneTelHRTab(oneTelHRSheet));
  }
  
  // Process OneTel H tab (secondary, optional)
  const oneTelHSheet = workbook.Sheets['OneTel H'];
  if (oneTelHSheet) {
    allRows.push(...processOneTelHTab(oneTelHSheet));
  }
  
  if (allRows.length === 0) {
    throw new Error('No data found in Allstream workbook (expected "OneTel H R" or "OneTel H" tab)');
  }
  
  return allRows;
};
