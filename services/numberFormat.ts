/**
 * Number formatting utilities
 */

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
