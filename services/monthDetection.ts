/**
 * Month Detection Service
 * Detects statement month from filename/content and calculates processing month using carrier offsets
 */

export type CarrierType = 'GoTo' | 'Lumen' | 'MetTel' | 'TBO' | 'Zayo' | 'Allstream';

// Carrier month offsets (how many months to add to statement month to get processing month)
const CARRIER_OFFSETS: Record<CarrierType, number> = {
  GoTo: 1,      // +1 month
  Lumen: 3,     // +3 months
  MetTel: 2,    // +2 months
  TBO: 1,       // +1 month
  Zayo: 2,      // +2 months
  Allstream: 2, // +2 months
};

/**
 * Detects carrier type from filename
 */
export const detectCarrierFromFilename = (filename: string): CarrierType | null => {
  const lower = filename.toLowerCase();
  if (lower.includes('zayo')) return 'Zayo';
  if (lower.includes('lumen') || lower.includes('level 3') || lower.includes('level3')) return 'Lumen';
  if (lower.includes('goto')) return 'GoTo';
  if (lower.includes('tbo')) return 'TBO';
  if (lower.includes('mettel') || lower.includes('met tel')) return 'MetTel';
  if (lower.includes('allstream') || lower.includes('onetel')) return 'Allstream';
  return null;
};

/**
 * Detects statement month from filename
 * Looks for patterns like:
 * - YYYY-MM (e.g., "2025-10", "2025-10-15")
 * - Month names (e.g., "October 2025", "Oct 2025")
 * - Month abbreviations (e.g., "Oct", "Dec")
 */
export const detectStatementMonth = (filename: string, content?: string): Date | null => {
  const text = `${filename} ${content || ''}`.toLowerCase();
  
  // Try YYYY-MM pattern first (most reliable)
  // Use the FIRST occurrence found in the filename
  const yyyyMmMatch = text.match(/(\d{4})-(\d{1,2})/);
  if (yyyyMmMatch) {
    const year = parseInt(yyyyMmMatch[1], 10);
    const month = parseInt(yyyyMmMatch[2], 10) - 1; // JS months are 0-indexed
    if (year >= 2020 && year <= 2100 && month >= 0 && month <= 11) {
      if (text.includes('zayo')) {
        console.log(`[detectStatementMonth] Zayo detected first YYYY-MM pattern: ${year}-${month + 1}`);
      }
      return new Date(year, month, 1);
    }
  }
  
  // Try month name patterns
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const monthAbbrs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  for (let i = 0; i < monthNames.length; i++) {
    const fullName = monthNames[i];
    const abbr = monthAbbrs[i];
    
    // Look for "month year" or "month, year" pattern
    const fullPattern = new RegExp(`(${fullName}|${abbr})\\s*(?:,|\\s+)(\\d{4})`, 'i');
    const match = text.match(fullPattern);
    if (match) {
      const year = parseInt(match[2], 10);
      if (year >= 2020 && year <= 2100) {
        return new Date(year, i, 1);
      }
    }
    
    // Look for "year month" pattern
    const reversePattern = new RegExp(`(\\d{4})\\s*(?:,|\\s+)(${fullName}|${abbr})`, 'i');
    const reverseMatch = text.match(reversePattern);
    if (reverseMatch) {
      const year = parseInt(reverseMatch[1], 10);
      if (year >= 2020 && year <= 2100) {
        return new Date(year, i, 1);
      }
    }
  }
  
  // Fallback: try to find year and infer month from context
  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    // Default to current month if year found but no month
    // This is a fallback - ideally we'd have month info
    return new Date(year, new Date().getMonth(), 1);
  }
  
  return null;
};

/**
 * Calculates processing month from statement month using carrier offset
 */
export const calculateProcessingMonth = (
  statementMonth: Date,
  carrier: CarrierType
): Date => {
  const offset = CARRIER_OFFSETS[carrier];
  const processingDate = new Date(statementMonth);
  processingDate.setMonth(processingDate.getMonth() + offset);
  return processingDate;
};

/**
 * Formats a date as "Month YYYY" (e.g., "December 2025")
 */
export const formatProcessingMonth = (date: Date): string => {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
};

/**
 * Gets a month key string for storage (e.g., "2025-12")
 */
export const getMonthKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

/**
 * Parses a month key back to a Date
 */
export const parseMonthKey = (key: string): Date => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

/**
 * Detects carrier and statement month from filename/content
 */
export interface DetectionResult {
  carrier: CarrierType | null;
  statementMonth: Date | null;
  processingMonth: Date | null;
  processingMonthKey: string | null;
  processingMonthLabel: string | null;
}

export const detectCarrierAndMonth = (
  filename: string,
  content?: string
): DetectionResult => {
  const carrier = detectCarrierFromFilename(filename);
  const statementMonth = detectStatementMonth(filename, content);
  
  let processingMonth: Date | null = null;
  let processingMonthKey: string | null = null;
  let processingMonthLabel: string | null = null;
  
  if (carrier && statementMonth) {
    processingMonth = calculateProcessingMonth(statementMonth, carrier);
    processingMonthKey = getMonthKey(processingMonth);
    processingMonthLabel = formatProcessingMonth(processingMonth);
    
    // Diagnostic logging for Zayo files
    if (carrier === 'Zayo') {
      console.log(`[detectCarrierAndMonth] ZAYO DETECTION:`);
      console.log(`  Filename: ${filename}`);
      console.log(`  Detected statementMonth: ${getMonthKey(statementMonth)} (${formatProcessingMonth(statementMonth)})`);
      console.log(`  Calculated processingMonth: ${processingMonthKey} (${processingMonthLabel})`);
      console.log(`  Zayo offset: +2 months`);
    }
  }
  
  return {
    carrier,
    statementMonth,
    processingMonth,
    processingMonthKey,
    processingMonthLabel,
  };
};
