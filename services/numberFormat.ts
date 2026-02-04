/**
 * Number formatting utilities
 */

/**
 * Parses currency from string or number. Use for all carrier statements and CSVs.
 * Treats accounting format as negative: (123.45) and -123.45 both become -123.45.
 * When reading XLSX with raw: true, Excel already stores (123.45) as -123.45.
 */
export const parseCurrency = (val: any): number => {
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  if (val == null || val === '') {
    return 0;
  }
  const str = String(val).trim();
  if (!str) return 0;
  const isNegative = str.startsWith('-') || str.startsWith('(') || str.includes('(');
  const cleaned = str.replace(/[\$,()]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNegative ? -Math.abs(num) : num;
};

/**
 * Formats a number with commas and optional decimal places
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string with commas
 */
export const formatNumber = (value: number | string | null | undefined, decimals: number = 2): string => {
  if (value === null || value === undefined || value === '') {
    return '0.00';
  }
  
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numValue)) {
    return '0.00';
  }
  
  return numValue.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/**
 * Formats a currency value with dollar sign, commas, and 2 decimal places
 * @param value - The number to format
 * @returns Formatted string like "$1,234.56"
 */
export const formatCurrency = (value: number | string | null | undefined): string => {
  return `$${formatNumber(value, 2)}`;
};

/**
 * Formats a number with commas but no decimal places (for whole numbers)
 * @param value - The number to format
 * @returns Formatted string with commas, no decimals
 */
export const formatWholeNumber = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '0';
  }
  
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numValue)) {
    return '0';
  }
  
  return numValue.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};
