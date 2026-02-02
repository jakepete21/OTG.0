import { MasterRecord } from '../types';

/**
 * Google Sheets API Service
 * Handles OAuth 2.0 authentication and read/write operations
 */

const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4'];
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let gapiLoaded = false;
let gisLoaded = false;

// Load Google API libraries
export const loadGoogleAPIs = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (gapiLoaded && gisLoaded) {
      resolve();
      return;
    }

    // Load gapi (Google API client)
    const gapiScript = document.createElement('script');
    gapiScript.src = 'https://apis.google.com/js/api.js';
    gapiScript.onload = () => {
      window.gapi.load('client', () => {
        gapiLoaded = true;
        if (gisLoaded) resolve();
      });
    };
    gapiScript.onerror = () => reject(new Error('Failed to load Google API'));
    document.head.appendChild(gapiScript);

    // Load gis (Google Identity Services)
    const gisScript = document.createElement('script');
    gisScript.src = 'https://accounts.google.com/gsi/client';
    gisScript.onload = () => {
      gisLoaded = true;
      if (gapiLoaded) resolve();
    };
    gisScript.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(gisScript);
  });
};

// Initialize Google API client
export const initializeGoogleAPI = async (apiKey: string, clientId: string): Promise<void> => {
  await loadGoogleAPIs();
  
  await window.gapi.client.init({
    apiKey: apiKey,
    discoveryDocs: DISCOVERY_DOCS,
  });
};

// Authenticate user
export const authenticateUser = (clientId: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!window.google || !window.google.accounts) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        
        // Set token in gapi client
        if (window.gapi && window.gapi.client) {
          window.gapi.client.setToken({
            access_token: response.access_token,
            expires_in: response.expires_in,
            scope: response.scope,
          });
        }
        
        resolve(response.access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  return window.gapi?.client?.getToken() !== null;
};

// Get access token
export const getAccessToken = (): string | null => {
  const token = window.gapi?.client?.getToken();
  return token?.access_token || null;
};

// Sign out
export const signOut = (): void => {
  const token = window.gapi?.client?.getToken();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken('');
  }
};

/**
 * Read data from Google Sheet
 */
export const readSheetData = async (
  spreadsheetId: string,
  range: string
): Promise<any[][]> => {
  // Verify authentication
  const token = window.gapi?.client?.getToken();
  if (!token || !token.access_token) {
    throw new Error('Not authenticated. Please authenticate with Google first.');
  }

  try {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    if (response.error) {
      throw new Error(response.error.message || 'Failed to read sheet data');
    }

    return response.result.values || [];
  } catch (error: any) {
    // Re-throw with more context
    if (error.status === 400) {
      throw new Error(`Invalid request. Check spreadsheet ID (${spreadsheetId.substring(0, 20)}...) and range (${range})`);
    }
    if (error.status === 401 || error.status === 403) {
      throw new Error('Authentication failed. Please sign out and authenticate again.');
    }
    throw error;
  }
};

/**
 * Write data to Google Sheet
 */
export const writeSheetData = async (
  spreadsheetId: string,
  range: string,
  values: any[][]
): Promise<void> => {
  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    resource: {
      values,
    },
  });
};

/**
 * Append rows to Google Sheet
 */
export const appendSheetData = async (
  spreadsheetId: string,
  range: string,
  values: any[][]
): Promise<void> => {
  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values,
    },
  });
};

/**
 * Clear range in Google Sheet
 */
export const clearSheetRange = async (
  spreadsheetId: string,
  range: string
): Promise<void> => {
  await window.gapi.client.sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
  });
};

/**
 * Convert MasterRecord array to sheet rows (with headers)
 */
export const recordsToSheetRows = (records: MasterRecord[], columns: string[]): any[][] => {
  // First row is headers
  const rows: any[][] = [columns];
  
  // Add data rows
  records.forEach(record => {
    const row = columns.map(col => record[col] ?? '');
    rows.push(row);
  });
  
  return rows;
};

/**
 * Convert sheet rows to MasterRecord array
 * Uses headers from first row to preserve all columns and order
 */
export const sheetRowsToRecords = (rows: any[][]): MasterRecord[] => {
  if (rows.length === 0) return [];
  
  // First row contains headers - use these to preserve column order and all columns
  const headers = rows[0].map(h => String(h || '').trim()).filter(h => h !== '');
  
  if (headers.length === 0) return [];
  
  // Data rows start from row 1 (skip header row)
  const dataRows = rows.slice(1);
  
  return dataRows.map((row, idx) => {
    const record: any = {
      id: `master-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
    };
    
    // Map each header to its corresponding value in the row
    // Preserve ALL columns even if empty to maintain structure
    headers.forEach((header, colIdx) => {
      const value = row[colIdx];
      // Preserve the exact header name from the sheet
      // Include empty strings and null to maintain column structure
      if (value !== undefined) {
        record[header] = value === null ? '' : value;
      } else {
        // If column doesn't exist in row, set to empty string
        record[header] = '';
      }
    });
    
    // Set standard fields (for backward compatibility)
    record.clientName = record['Account **CARRIER**'] || '';
    record.serviceType = record['Service Provider'] || '';
    record.salesperson = record['COMP 1'] || '';
    
    // Try multiple possible field names for expected amount
    const monthlyUnitPrice = record['Monthly Unit Price Quantity x Price QRC/SEMI//YRC x 4, 6, or 12'] ||
                             record['Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)'] ||
                             record['Monthly Unit Price'] ||
                             0;
    record.expectedAmount = parseFloat(String(monthlyUnitPrice).replace(/[^0-9.-]+/g, '')) || 0;
    
    // Parse percentage - try multiple field name variations
    const compPercent = record['EXPECTED/Mo. OTG Comp % - column R Comp Key'] ||
                       record['EXPECTED/Mo. OTG Comp %'] ||
                       record['OTG Comp %'] ||
                       0;
    if (compPercent) {
      const num = parseFloat(String(compPercent).replace(/[^0-9.-]+/g, ''));
      record.splitPercentage = num > 1 ? num / 100 : num;
    } else {
      record.splitPercentage = 0;
    }
    
    return record as MasterRecord;
  });
};

// Extend Window interface for Google APIs
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}
