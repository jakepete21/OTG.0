/**
 * Statement Comparison Service
 * Compares uploaded CSV/XLSX seller statements against Firebase seller statements
 */

import * as XLSX from 'xlsx';
import { SellerStatement, SellerStatementItem } from '../types';
import { GoogleGenAI, Type, Schema } from '@google/genai';

/**
 * Parsed statements from uploaded CSV/XLSX file
 */
export interface ParsedStatements {
  [roleGroup: string]: SellerStatementItem[];
}

/**
 * Result of parsing uploaded file
 */
export interface ParseResult {
  parsed: ParsedStatements;
  needsManualRoleGroup?: {
    headers: string[];
    rows: any[];
  };
}

/**
 * Matched item (no differences)
 */
export interface MatchedItem {
  csv: SellerStatementItem;
  firebase: SellerStatementItem;
}

/**
 * Difference item (has differences)
 */
export interface DifferenceItem {
  csv: SellerStatementItem;
  firebase: SellerStatementItem;
  differences: {
    field: string;
    csvValue: any;
    firebaseValue: any;
  }[];
}

/**
 * Comparison result for a role group
 */
export interface RoleGroupComparison {
  roleGroup: string;
  matched: MatchedItem[];
  differences: DifferenceItem[];
  missingInCsv: SellerStatementItem[]; // Items in Firebase but not in CSV
  missingInFirebase: SellerStatementItem[]; // Items in CSV but not in Firebase
  csvTotal: { otgComp: number; sellerComp: number };
  firebaseTotal: { otgComp: number; sellerComp: number };
  difference: { otgComp: number; sellerComp: number };
}

/**
 * Overall comparison result
 */
export interface ComparisonResult {
  processingMonth: string;
  roleGroups: RoleGroupComparison[];
  summary: {
    totalMatched: number;
    totalDifferences: number;
    totalCompared: number; // Total items that exist in both statements
  };
}

/**
 * Normalize a string for comparison (case-insensitive, trim whitespace, normalize special chars)
 */
const normalizeString = (str: string | null | undefined): string => {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
    .replace(/[-\u2013\u2014]/g, '-') // Normalize different dash types
    .replace(/['\u2018\u2019\u201A\u201B]/g, "'") // Normalize apostrophes
    .replace(/["\u201C\u201D\u201E\u201F]/g, '"') // Normalize quotes
    .replace(/\u00A0/g, ' '); // Replace non-breaking spaces
};

/**
 * Normalize a number (handle rounding, parse strings, handle accounting format)
 * Handles accounting format like "(292.12)" or "$ (8.76)" which should be negative
 * XLSX with raw:false may convert "(292.12)" to -292.12, or keep it as string "(292.12)"
 */
const normalizeNumber = (val: any, originalString?: string): number => {
  if (val === null || val === undefined || val === '') return 0;
  
  // If it's already a number, return it (XLSX may have already converted accounting format)
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  
  if (typeof val === 'string') {
    const str = String(val).trim();
    // Check for accounting format: parentheses indicate negative
    // Pattern: "(292.12)" or "$ (8.76)" or " (292.12)"
    const hasParentheses = (str.includes('(') && str.includes(')')) || 
                          (originalString && originalString.includes('(') && originalString.includes(')'));
    
    // Remove all non-numeric characters except decimal point and minus sign
    const cleaned = str.replace(/[^0-9.\-]/g, '');
    const num = parseFloat(cleaned);
    
    // If parentheses were present, make it negative
    if (hasParentheses) {
      return isNaN(num) ? 0 : -Math.abs(num);
    }
    
    // Check if string starts with minus
    if (str.startsWith('-')) {
      return isNaN(num) ? 0 : -Math.abs(num);
    }
    
    return isNaN(num) ? 0 : num;
  }
  
  return Number(val);
};

/** Round to 2 decimal places for consistent totals and comparison (avoids floating point and tolerance mismatches) */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Check if two numbers are equal after rounding to 2 decimals.
 * This keeps row-level "differences" in sync with total difference (no hidden rounding).
 */
const numbersEqual = (a: number, b: number): boolean => {
  return round2(a) === round2(b);
};

/**
 * Find column index by flexible matching (case-insensitive, partial matches)
 */
const findColumnIndex = (
  headers: string[],
  possibleNames: string[]
): number => {
  const normalizedHeaders = headers.map(h => normalizeString(h));
  
  for (const name of possibleNames) {
    const normalizedName = normalizeString(name);
    const index = normalizedHeaders.findIndex(h => 
      h.includes(normalizedName) || normalizedName.includes(h)
    );
    if (index !== -1) return index;
  }
  
  return -1;
};

/**
 * Use Gemini to detect column mappings for seller statement
 */
const detectColumnsWithGemini = async (
  headers: string[],
  sampleRows: any[]
): Promise<{
  stateColumn?: string;
  accountNameColumn?: string;
  billingItemColumn?: string;
  otgCompColumn?: string;
  sellerCompColumn?: string;
  providerColumn?: string;
  roleGroupColumn?: string;
}> => {
  if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) {
    return {};
  }

  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey: apiKey! });

  const schema: Schema = {
    type: Type.OBJECT,
    description: 'Column mappings for seller statement fields',
    properties: {
      stateColumn: { 
        type: Type.STRING, 
        nullable: true,
        description: 'Column name for State (2-letter state codes like WA, CA, AZ)' 
      },
      accountNameColumn: { 
        type: Type.STRING, 
        nullable: true,
        description: 'Column name for Account Name or Account **CARRIER**' 
      },
      billingItemColumn: { 
        type: Type.STRING, 
        nullable: true,
        description: 'Column name for OTG Comp Billing item or Billing Item' 
      },
      otgCompColumn: { 
        type: Type.STRING, 
        nullable: true,
        description: 'Column name for OTG Comp, Commission Amount, or Total Comp (numeric)' 
      },
      sellerCompColumn: { 
        type: Type.STRING, 
        nullable: true,
        description: 'Column name for Seller Comp or Role Comp (numeric)' 
      },
      providerColumn: { 
        type: Type.STRING, 
        nullable: true,
        description: 'Column name for Provider or Service Provider' 
      },
      roleGroupColumn: { 
        type: Type.STRING, 
        nullable: true,
        description: 'Column name for Role Group (values like RD1/2, RD3/4, RM1/2, RM3/4, OVR/RD5, OTG). IMPORTANT: This should contain role group values, NOT state codes!' 
      },
    },
  };

  const systemInstruction = `
    You are a Data Column Detection Assistant for seller commission statements.
    
    Analyze the provided headers and sample data to identify which columns map to:
    1. State - Should contain 2-letter state codes (WA, CA, AZ, etc.)
    2. Account Name - Account name or Account **CARRIER**
    3. Billing Item - OTG Comp Billing item or similar
    4. OTG Comp - Commission amount (numeric)
    5. Seller Comp - Role-specific commission (numeric)
    6. Provider - Service provider name
    7. Role Group - Should contain values like "RD1/2", "RD3/4", "RM1/2", "RM3/4", "OVR/RD5", "OTG"
    
    CRITICAL: A Role Group column should contain role group values (RD1/2, RD3/4, etc.), NOT state codes!
    If a column contains state codes (WA, CA, AZ, etc.), it is NOT a role group column.
    
    Return null for any columns that don't exist or can't be identified.
    Only return a roleGroupColumn if you find a column that actually contains role group values.
  `;

  const sampleData = {
    headers,
    sampleRows: sampleRows.slice(0, 10), // Send first 10 rows as sample
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ text: `Here are the column headers and sample data:\n${JSON.stringify(sampleData, null, 2)}` }]
      },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.1,
      }
    });

    const resultText = response.text;
    if (!resultText) {
      return {};
    }

    const cleaned = resultText.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    const result = JSON.parse(cleaned);
    
    return result;
  } catch {
    return {};
  }
};

/**
 * Map CSV row to SellerStatementItem using detected column mappings
 */
const mapCsvRowToItem = (
  row: any,
  headers: string[],
  columnMappings?: {
    stateColumn?: string;
    accountNameColumn?: string;
    billingItemColumn?: string;
    otgCompColumn?: string;
    sellerCompColumn?: string;
    providerColumn?: string;
  },
  sheetName?: string, // Pass sheet name to detect Allstream
  rowIndex?: number, // 0-based data row index (for XLSX accounting format lookup)
  accountingFormatMap?: Map<string, boolean> // map of "rowIdx_colName" -> true if cell has accounting format
): SellerStatementItem | null => {
  // Use column mappings if provided, otherwise fall back to flexible matching
  let stateIdx = -1;
  let accountNameIdx = -1;
  let billingItemIdx = -1;
  let otgCompIdx = -1;
  let sellerCompIdx = -1;
  let providerIdx = -1;

  if (columnMappings) {
    // Use Gemini-detected mappings
    stateIdx = columnMappings.stateColumn ? headers.indexOf(columnMappings.stateColumn) : -1;
    accountNameIdx = columnMappings.accountNameColumn ? headers.indexOf(columnMappings.accountNameColumn) : -1;
    billingItemIdx = columnMappings.billingItemColumn ? headers.indexOf(columnMappings.billingItemColumn) : -1;
    otgCompIdx = columnMappings.otgCompColumn ? headers.indexOf(columnMappings.otgCompColumn) : -1;
    sellerCompIdx = columnMappings.sellerCompColumn ? headers.indexOf(columnMappings.sellerCompColumn) : -1;
    providerIdx = columnMappings.providerColumn ? headers.indexOf(columnMappings.providerColumn) : -1;
  }

  // Fallback to flexible matching if mappings not found
  if (stateIdx < 0) stateIdx = findColumnIndex(headers, ['State', 'ST']);
  if (accountNameIdx < 0) accountNameIdx = findColumnIndex(headers, [
    'Account Name',
    'Account **CARRIER**',
    'Account CARRIER',
    'AccountName',
    'Account'
  ]);
  if (billingItemIdx < 0) billingItemIdx = findColumnIndex(headers, [
    'OTG Comp Billing item',
    'OTG Comp Billing Item',
    'Billing Item',
    'BillingItem'
  ]);
  if (otgCompIdx < 0) otgCompIdx = findColumnIndex(headers, [
    'OTG Comp',
    'Commission Amount',
    'Total Comp',
    'OTGComp',
    'Commission'
  ]);
  if (sellerCompIdx < 0) sellerCompIdx = findColumnIndex(headers, [
    'Seller Comp',
    'Role Comp',
    'SellerComp',
    'RoleComp'
  ]);
  if (providerIdx < 0) providerIdx = findColumnIndex(headers, ['Provider', 'Service Provider']);

  // Get values
  const state = stateIdx >= 0 ? String(row[headers[stateIdx]] || '').trim() : '';
  const accountName = accountNameIdx >= 0 ? String(row[headers[accountNameIdx]] || '').trim() : '';
  const otgCompBillingItem = billingItemIdx >= 0 ? String(row[headers[billingItemIdx]] || '').trim() : '';
  
  // Get raw values before normalization for debugging
  const rawOtgComp = otgCompIdx >= 0 ? row[headers[otgCompIdx]] : 0;
  const rawSellerComp = sellerCompIdx >= 0 ? row[headers[sellerCompIdx]] : 0;
  
  // Get original string representation if available (for accounting format detection)
  const rawOtgCompStr = otgCompIdx >= 0 ? String(row[headers[otgCompIdx]] || '') : '';
  const rawSellerCompStr = sellerCompIdx >= 0 ? String(row[headers[sellerCompIdx]] || '') : '';
  
  // Check if the raw value is already negative (XLSX may have converted accounting format)
  // For Allstream statements, negative values should be negative
  // If we have a positive number but the original CSV had parentheses, it should be negative
  let otgCompNeedsNegation = false;
  let sellerCompNeedsNegation = false;
  
  // Check if value is positive but should be negative based on accounting format
  // XLSX with raw:false converts "(13.65)" to 13.65 (positive), not -13.65
  // We need to check the cell format map built during XLSX parse (rowIdx_colName -> true)
  const isAllstreamSheet = sheetName && sheetName.toLowerCase().includes('allstream');
  
  if (typeof rowIndex === 'number' && accountingFormatMap && otgCompIdx >= 0 && sellerCompIdx >= 0) {
    const otgColName = headers[otgCompIdx];
    const sellerColName = headers[sellerCompIdx];
    const otgKey = `${rowIndex}_${otgColName}`;
    const sellerKey = `${rowIndex}_${sellerColName}`;
    if (typeof rawOtgComp === 'number' && rawOtgComp > 0 && accountingFormatMap.get(otgKey)) {
      otgCompNeedsNegation = true;
    }
    if (typeof rawSellerComp === 'number' && rawSellerComp > 0 && accountingFormatMap.get(sellerKey)) {
      sellerCompNeedsNegation = true;
    }
  }
  
  // Fallback: check if original string had parentheses (CSV or manual paste)
  if (typeof rawOtgComp === 'number' && rawOtgComp > 0 && !otgCompNeedsNegation) {
    if (rawOtgCompStr.includes('(') || rawOtgCompStr.includes(')')) {
      otgCompNeedsNegation = true;
    }
    else if (isAllstreamSheet && (otgCompBillingItem === '860324' || otgCompBillingItem === '643164')) {
      otgCompNeedsNegation = true;
    }
  }
  
  if (typeof rawSellerComp === 'number' && rawSellerComp > 0 && !sellerCompNeedsNegation) {
    if (rawSellerCompStr.includes('(') || rawSellerCompStr.includes(')')) {
      sellerCompNeedsNegation = true;
    }
    else if (isAllstreamSheet && (otgCompBillingItem === '860324' || otgCompBillingItem === '643164')) {
      sellerCompNeedsNegation = true;
    }
  }
  
  
  let otgComp = normalizeNumber(rawOtgComp, rawOtgCompStr);
  let sellerComp = normalizeNumber(rawSellerComp, rawSellerCompStr);
  
  // Apply negation if needed (XLSX converted accounting format to positive number)
  if (otgCompNeedsNegation && otgComp > 0) {
    otgComp = -otgComp;
  }
  if (sellerCompNeedsNegation && sellerComp > 0) {
    sellerComp = -sellerComp;
  }
  
  // Log normalized values for debugging
  if (otgCompBillingItem === '860324' || otgCompBillingItem === '643164' || otgCompBillingItem === '23563802') {
    console.log(`  Final OTG Comp:`, otgComp, `Final Seller Comp:`, sellerComp);
  }
  const provider = providerIdx >= 0 ? String(row[headers[providerIdx]] || '').trim() : '';
  
  // Skip rows missing essential fields
  if (!otgCompBillingItem || !accountName) {
    return null;
  }

  return {
    state,
    accountName,
    otgCompBillingItem,
    otgComp,
    sellerComp,
    provider,
  };
};

/**
 * Parse uploaded CSV/XLSX file into ParsedStatements
 * Returns parsed statements and optionally raw data if manual role group selection is needed
 */
export const parseUploadedStatements = async (
  file: File
): Promise<ParseResult> => {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });


  const parsed: ParsedStatements = {};

  // Map tab names to role groups (flexible matching)
  const roleGroupMap: { [key: string]: string } = {
    'rd1/2': 'RD1/2',
    'rd12': 'RD1/2',
    'rd1-2': 'RD1/2',
    'rd1_2': 'RD1/2',
    'rd3/4': 'RD3/4',
    'rd34': 'RD3/4',
    'rd3-4': 'RD3/4',
    'rd3_4': 'RD3/4',
    'rm1/2': 'RM1/2',
    'rm12': 'RM1/2',
    'rm1-2': 'RM1/2',
    'rm1_2': 'RM1/2',
    'rm3/4': 'RM3/4',
    'rm34': 'RM3/4',
    'rm3-4': 'RM3/4',
    'rm3_4': 'RM3/4',
    'ovr/rd5': 'OVR/RD5',
    'ovrrd5': 'OVR/RD5',
    'ovr-rd5': 'OVR/RD5',
    'ovr_rd5': 'OVR/RD5',
    'otg': 'OTG',
  };

  // Sheets to skip (not role group statements)
  const skipSheets = ['deposit totals', 'zayo', 'lumen', 'goto', 'tbo', 'mettel', 'allstream', 'matches'];

  // Track sheets that couldn't be matched for manual selection
  const unmatchedSheets: { headers: string[]; rows: any[]; sheetName: string }[] = [];

  // Process each sheet/tab
  for (const sheetName of workbook.SheetNames) {
    const normalizedSheetName = normalizeString(sheetName);
    
    // Skip non-role-group sheets immediately (no Gemini call needed)
    if (skipSheets.some(skip => normalizedSheetName.includes(skip))) {
      continue;
    }
    
    
    // Parse sheet
    // Use raw: false to get converted values, but we'll check for accounting format in the cell format
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false, // Convert values (XLSX converts accounting format)
    });
    
    // Build a map of cell formats for accounting detection
    // XLSX with raw:false converts "(13.65)" to 13.65, so we need to check cell formats
    const accountingFormatMap = new Map<string, boolean>();
    if (worksheet['!ref']) {
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      const headerRow = range.s.r;
      
      // Get headers first to map column indices
      const firstDataRow = XLSX.utils.sheet_to_json(worksheet, { defval: '', header: 1, range: 0 })[0] as any[];
      const headers = Object.keys(rawData[0] || {});
      
      // Check each data row for accounting format cells
      for (let R = headerRow + 1; R <= range.e.r && R < headerRow + 1 + rawData.length; R++) {
        for (let C = range.s.c; C <= range.e.c && C < headers.length; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = worksheet[cellAddress];
          if (cell && cell.z) {
            // Check if format contains accounting format indicators
            const format = cell.z;
            const isAccounting = format.includes('(') || format.includes('_(') || format.includes('_)') || 
                               format.includes('$') && format.includes('_');
            if (isAccounting) {
              const colName = headers[C];
              const rowIdx = R - headerRow - 1;
              accountingFormatMap.set(`${rowIdx}_${colName}`, true);
            }
          }
        }
      }
    }
    
    // Store accounting format map for use in mapCsvRowToItem
    (rawData as any).__accountingFormats = accountingFormatMap;

    if (!Array.isArray(rawData) || rawData.length === 0) {
      continue;
    }

    // Get headers (first row keys)
    const headers = Object.keys(rawData[0] || {});

    // Try to match role group from sheet name first (fast, no Gemini needed)
    let roleGroupFromSheetName: string | null = null;
    for (const [key, value] of Object.entries(roleGroupMap)) {
      if (normalizedSheetName.includes(key) || key.includes(normalizedSheetName)) {
        roleGroupFromSheetName = value;
        break;
      }
    }

    // If we found a role group from sheet name, use it directly (skip Gemini)
    if (roleGroupFromSheetName) {
      // Use Gemini only for column detection (not role group detection)
      const columnMappings = await detectColumnsWithGemini(headers, rawData.slice(0, 20));

      // Parse rows for this role group
      const items: SellerStatementItem[] = [];
      const accMap = (rawData as any).__accountingFormats as Map<string, boolean> | undefined;
      for (let i = 0; i < rawData.length; i++) {
        const item = mapCsvRowToItem(rawData[i], headers, columnMappings, sheetName, i, accMap);
        if (item) {
          items.push(item);
        }
      }

      parsed[roleGroupFromSheetName] = items;
      continue; // Skip to next sheet
    }

    // If sheet name doesn't match, check if there's a role group column (use Gemini)
    const columnMappings = await detectColumnsWithGemini(headers, rawData.slice(0, 20)); // Sample first 20 rows

    // If Gemini detected a role group column, use it
    if (columnMappings.roleGroupColumn) {
      const roleGroupColumnName = columnMappings.roleGroupColumn;
      const itemsByRoleGroup = new Map<string, SellerStatementItem[]>();


      // Parse rows and group by role group column
      const accMap = (rawData as any).__accountingFormats as Map<string, boolean> | undefined;
      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];
        const item = mapCsvRowToItem(row, headers, columnMappings, sheetName, i, accMap);
        if (item) {
          const rowRoleGroupValue = String(row[roleGroupColumnName] || '').trim();
          const rowRoleGroup = normalizeString(rowRoleGroupValue);
          
          // Find matching role group
          let matchedRoleGroup: string | null = null;
          for (const [key, value] of Object.entries(roleGroupMap)) {
            if (rowRoleGroup.includes(key) || key.includes(rowRoleGroup)) {
              matchedRoleGroup = value;
              break;
            }
          }

          // Try exact match
          if (!matchedRoleGroup) {
            const exactMatch = Object.values(roleGroupMap).find(
              rg => normalizeString(rg) === rowRoleGroup
            );
            if (exactMatch) {
              matchedRoleGroup = exactMatch;
            }
          }

          // If role group found, add to that group; otherwise skip
          if (matchedRoleGroup) {
            if (!itemsByRoleGroup.has(matchedRoleGroup)) {
              itemsByRoleGroup.set(matchedRoleGroup, []);
            }
            itemsByRoleGroup.get(matchedRoleGroup)!.push(item);
          }
        }
      }

      // Add grouped items to parsed result
      for (const [roleGroup, items] of itemsByRoleGroup.entries()) {
        parsed[roleGroup] = items;
      }

    } else {
      // No role group column - try to match by sheet name (XLSX with multiple tabs)
      let roleGroup: string | null = null;
      
      // Find matching role group from sheet name (improved matching)
      // Try various patterns: "RD1/2", "RD1-2", "RD12", "RD 1/2", etc.
      const sheetNameVariations = [
        normalizedSheetName,
        normalizedSheetName.replace(/[\s\-_]/g, ''),
        normalizedSheetName.replace(/[\s\-_]/g, '/'),
        normalizedSheetName.replace(/\//g, ''),
      ];

      for (const variation of sheetNameVariations) {
        for (const [key, value] of Object.entries(roleGroupMap)) {
          if (variation.includes(key) || key.includes(variation)) {
            roleGroup = value;
            break;
          }
        }
        if (roleGroup) break;
      }

      // If no match found, try exact match (case-insensitive)
      if (!roleGroup) {
        const exactMatch = Object.values(roleGroupMap).find(
          rg => {
            const normalizedRG = normalizeString(rg);
            return normalizedRG === normalizedSheetName || 
                   normalizedSheetName.includes(normalizedRG) ||
                   normalizedRG.includes(normalizedSheetName);
          }
        );
        if (exactMatch) {
          roleGroup = exactMatch;
        }
      }

      // If still no match, try to infer from filename
      if (!roleGroup) {
        const fileName = normalizeString(file.name);
        for (const [key, value] of Object.entries(roleGroupMap)) {
          if (fileName.includes(key)) {
            roleGroup = value;
            break;
          }
        }
      }

      // If no role group match, save for manual selection (don't return early)
      if (!roleGroup) {
        unmatchedSheets.push({ headers, rows: rawData, sheetName });
        continue; // Continue processing other sheets
      }

      // Parse rows for this role group
      const items: SellerStatementItem[] = [];
      const accMap = (rawData as any).__accountingFormats as Map<string, boolean> | undefined;
      for (let i = 0; i < rawData.length; i++) {
        const item = mapCsvRowToItem(rawData[i], headers, columnMappings, sheetName, i, accMap);
        if (item) {
          items.push(item);
        }
      }

      parsed[roleGroup] = items;
    }
  }

  // If we have parsed data, return it
  if (Object.keys(parsed).length > 0) {
    return { parsed };
  }
  
  // If no data was parsed, return first unmatched sheet for manual selection
  if (unmatchedSheets.length > 0) {
    const firstUnmatched = unmatchedSheets[0];
    return {
      parsed: {},
      needsManualRoleGroup: {
        headers: firstUnmatched.headers,
        rows: firstUnmatched.rows,
      },
    };
  }
  
  // No sheets or all sheets were empty
  return { parsed: {} };
};

/**
 * Parse raw CSV data with a manually selected role group
 */
export const parseRawDataWithRoleGroup = async (
  headers: string[],
  rows: any[],
  roleGroup: string
): Promise<ParsedStatements> => {
  // Use Gemini to detect columns
  const columnMappings = await detectColumnsWithGemini(headers, rows.slice(0, 20));
  
  const items: SellerStatementItem[] = [];
  
  // Check if this might be Allstream data based on headers/content
  const isAllstreamData = headers.some(h => h.toLowerCase().includes('allstream')) || 
                         rows.some((r: any) => Object.values(r).some((v: any) => String(v).toLowerCase().includes('allstream')));
  const sheetNameForManual = isAllstreamData ? 'Allstream' : 'Manual';
  
  for (const row of rows) {
    const item = mapCsvRowToItem(row, headers, columnMappings, sheetNameForManual);
    if (item) {
      items.push(item);
    }
  }
  
  return {
    [roleGroup]: items,
  };
};

/**
 * Create a matching key from item (for matching items between CSV and Firebase)
 */
const createMatchKey = (item: SellerStatementItem): string => {
  const billingItem = normalizeString(item.otgCompBillingItem);
  const accountName = normalizeString(item.accountName);
  const key = `${billingItem}||${accountName}`;
  
  return key;
};

/**
 * Compare two items and return differences
 */
const compareItems = (
  csv: SellerStatementItem,
  firebase: SellerStatementItem
): { field: string; csvValue: any; firebaseValue: any }[] => {
  const differences: { field: string; csvValue: any; firebaseValue: any }[] = [];

  if (!numbersEqual(csv.otgComp, firebase.otgComp)) {
    differences.push({
      field: 'otgComp',
      csvValue: csv.otgComp,
      firebaseValue: firebase.otgComp,
    });
  }

  if (!numbersEqual(csv.sellerComp, firebase.sellerComp)) {
    differences.push({
      field: 'sellerComp',
      csvValue: csv.sellerComp,
      firebaseValue: firebase.sellerComp,
    });
  }

  if (normalizeString(csv.state) !== normalizeString(firebase.state)) {
    differences.push({
      field: 'state',
      csvValue: csv.state,
      firebaseValue: firebase.state,
    });
  }

  if (normalizeString(csv.accountName) !== normalizeString(firebase.accountName)) {
    differences.push({
      field: 'accountName',
      csvValue: csv.accountName,
      firebaseValue: firebase.accountName,
    });
  }

  if (normalizeString(csv.provider) !== normalizeString(firebase.provider)) {
    differences.push({
      field: 'provider',
      csvValue: csv.provider,
      firebaseValue: firebase.provider,
    });
  }

  return differences;
};

/**
 * Compare parsed CSV statements against Firebase seller statements
 */
export const compareStatements = async (
  csvStatements: ParsedStatements,
  firebaseStatements: SellerStatement[],
  processingMonth: string
): Promise<ComparisonResult> => {
  const roleGroups: RoleGroupComparison[] = [];
  const expectedRoleGroups = ['RD1/2', 'RD3/4', 'RM1/2', 'RM3/4', 'OVR/RD5', 'OTG'];

  // Group Firebase statements by roleGroup
  const firebaseByRoleGroup = new Map<string, SellerStatementItem[]>();
  for (const stmt of firebaseStatements) {
    firebaseByRoleGroup.set(stmt.roleGroup, stmt.items);
  }

  // Process each role group
  for (const roleGroup of expectedRoleGroups) {
    const csvItems = csvStatements[roleGroup] || [];
    const firebaseItems = firebaseByRoleGroup.get(roleGroup) || [];

    // Create maps for matching
    const csvMap = new Map<string, SellerStatementItem>();
    const firebaseMap = new Map<string, SellerStatementItem>();

    for (const item of csvItems) {
      csvMap.set(createMatchKey(item), item);
    }

    for (const item of firebaseItems) {
      firebaseMap.set(createMatchKey(item), item);
    }

    // Find matched items (only items that exist in BOTH statements)
    const matched: MatchedItem[] = [];
    const differences: DifferenceItem[] = [];

    for (const [key, csvItem] of csvMap.entries()) {
      const firebaseItem = firebaseMap.get(key);
      if (firebaseItem) {
        const itemDifferences = compareItems(csvItem, firebaseItem);
        if (itemDifferences.length === 0) {
          matched.push({ csv: csvItem, firebase: firebaseItem });
        } else {
          differences.push({
            csv: csvItem,
            firebase: firebaseItem,
            differences: itemDifferences,
          });
        }
        // Remove from both maps since we've processed this match
        firebaseMap.delete(key);
        csvMap.delete(key);
      }
    }

    // After matching loop, collect missing items
    // Items in Firebase but not in CSV (remaining in firebaseMap after matching)
    const missingInCsv: SellerStatementItem[] = Array.from(firebaseMap.values());
    
    // Items in CSV but not in Firebase (remaining in csvMap after matching)
    const missingInFirebase: SellerStatementItem[] = Array.from(csvMap.values());

    // Calculate totals from ALL items using rounded values (2 decimals).
    // This keeps displayed totals in sync with row-level comparison (same round2 used in compareItems).
    const csvTotal = {
      otgComp: csvItems.reduce((sum, item) => sum + round2(item.otgComp), 0),
      sellerComp: csvItems.reduce((sum, item) => sum + round2(item.sellerComp), 0),
    };

    const firebaseTotal = {
      otgComp: firebaseItems.reduce((sum, item) => sum + round2(item.otgComp), 0),
      sellerComp: firebaseItems.reduce((sum, item) => sum + round2(item.sellerComp), 0),
    };

    const difference = {
      otgComp: round2(csvTotal.otgComp - firebaseTotal.otgComp),
      sellerComp: round2(csvTotal.sellerComp - firebaseTotal.sellerComp),
    };

    // RM1/2 only: log every line item and totals from XLSX and from Firebase
    if (roleGroup === 'RM1/2') {
      console.log('[RM1/2 XLSX] Line items:', csvItems.length);
      csvItems.forEach((item, i) => {
        console.log(`  [${i + 1}] BillingItem=${item.otgCompBillingItem}, Account=${item.accountName}, otgComp=${item.otgComp}, sellerComp=${item.sellerComp}`);
      });
      console.log('[RM1/2 XLSX] Totals: otgComp=', csvTotal.otgComp, ', sellerComp=', csvTotal.sellerComp);
      console.log('[RM1/2 Firebase] Line items:', firebaseItems.length);
      firebaseItems.forEach((item, i) => {
        console.log(`  [${i + 1}] BillingItem=${item.otgCompBillingItem}, Account=${item.accountName}, otgComp=${item.otgComp}, sellerComp=${item.sellerComp}`);
      });
      console.log('[RM1/2 Firebase] Totals: otgComp=', firebaseTotal.otgComp, ', sellerComp=', firebaseTotal.sellerComp);
    }

    roleGroups.push({
      roleGroup,
      matched,
      differences,
      missingInCsv,
      missingInFirebase,
      csvTotal,
      firebaseTotal,
      difference,
    });
  }

  const summary = {
    totalMatched: roleGroups.reduce((sum, rg) => sum + rg.matched.length, 0),
    totalDifferences: roleGroups.reduce((sum, rg) => sum + rg.differences.length, 0),
    totalCompared: roleGroups.reduce((sum, rg) => sum + rg.matched.length + rg.differences.length, 0),
  };

  return {
    processingMonth,
    roleGroups,
    summary,
  };
};
