import { MasterRecord } from "../types";
import { CSVAnalysis } from "./csvAnalysisService";

/**
 * Cleans master data CSV based on Gemini analysis results.
 * Applies cleaning operations, removes duplicates, normalizes values, and converts to MasterRecord format.
 * 
 * @param csvData - Raw CSV data as array of objects (from XLSX parsing)
 * @param analysis - CSVAnalysis results from Gemini
 * @returns Cleaned MasterRecord array
 */
export const cleanMasterDataCSV = async (
  csvData: any[],
  analysis: CSVAnalysis
): Promise<MasterRecord[]> => {
  if (!csvData || csvData.length === 0) {
    throw new Error("CSV data is empty");
  }

  let cleanedData = [...csvData];

  // Helper to normalize header names (matches MasterDataList normalization)
  const normalizeHeader = (header: string): string => {
    return header.trim().replace(/^"|"$/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // Helper to get value from row using normalized header matching
  const getValue = (row: any, headerName: string): any => {
    // Try exact match first
    if (row[headerName] !== undefined) {
      return row[headerName];
    }
    
    // Try normalized match
    const normalizedTarget = normalizeHeader(headerName).toLowerCase();
    for (const key in row) {
      if (normalizeHeader(key).toLowerCase() === normalizedTarget) {
        return row[key];
      }
    }
    
    return undefined;
  };

  // Helper to parse currency strings "$1,200.00" -> 1200
  const parseCurrency = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val).replace(/[^0-9.-]+/g, "");
    return parseFloat(str) || 0;
  };

  // Helper to parse percentage "20%" -> 0.20, "0.2" -> 0.20
  const parsePercent = (val: any): number => {
    if (typeof val === 'number') {
      return val > 1 ? val / 100 : val; // Heuristic: 20 -> 0.2, 0.2 -> 0.2
    }
    if (!val) return 0;
    const cleanStr = String(val).replace(/[^0-9.-]+/g, "");
    let num = parseFloat(cleanStr);
    
    // If original string had %, divide by 100
    if (String(val).includes('%')) {
      num = num / 100;
    } 
    // If explicit number like "20" (likely 20%), treat as 0.2
    else if (num > 1) {
      num = num / 100;
    }
    return num || 0;
  };

  // Step 1: Remove empty rows
  cleanedData = cleanedData.filter(row => {
    const values = Object.values(row);
    return values.some(v => v !== '' && v !== null && v !== undefined);
  });

  // Step 2: Apply data normalization based on analysis
  if (analysis.dataNormalization && analysis.dataNormalization.length > 0) {
    cleanedData = cleanedData.map(row => {
      const normalizedRow = { ...row };
      
      analysis.dataNormalization.forEach(norm => {
        const value = getValue(normalizedRow, norm.column);
        if (value !== undefined && value !== null && value !== '') {
          // Apply normalization examples if provided
          if (norm.examples && norm.examples.length > 0) {
            const matchingExample = norm.examples.find(ex => 
              String(ex.from).toLowerCase() === String(value).toLowerCase()
            );
            if (matchingExample) {
              normalizedRow[norm.column] = matchingExample.to;
            }
          }
        }
      });
      
      return normalizedRow;
    });
  }

  // Step 3: Fix data types based on column mapping
  const columnMapping = analysis.columnMapping;
  
  cleanedData = cleanedData.map(row => {
    const fixedRow = { ...row };
    
    // Fix expectedAmount (Monthly Unit Price)
    if (columnMapping.expectedAmount) {
      const value = getValue(fixedRow, columnMapping.expectedAmount);
      if (value !== undefined) {
        fixedRow[columnMapping.expectedAmount] = parseCurrency(value);
      }
    }
    
    // Fix splitPercentage (EXPECTED/Mo. OTG Comp %)
    if (columnMapping.splitPercentage) {
      const value = getValue(fixedRow, columnMapping.splitPercentage);
      if (value !== undefined) {
        fixedRow[columnMapping.splitPercentage] = parsePercent(value);
      }
    }
    
    return fixedRow;
  });

  // Step 4: Remove duplicates based on duplicate detection method
  // Default: Use Account **CARRIER** + OTG Comp Billing item
  const duplicateKeyColumns: string[] = [];
  
  if (columnMapping.clientName) {
    duplicateKeyColumns.push(columnMapping.clientName);
  }
  if (columnMapping.otgCompBillingItem) {
    duplicateKeyColumns.push(columnMapping.otgCompBillingItem);
  }
  
  if (duplicateKeyColumns.length > 0) {
    const seen = new Set<string>();
    const uniqueData: any[] = [];
    
    cleanedData.forEach(row => {
      const duplicateKey = duplicateKeyColumns
        .map(col => {
          const val = getValue(row, col);
          return val !== undefined && val !== null ? String(val).trim().toLowerCase() : '';
        })
        .join('|||');
      
      if (!seen.has(duplicateKey)) {
        seen.add(duplicateKey);
        uniqueData.push(row);
      }
    });
    
    cleanedData = uniqueData;
  }

  // Step 5: Convert to MasterRecord format
  const masterRecords: MasterRecord[] = cleanedData.map((row, idx) => {
    const record: any = {
      id: `master-${Date.now()}-${idx}`
    };

    // Map essential fields
    if (columnMapping.clientName) {
      const value = getValue(row, columnMapping.clientName);
      record.clientName = value !== undefined && value !== null ? String(value).trim() : '';
    } else {
      record.clientName = '';
    }

    if (columnMapping.serviceType) {
      const value = getValue(row, columnMapping.serviceType);
      record.serviceType = value !== undefined && value !== null ? String(value).trim() : '';
    } else {
      record.serviceType = '';
    }

    if (columnMapping.salesperson) {
      const value = getValue(row, columnMapping.salesperson);
      record.salesperson = value !== undefined && value !== null ? String(value).trim() : '';
    } else {
      record.salesperson = '';
    }

    if (columnMapping.expectedAmount) {
      const value = getValue(row, columnMapping.expectedAmount);
      record.expectedAmount = parseCurrency(value);
    } else {
      record.expectedAmount = 0;
    }

    if (columnMapping.splitPercentage) {
      const value = getValue(row, columnMapping.splitPercentage);
      record.splitPercentage = parsePercent(value);
    } else {
      record.splitPercentage = 0.1; // Default 10%
    }

    // Copy all other columns as custom fields
    Object.keys(row).forEach(key => {
      // Skip if already mapped to standard field
      const normalizedKey = normalizeHeader(key).toLowerCase();
      const isMapped = 
        (columnMapping.clientName && normalizeHeader(columnMapping.clientName).toLowerCase() === normalizedKey) ||
        (columnMapping.serviceType && normalizeHeader(columnMapping.serviceType).toLowerCase() === normalizedKey) ||
        (columnMapping.salesperson && normalizeHeader(columnMapping.salesperson).toLowerCase() === normalizedKey) ||
        (columnMapping.expectedAmount && normalizeHeader(columnMapping.expectedAmount).toLowerCase() === normalizedKey) ||
        (columnMapping.splitPercentage && normalizeHeader(columnMapping.splitPercentage).toLowerCase() === normalizedKey);
      
      if (!isMapped && key !== 'id') {
        // Preserve original column name
        record[key] = row[key];
      }
    });

    return record as MasterRecord;
  });

  // Step 6: Filter out records missing essential fields
  const validRecords = masterRecords.filter(record => {
    // At minimum, we need clientName and otgCompBillingItem for matching
    const hasClientName = record.clientName && record.clientName.trim() !== '';
    
    // Check for OTG Comp Billing item in custom fields
    const hasBillingItem = Object.keys(record).some(key => {
      const normalizedKey = normalizeHeader(key).toLowerCase();
      return normalizedKey.includes('otg comp billing item') || normalizedKey.includes('billing item');
    });
    
    return hasClientName && hasBillingItem;
  });

  return validRecords;
};
