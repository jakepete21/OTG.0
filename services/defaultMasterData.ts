import * as XLSX from 'xlsx';

/**
 * Loads the default OTG.0 Comp Key CSV file as raw data.
 * This function reads the CSV file from the public directory and parses it into raw JSON format
 * that can be processed by MasterDataList's processImportData function.
 * 
 * @returns Raw data array that can be passed to processImportData
 */
export const loadDefaultMasterData = async (): Promise<any[]> => {
  try {
    // Fetch the CSV file from public directory
    const response = await fetch('/OTG.0 Comp Key AFTER 07_2025 - NEW Comp Key - 20260115_160812.csv');
    if (!response.ok) {
      throw new Error(`Failed to fetch default CSV file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    
    // Parse CSV using XLSX (handles multi-line headers and complex formats)
    const workbook = XLSX.read(arrayBuffer, { 
      type: 'array',
      sheetRows: undefined // Read all rows
    });
    
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    // Convert to JSON - XLSX handles multi-line headers by combining them
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      defval: '', // Default value for empty cells
      raw: false // Convert numbers/booleans to strings for consistent processing
    });

    if (!Array.isArray(rawData) || rawData.length === 0) {
      throw new Error('CSV file is empty or invalid');
    }

    // Normalize data keys (trim whitespace from headers, handle multi-line headers)
    // This matches the normalization logic in MasterDataList.processImportData
    const normalizedData = rawData.map((row: any) => {
      const newRow: any = {};
      Object.keys(row).forEach(k => {
        // Clean up multi-line headers by replacing newlines with spaces
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
    console.error('Error loading default master data:', error);
    throw new Error(`Failed to load default master data: ${error.message}`);
  }
};
