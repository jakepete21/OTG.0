/**
 * Statement Storage Service
 * Manages carrier statements organized by processing month
 */

import { CarrierStatementRow, MatchedRow, SellerStatement, Dispute } from '../types';
import { CarrierType } from './monthDetection';
import { getMonthKey, formatProcessingMonth } from './monthDetection';

export interface CarrierStatement {
  id: string;
  filename: string;
  carrier: CarrierType;
  statementMonth: Date;
  processingMonth: Date;
  uploadedAt: Date;
  rows: CarrierStatementRow[];
  matchedRows?: MatchedRow[];
  sellerStatements?: SellerStatement[];
  disputes?: Dispute[];
}

export interface ProcessingMonthData {
  monthKey: string;
  monthLabel: string;
  carriers: {
    GoTo?: CarrierStatement;
    Lumen?: CarrierStatement;
    MetTel?: CarrierStatement;
    TBO?: CarrierStatement;
    Zayo?: CarrierStatement;
    Allstream?: CarrierStatement;
  };
  status: 'complete' | 'partial' | 'empty';
  lastProcessedAt?: Date;
}

// In-memory storage (can be migrated to DB later)
let statementStorage: Map<string, ProcessingMonthData> = new Map();

/**
 * Gets all processing months
 */
export const getAllProcessingMonths = (): ProcessingMonthData[] => {
  return Array.from(statementStorage.values())
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
};

/**
 * Gets processing month data by key
 */
export const getProcessingMonth = (monthKey: string): ProcessingMonthData | null => {
  return statementStorage.get(monthKey) || null;
};

/**
 * Stores or updates a carrier statement
 */
export const storeCarrierStatement = (
  statement: CarrierStatement
): ProcessingMonthData => {
  const monthKey = getMonthKey(statement.processingMonth);
  const monthLabel = formatProcessingMonth(statement.processingMonth);
  
  let monthData = statementStorage.get(monthKey);
  
  if (!monthData) {
    monthData = {
      monthKey,
      monthLabel,
      carriers: {},
      status: 'empty',
    };
    statementStorage.set(monthKey, monthData);
  }
  
  // Store/update carrier statement
  monthData.carriers[statement.carrier] = statement;
  
  // Update status
  const carrierCount = Object.keys(monthData.carriers).length;
  const expectedCarrierCount = 6; // GoTo, Lumen, MetTel, TBO, Zayo, Allstream
  
  if (carrierCount === 0) {
    monthData.status = 'empty';
  } else if (carrierCount === expectedCarrierCount) {
    monthData.status = 'complete';
  } else {
    monthData.status = 'partial';
  }
  
  // Update last processed timestamp
  monthData.lastProcessedAt = new Date();
  
  return monthData;
};

/**
 * Gets carrier statement for a specific month and carrier
 */
export const getCarrierStatement = (
  monthKey: string,
  carrier: CarrierType
): CarrierStatement | null => {
  const monthData = statementStorage.get(monthKey);
  return monthData?.carriers[carrier] || null;
};

/**
 * Gets all carrier statements for a processing month
 */
export const getCarrierStatementsForMonth = (
  monthKey: string
): CarrierStatement[] => {
  const monthData = statementStorage.get(monthKey);
  if (!monthData) {
    return [];
  }
  
  return Object.values(monthData.carriers).filter(Boolean) as CarrierStatement[];
};

/**
 * Gets missing carriers for a processing month
 */
export const getMissingCarriers = (monthKey: string): CarrierType[] => {
  const monthData = statementStorage.get(monthKey);
  if (!monthData) {
    return ['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'];
  }
  
  const allCarriers: CarrierType[] = ['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'];
  return allCarriers.filter(carrier => !monthData.carriers[carrier]);
};

/**
 * Gets uploaded carriers for a processing month
 */
export const getUploadedCarriers = (monthKey: string): CarrierType[] => {
  const monthData = statementStorage.get(monthKey);
  if (!monthData) {
    return [];
  }
  
  return Object.keys(monthData.carriers).filter(Boolean) as CarrierType[];
};

/**
 * Combines all matched rows from all carriers for a processing month
 */
export const getCombinedMatchedRows = (monthKey: string): MatchedRow[] => {
  const statements = getCarrierStatementsForMonth(monthKey);
  const allMatchedRows: MatchedRow[] = [];
  
  statements.forEach(statement => {
    if (statement.matchedRows) {
      allMatchedRows.push(...statement.matchedRows);
    }
  });
  
  return allMatchedRows;
};

/**
 * Combines all disputes from all carriers for a processing month
 */
export const getCombinedDisputes = (monthKey: string): Dispute[] => {
  const statements = getCarrierStatementsForMonth(monthKey);
  const allDisputes: Dispute[] = [];
  
  statements.forEach(statement => {
    if (statement.disputes) {
      allDisputes.push(...statement.disputes);
    }
  });
  
  return allDisputes;
};

/**
 * Clears all storage (for testing/reset)
 */
export const clearStorage = (): void => {
  statementStorage.clear();
};
