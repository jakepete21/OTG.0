import * as XLSX from 'xlsx';

/**
 * Loads the reformatted OTG.0 Comp Key CSV file as raw data.
 * This function reads the reformatted CSV file and parses it into raw JSON format.
 * 
 * @returns Raw data array that can be processed by MasterDataList2
 */
export const loadReformattedMasterData = async (): Promise<any[]> => {
  try {
    // Fetch the reformatted CSV file from public directory
    const response = await fetch('/OTG.0 Comp Key AFTER 07_2025 - NEW Comp Key - 20260115_160812_REFORMATTED.csv');
    if (!response.ok) {
      throw new Error(`Failed to fetch reformatted CSV file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    
    // Parse CSV using XLSX
    const workbook = XLSX.read(arrayBuffer, { 
      type: 'array',
      sheetRows: undefined // Read all rows
    });
    
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    // Convert to JSON
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      defval: '', // Default value for empty cells
      raw: false // Convert numbers/booleans to strings for consistent processing
    });

    if (!Array.isArray(rawData) || rawData.length === 0) {
      throw new Error('CSV file is empty or invalid');
    }

    // Normalize data keys (trim whitespace from headers)
    const normalizedData = rawData.map((row: any) => {
      const newRow: any = {};
      Object.keys(row).forEach(k => {
        const cleanKey = k.trim().replace(/^"|"$/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        const cleanValue = typeof row[k] === 'string' ? row[k].trim() : row[k];
        newRow[cleanKey] = cleanValue;
      });
      return newRow;
    });

    // Filter out completely empty rows
    const validRows = normalizedData.filter((row: any) => {
      const values = Object.values(row);
      return values.some(v => v !== '' && v !== null && v !== undefined);
    });

    if (validRows.length === 0) {
      throw new Error('No valid rows found in CSV file');
    }

    return validRows;
  } catch (error: any) {
    console.error('Error loading reformatted master data:', error);
    throw new Error(`Failed to load reformatted master data: ${error.message}`);
  }
};
