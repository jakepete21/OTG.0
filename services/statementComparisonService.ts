/**
 * Statement Comparison Service
 * Compares uploaded CSV/XLSX seller statements with Firebase seller statements
 */

import { SellerStatement, SellerStatementItem } from '../types';
import * as XLSX from 'xlsx';

export interface ComparisonItem {
  roleGroup: string;
  otgCompBillingItem: string;
  accountName: string;
  csvOtgComp: number;
  csvSellerComp: number;
  firebaseOtgComp: number;
  firebaseSellerComp: number;
  otgCompDiff: number;
  sellerCompDiff: number;
  status: 'match' | 'csv_only' | 'firebase_only' | 'difference';
}

export interface ComparisonResult {
  roleGroup: string;
  items: ComparisonItem[];
  csvTotalOtgComp: number;
  csvTotalSellerComp: number;
  firebaseTotalOtgComp: number;
  firebaseTotalSellerComp: number;
  otgCompDiff: number;
  sellerCompDiff: number;
  matchCount: number;
  csvOnlyCount: number;
  firebaseOnlyCount: number;
  differenceCount: number;
}

export interface StatementComparison {
  processingMonth: string;
  roleGroups: ComparisonResult[];
  overallCsvTotalOtgComp: number;
  overallCsvTotalSellerComp: number;
  overallFirebaseTotalOtgComp: number;
  overallFirebaseTotalSellerComp: number;
  overallOtgCompDiff: number;
  overallSellerCompDiff: number;
}

/**
 * Parse uploaded CSV/XLSX file into seller statements
 */
export function parseCsvToSellerStatements(file: File): Promise<SellerStatement[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const statements: SellerStatement[] = [];
        const roleGroupNames = ['RD1/2', 'RD3/4', 'RM1/2', 'RM3/4', 'OVR/RD5', 'OTG'];
        
        roleGroupNames.forEach(roleGroup => {
          const sheet = workbook.Sheets[roleGroup];
          if (!sheet) return;
          
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          if (rows.length < 2) return; // Need at least header + data
          
          // Find header row (usually first row)
          const headerRow = rows[0];
          const headerMap: Record<string, number> = {};
          headerRow.forEach((header, idx) => {
            if (header) {
              const headerStr = String(header).toLowerCase();
              headerMap[headerStr] = idx;
            }
          });
          
          // Map common column names
          const getCol = (names: string[]): number | null => {
            for (const name of names) {
              if (headerMap[name] !== undefined) {
                return headerMap[name];
              }
            }
            return null;
          };
          
          const stateCol = getCol(['state', 'st', 'state code']);
          const accountNameCol = getCol(['account name', 'account', 'customer name', 'client name']);
          const billingItemCol = getCol(['otg comp billing item', 'billing item', 'service number', 'otg comp billing']);
          const otgCompCol = getCol(['otg comp', 'commission amount', 'commission', 'otg commission']);
          const sellerCompCol = getCol(['seller comp', 'seller commission', 'role comp', 'comp']);
          
          if (!accountNameCol || !billingItemCol || !otgCompCol || !sellerCompCol) {
            console.warn(`[parseCsvToSellerStatements] Missing required columns for ${roleGroup}`);
            return;
          }
          
          const items: SellerStatementItem[] = [];
          let totalOtgComp = 0;
          let totalSellerComp = 0;
          
          // Process data rows (skip header)
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            
            const accountName = String(row[accountNameCol] || '').trim();
            const billingItem = String(row[billingItemCol] || '').trim();
            const otgComp = parseFloat(String(row[otgCompCol] || '0').replace(/[^0-9.\-]/g, '')) || 0;
            const sellerComp = parseFloat(String(row[sellerCompCol] || '0').replace(/[^0-9.\-]/g, '')) || 0;
            
            if (!accountName || !billingItem) continue;
            
            items.push({
              state: stateCol !== null ? String(row[stateCol] || '').trim() : '',
              accountName,
              otgCompBillingItem: billingItem,
              otgComp,
              sellerComp,
              provider: '', // CSV might not have this
            });
            
            totalOtgComp += otgComp;
            totalSellerComp += sellerComp;
          }
          
          if (items.length > 0) {
            statements.push({
              roleGroup,
              items,
              totalOtgComp,
              totalSellerComp,
            });
          }
        });
        
        resolve(statements);
      } catch (error: any) {
        reject(new Error(`Failed to parse CSV: ${error.message}`));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Compare CSV seller statements with Firebase seller statements
 */
export function compareStatements(
  csvStatements: SellerStatement[],
  firebaseStatements: SellerStatement[],
  processingMonth: string
): StatementComparison {
  // Create maps for quick lookup
  const csvMap = new Map<string, SellerStatement>();
  const firebaseMap = new Map<string, SellerStatement>();
  
  csvStatements.forEach(stmt => csvMap.set(stmt.roleGroup, stmt));
  firebaseStatements.forEach(stmt => firebaseMap.set(stmt.roleGroup, stmt));
  
  const allRoleGroups = new Set([...csvMap.keys(), ...firebaseMap.keys()]);
  const roleGroups: ComparisonResult[] = [];
  
  let overallCsvTotalOtgComp = 0;
  let overallCsvTotalSellerComp = 0;
  let overallFirebaseTotalOtgComp = 0;
  let overallFirebaseTotalSellerComp = 0;
  
  allRoleGroups.forEach(roleGroup => {
    const csvStmt = csvMap.get(roleGroup);
    const firebaseStmt = firebaseMap.get(roleGroup);
    
    // Create item maps for comparison
    const csvItemMap = new Map<string, SellerStatementItem>();
    const firebaseItemMap = new Map<string, SellerStatementItem>();
    
    if (csvStmt) {
      csvStmt.items.forEach(item => {
        const key = `${item.accountName}|${item.otgCompBillingItem}`;
        csvItemMap.set(key, item);
      });
    }
    
    if (firebaseStmt) {
      firebaseStmt.items.forEach(item => {
        const key = `${item.accountName}|${item.otgCompBillingItem}`;
        firebaseItemMap.set(key, item);
      });
    }
    
    const allItemKeys = new Set([...csvItemMap.keys(), ...firebaseItemMap.keys()]);
    const comparisonItems: ComparisonItem[] = [];
    
    let csvTotalOtgComp = 0;
    let csvTotalSellerComp = 0;
    let firebaseTotalOtgComp = 0;
    let firebaseTotalSellerComp = 0;
    let matchCount = 0;
    let csvOnlyCount = 0;
    let firebaseOnlyCount = 0;
    let differenceCount = 0;
    
    allItemKeys.forEach(key => {
      const csvItem = csvItemMap.get(key);
      const firebaseItem = firebaseItemMap.get(key);
      
      const csvOtgComp = csvItem?.otgComp || 0;
      const csvSellerComp = csvItem?.sellerComp || 0;
      const firebaseOtgComp = firebaseItem?.otgComp || 0;
      const firebaseSellerComp = firebaseItem?.sellerComp || 0;
      
      csvTotalOtgComp += csvOtgComp;
      csvTotalSellerComp += csvSellerComp;
      firebaseTotalOtgComp += firebaseOtgComp;
      firebaseTotalSellerComp += firebaseSellerComp;
      
      const otgCompDiff = csvOtgComp - firebaseOtgComp;
      const sellerCompDiff = csvSellerComp - firebaseSellerComp;
      
      let status: ComparisonItem['status'];
      if (!csvItem) {
        status = 'firebase_only';
        firebaseOnlyCount++;
      } else if (!firebaseItem) {
        status = 'csv_only';
        csvOnlyCount++;
      } else if (Math.abs(otgCompDiff) < 0.01 && Math.abs(sellerCompDiff) < 0.01) {
        status = 'match';
        matchCount++;
      } else {
        status = 'difference';
        differenceCount++;
      }
      
      comparisonItems.push({
        roleGroup,
        otgCompBillingItem: csvItem?.otgCompBillingItem || firebaseItem?.otgCompBillingItem || '',
        accountName: csvItem?.accountName || firebaseItem?.accountName || '',
        csvOtgComp,
        csvSellerComp,
        firebaseOtgComp,
        firebaseSellerComp,
        otgCompDiff,
        sellerCompDiff,
        status,
      });
    });
    
    const otgCompDiff = csvTotalOtgComp - firebaseTotalOtgComp;
    const sellerCompDiff = csvTotalSellerComp - firebaseTotalSellerComp;
    
    roleGroups.push({
      roleGroup,
      items: comparisonItems,
      csvTotalOtgComp,
      csvTotalSellerComp,
      firebaseTotalOtgComp,
      firebaseTotalSellerComp,
      otgCompDiff,
      sellerCompDiff,
      matchCount,
      csvOnlyCount,
      firebaseOnlyCount,
      differenceCount,
    });
    
    overallCsvTotalOtgComp += csvTotalOtgComp;
    overallCsvTotalSellerComp += csvTotalSellerComp;
    overallFirebaseTotalOtgComp += firebaseTotalOtgComp;
    overallFirebaseTotalSellerComp += firebaseTotalSellerComp;
  });
  
  return {
    processingMonth,
    roleGroups,
    overallCsvTotalOtgComp,
    overallCsvTotalSellerComp,
    overallFirebaseTotalOtgComp,
    overallFirebaseTotalSellerComp,
    overallOtgCompDiff: overallCsvTotalOtgComp - overallFirebaseTotalOtgComp,
    overallSellerCompDiff: overallCsvTotalSellerComp - overallFirebaseTotalSellerComp,
  };
}
