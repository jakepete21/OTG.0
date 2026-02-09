/**
 * Zayo Carrier Statement Extractor
 * Implements Zayo-specific extraction logic from docs/ZAYO_STATEMENT_PROCESSING.md
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
 * Finds column index by header name (case-insensitive, flexible matching)
 * Prioritizes exact matches and longer matches over partial matches
 */
const findColumnIndex = (
  headers: any[],
  possibleNames: string[]
): number => {
  // First pass: look for exact matches
  for (const name of possibleNames) {
    const normalizedName = normalizeHeader(name);
    for (let i = 0; i < headers.length; i++) {
      const header = normalizeHeader(String(headers[i] || ''));
      if (header === normalizedName) {
        return i;
      }
    }
  }
  
  // Second pass: look for matches that start with the search term (more specific)
  for (const name of possibleNames) {
    const normalizedName = normalizeHeader(name);
    for (let i = 0; i < headers.length; i++) {
      const header = normalizeHeader(String(headers[i] || ''));
      if (header.startsWith(normalizedName + ' ') || header.startsWith(normalizedName + '(')) {
        return i;
      }
    }
  }
  
  // Third pass: look for contains matches, but prefer longer/more specific matches
  // Score matches by how specific they are (longer search term = better)
  let bestMatch = -1;
  let bestScore = 0;
  
  for (const name of possibleNames) {
    const normalizedName = normalizeHeader(name);
    const nameLength = normalizedName.length;
    
    for (let i = 0; i < headers.length; i++) {
      const header = normalizeHeader(String(headers[i] || ''));
      if (header.includes(normalizedName)) {
        // Score: length of search term (longer = better) + bonus if it's near the start
        const position = header.indexOf(normalizedName);
        const score = nameLength * 100 + (100 - position);
        
        // Skip very short matches that are likely false positives
        // e.g., "Commission" matching "Commission Record Type" when we want "Commission Amount"
        if (nameLength < 8 && header.length > nameLength + 10) {
          // This is likely a false positive, skip unless score is very high
          continue;
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = i;
        }
      }
    }
  }
  
  return bestMatch;
};

/**
 * Validates state code (2-letter US state abbreviation)
 */
const isValidState = (state: string): boolean => {
  return /^[A-Z]{2}$/.test(String(state || '').trim());
};

export interface ZayoExtractResult {
  rows: CarrierStatementRow[];
  /** Sum of Commission Amount (USD) for every data row (no row filtering). Used for Deposit Total. */
  rawTotalCommissionAmount: number;
}

/**
 * Extracts Zayo statement data from workbook
 */
export const extractZayoData = async (
  workbook: XLSX.WorkBook,
  getStateForBillingItem: (billingItem: string) => string
): Promise<ZayoExtractResult> => {
  console.log('=== ZAYO EXTRACTOR - HEADER ANALYSIS ===');
  console.log('Available sheets:', workbook.SheetNames);
  
  // Find "Collection of Commissions" tab or use first sheet
  let sheetName = 'Collection of Commissions';
  let worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    // Fallback to first sheet
    sheetName = workbook.SheetNames[0];
    worksheet = workbook.Sheets[sheetName];
    console.log(`Using sheet: ${sheetName}`);
  } else {
    console.log(`Using sheet: ${sheetName}`);
  }
  
  if (!worksheet) {
    throw new Error('No sheets found in Zayo workbook');
  }
  
  // Read all data as array (header: 1 means first row is headers)
  const allData = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '', 
    raw: true
  }) as any[][];
  
  if (allData.length === 0) {
    console.log('Sheet is empty!');
    return { rows: [], rawTotalCommissionAmount: 0 };
  }
  
  // First row is headers
  const headers = allData[0] || [];
  
  // Log all headers with their indices
  console.log('\n--- ALL HEADERS WITH INDICES ---');
  headers.forEach((header, index) => {
    console.log(`[${index}] "${header}"`);
  });
  
  // Also read as JSON to see column names (this uses headers as keys)
  try {
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true });
    if (Array.isArray(jsonData) && jsonData.length > 0) {
      console.log('\n--- COLUMN NAMES FROM JSON (first row) ---');
      const firstRow = jsonData[0];
      Object.keys(firstRow).forEach((key) => {
        const value = firstRow[key];
        console.log(`"${key}" = ${JSON.stringify(value)} (type: ${typeof value})`);
      });
      
      console.log('\n--- SAMPLE DATA ROWS (first 3) ---');
      jsonData.slice(0, 3).forEach((row, rowIndex) => {
        console.log(`\nRow ${rowIndex + 2}:`, row);
      });
      
      // Also show the raw array representation for first few rows
      console.log('\n--- RAW ARRAY REPRESENTATION (first 3 data rows) ---');
      allData.slice(1, 4).forEach((row, rowIndex) => {
        console.log(`\nRow ${rowIndex + 2} (array):`, row);
        console.log(`  Length: ${row.length}`);
        // Show key columns we're interested in
        if (headers.length > 0) {
          const customerAccountIdx = headers.findIndex(h => String(h).includes('Customer Account'));
          const svcNameIdx = headers.findIndex(h => String(h).includes('Svc Name'));
          const commissionIdx = headers.findIndex(h => String(h).includes('Commission Amount (USD)'));
          const invoiceIdx = headers.findIndex(h => String(h).includes('Billed Amount (USD)'));
          
          if (customerAccountIdx >= 0) console.log(`  Customer Account [${customerAccountIdx}]:`, row[customerAccountIdx]);
          if (svcNameIdx >= 0) console.log(`  Svc Name [${svcNameIdx}]:`, row[svcNameIdx]);
          if (commissionIdx >= 0) console.log(`  Commission Amount (USD) [${commissionIdx}]:`, row[commissionIdx], `(type: ${typeof row[commissionIdx]})`);
          if (invoiceIdx >= 0) console.log(`  Billed Amount (USD) [${invoiceIdx}]:`, row[invoiceIdx], `(type: ${typeof row[invoiceIdx]})`);
        }
      });
    }
  } catch (e) {
    console.warn('Could not read as JSON:', e);
  }
  
  console.log('\n=== END HEADER ANALYSIS ===\n');
  
  // Now build the parser based on actual column structure
  // From logs: Customer Account [11], Svc Name [12], Billing Account Number [10], 
  // Commission Amount (USD) [32], Billed Amount (USD) [31]
  
  // Find column indices by exact header name matching
  const findColIndex = (headerName: string): number => {
    return headers.findIndex(h => String(h).trim() === headerName);
  };
  
  // Use exact column names from the actual file
  const customerAccountCol = findColIndex('Customer Account'); // Should be 11
  const billingAccountNumberCol = findColIndex('Billing Account Number'); // Should be 10
  const svcNameCol = findColIndex('Svc Name'); // Should be 12
  const commissionAmountCol = findColIndex('Commission Amount (USD)'); // Should be 32
  const billedAmountCol = findColIndex('Billed Amount (USD)'); // Should be 31
  const billDescriptionCol = findColIndex('Bill Description'); // Should be 19
  const billPeriodCol = findColIndex('Bill/Invoice Period'); // Should be 13
  const payThisReportingPeriodCol = findColIndex('Pay This Reporting Period');
  
  // State columns - check A Location or Z Location cities for state extraction
  const aLocationCityCol = findColIndex('A Location - City');
  const zLocationCityCol = findColIndex('Z Location - City');
  
  console.log('Zayo extractor - Column mapping:', {
    customerAccountCol,
    billingAccountNumberCol,
    svcNameCol,
    commissionAmountCol,
    billedAmountCol,
    billDescriptionCol,
    billPeriodCol,
    payThisReportingPeriodCol,
    aLocationCityCol,
    zLocationCityCol,
  });
  
  const rows: CarrierStatementRow[] = [];
  let processedCount = 0;
  let skippedCount = 0;

  // Only include rows that count toward the deposit total (Pay This Reporting Period = Yes).
  // We must extract every such row so unmatched-line reporting matches the deposit total.
  const payThisPeriodOk = (row: any[]): boolean => {
    if (payThisReportingPeriodCol < 0) return true;
    const payThisPeriod = String(row[payThisReportingPeriodCol] ?? '').trim().toLowerCase();
    return payThisPeriod === 'yes';
  };

  // Process data rows (skip first row which is headers, and skip empty rows)
  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];

    // Skip empty rows (all empty strings)
    if (row.every((cell: any) => !cell || String(cell).trim() === '')) {
      continue;
    }

    // Only extract rows that count toward deposit total (same set as raw total)
    if (!payThisPeriodOk(row)) {
      skippedCount++;
      continue;
    }

    // Extract fields using exact column indices
    const customerAccount = String(row[customerAccountCol] || '').trim();
    const billingAccountNumber = String(row[billingAccountNumberCol] || '').trim();
    const svcName = String(row[svcNameCol] || '').trim();
    const commissionAmountRaw = row[commissionAmountCol];
    const billedAmountRaw = row[billedAmountCol];
    const billDescription = billDescriptionCol >= 0 ? String(row[billDescriptionCol] || '').trim() : '';

    // Parse amounts - they should already be numbers, but handle strings too
    const commissionAmount = parseCurrency(commissionAmountRaw);
    const invoiceTotal = parseCurrency(billedAmountRaw);

    // Skip rows with no commission and no invoice (likely summary/total rows)
    if (commissionAmount === 0 && invoiceTotal === 0) {
      skippedCount++;
      continue;
    }

    // ENA Rule: If Svc Name is blank, use BAN as billing item, set Provider="ENA"
    let accountName = customerAccount || billingAccountNumber || billDescription || '(No account)';
    let billingItem = svcName || billingAccountNumber || billDescription || '(No billing item)';
    let provider = 'Zayo';

    if (!svcName && billingAccountNumber) {
      billingItem = billingAccountNumber; // Use BAN as billing item
      provider = 'ENA';
      if (!accountName || accountName === '(No account)') accountName = billingAccountNumber;
    }

    // Do NOT skip rows with blank account/billing item - use placeholders so every line
    // that counts toward deposit total is extracted and can appear in unmatched report.

    // State resolution - lookup from Master Data when we have a real billing item
    let state = getStateForBillingItem(billingItem);

    const billPeriod = billPeriodCol >= 0 ? String(row[billPeriodCol] || '').trim() : '';

    rows.push({
      state,
      accountName,
      accountNumber: billingAccountNumber,
      otgCompBillingItem: billingItem,
      invoiceTotal,
      commissionAmount,
      provider,
      carrierStatement: 'Zayo',
      billDescription: billDescription || undefined,
      billPeriod: billPeriod || undefined,
    });

    processedCount++;

    // Debug first few rows
    if (processedCount <= 3) {
      console.log(`Zayo extractor - Processed row ${processedCount}:`, {
        accountName,
        billingItem,
        invoiceTotal,
        commissionAmount,
        provider,
      });
    }
  }

  // Raw total = sum of commission for extracted rows (same set: Pay This Reporting Period = Yes)
  const rawTotalCommissionAmount = rows.reduce((sum, r) => sum + r.commissionAmount, 0);

  console.log(`Zayo extractor - Final summary:`, {
    totalRows: allData.length - 1,
    processed: processedCount,
    skipped: skippedCount,
    totalCommissionFromRows: rawTotalCommissionAmount,
    rawTotalCommissionAmount,
    totalInvoice: rows.reduce((sum, r) => sum + r.invoiceTotal, 0),
  });

  return { rows, rawTotalCommissionAmount };
};
