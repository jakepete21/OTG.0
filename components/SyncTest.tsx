import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { MasterRecord } from '../types';
import { 
  loadGoogleAPIs, 
  initializeGoogleAPI, 
  authenticateUser, 
  signOut,
  readSheetData,
  recordsToSheetRows,
  sheetRowsToRecords,
} from '../services/googleSheetsService';
import { 
  RefreshCw, 
  LogIn, 
  LogOut, 
  Download, 
  AlertCircle, 
  CheckCircle, 
  X,
  Loader2,
  Info
} from 'lucide-react';

interface SyncTestProps {
  masterData: MasterRecord[];
  columns: string[];
  onUpdate: (updatedRecords: MasterRecord[]) => void;
}

const SyncTest: React.FC<SyncTestProps> = ({ masterData, columns, onUpdate }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticatedState] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetTabName, setSheetTabName] = useState('Sheet1');
  const [sheetRange, setSheetRange] = useState('A1:ZZ');
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [sheetData, setSheetData] = useState<MasterRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Helper to extract spreadsheet ID from URL or return as-is
  const extractSpreadsheetId = (input: string): string => {
    if (!input) return '';
    if (!input.includes('/')) return input.trim();
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match && match[1] ? match[1] : input.trim();
  };

  // Helper to build full range string
  const getFullRange = useCallback((tabName: string, range: string): string => {
    return `${tabName}!${range}`;
  }, []);

  // Load API keys and spreadsheet ID from environment or localStorage
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || localStorage.getItem('google_api_key') || '';
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem('google_client_id') || '';
    const savedSpreadsheetId = localStorage.getItem('google_spreadsheet_id') || '';
    const savedTabName = localStorage.getItem('google_sheet_tab_name') || 'Sheet1';
    const savedRange = localStorage.getItem('google_sheet_range') || 'A1:ZZ';
    
    setGoogleApiKey(apiKey);
    setGoogleClientId(clientId);
    if (savedSpreadsheetId) {
      setSpreadsheetId(savedSpreadsheetId);
    }
    setSheetTabName(savedTabName);
    setSheetRange(savedRange);
    
    // Check if already authenticated
    if (apiKey && clientId) {
      loadGoogleAPIs().then(() => {
        initializeGoogleAPI(apiKey, clientId).then(() => {
          try {
            const authStatus = window.gapi?.client?.getToken() !== null;
            setIsAuthenticatedState(authStatus);
          } catch (err) {
            setIsAuthenticatedState(false);
          }
        }).catch(console.error);
      }).catch(console.error);
    }
  }, []);

  const handleAuthenticate = useCallback(async () => {
    if (!googleApiKey || !googleClientId) {
      setError('Please enter Google API Key and Client ID');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await loadGoogleAPIs();
      await initializeGoogleAPI(googleApiKey, googleClientId);
      const accessToken = await authenticateUser(googleClientId);
      
      if (accessToken) {
        window.gapi.client.setToken({ access_token: accessToken });
      }
      
      const token = window.gapi?.client?.getToken();
      if (!token || !token.access_token) {
        throw new Error('Authentication completed but token not available');
      }
      
      setIsAuthenticatedState(true);
      localStorage.setItem('google_api_key', googleApiKey);
      localStorage.setItem('google_client_id', googleClientId);
    } catch (err: any) {
      console.error('Authentication error:', err);
      setError(`Authentication failed: ${err.message || err.error || 'Unknown error'}`);
      setIsAuthenticatedState(false);
    } finally {
      setIsLoading(false);
    }
  }, [googleApiKey, googleClientId]);

  const handleSignOut = useCallback(() => {
    signOut();
    setIsAuthenticatedState(false);
  }, []);

  const handleLoadSheet = useCallback(async () => {
    const cleanedId = extractSpreadsheetId(spreadsheetId);
    
    if (!cleanedId.trim()) {
      setError('Please enter Spreadsheet ID');
      return;
    }

    if (cleanedId !== spreadsheetId) {
      setSpreadsheetId(cleanedId);
      localStorage.setItem('google_spreadsheet_id', cleanedId);
    }

    if (!isAuthenticated) {
      setError('Please authenticate with Google first');
      return;
    }

    try {
      const token = window.gapi?.client?.getToken();
      if (!token || !token.access_token) {
        setError('Authentication token expired. Please sign out and authenticate again.');
        setIsAuthenticatedState(false);
        return;
      }
    } catch (err) {
      setError('Authentication check failed. Please sign out and authenticate again.');
      setIsAuthenticatedState(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setSyncStatus(null);

    try {
      const fullRange = getFullRange(sheetTabName, sheetRange);
      console.log('Loading sheet with ID:', cleanedId, 'Tab:', sheetTabName, 'Range:', fullRange);
      const rows = await readSheetData(cleanedId, fullRange);
      
      // Convert sheet rows to records - preserves all columns and order from sheet headers
      const records = sheetRowsToRecords(rows);
      
      setSheetData(records);
      setSyncStatus(`Loaded ${records.length} records from sheet. Ready to sync.`);
    } catch (err: any) {
      console.error('Error loading sheet:', err);
      
      let errorMessage = 'Failed to load sheet';
      if (err.status === 400) {
        const fullRange = getFullRange(sheetTabName, sheetRange);
        errorMessage = `Bad Request (400). Check Spreadsheet ID, Tab Name (${sheetTabName}), and Range (${fullRange}).`;
      } else if (err.status === 401) {
        errorMessage = 'Unauthorized (401). Please sign out and authenticate again.';
        setIsAuthenticatedState(false);
      } else if (err.status === 403) {
        errorMessage = 'Permission denied (403). Make sure you have access to this spreadsheet.';
      } else if (err.status === 404) {
        errorMessage = `Spreadsheet not found (404). Check the Spreadsheet ID: ${cleanedId.substring(0, 30)}...`;
      } else if (err.message) {
        errorMessage = `Error: ${err.message}`;
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [spreadsheetId, sheetTabName, sheetRange, isAuthenticated, getFullRange]);

  const handleSyncToDatabase = useCallback(async () => {
    if (sheetData.length === 0) {
      setError('Please load sheet data first');
      return;
    }

    if (!confirm(`This will replace your entire database (${masterData.length} records) with the Google Sheet data (${sheetData.length} records). This action cannot be undone. Continue?`)) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setSyncStatus(null);

    try {
      // Create map of existing records by Account + Billing Item to preserve IDs where possible
      const existingRecordsByKey = new Map<string, MasterRecord[]>();
      
      masterData.forEach(record => {
        const accountCarrier = record['Account **CARRIER**'] || record.clientName || '';
        const billingItem = record['OTG Comp Billing item'] || '';
        const key = `${accountCarrier}|||${billingItem}`;
        
        if (!existingRecordsByKey.has(key)) {
          existingRecordsByKey.set(key, []);
        }
        existingRecordsByKey.get(key)!.push(record);
      });
      
      // Track which existing records we've used to avoid reusing IDs
      const usedRecordIds = new Set<string>();
      
      // Process all sheet records - these become the new database
      const finalRecords: MasterRecord[] = [];
      
      sheetData.forEach((sheetRecord, index) => {
        const accountCarrier = sheetRecord['Account **CARRIER**'] || sheetRecord.clientName || '';
        const billingItem = sheetRecord['OTG Comp Billing item'] || '';
        const key = `${accountCarrier}|||${billingItem}`;
        
        // Find unused existing records with the same Account + Billing Item
        const existingRecords = existingRecordsByKey.get(key) || [];
        const unusedExisting = existingRecords.find(r => !usedRecordIds.has(r.id));
        
        let recordId: string;
        if (unusedExisting) {
          // Use existing ID and mark it as used
          recordId = unusedExisting.id;
          usedRecordIds.add(recordId);
        } else {
          // Generate new ID if no unused existing record found
          recordId = `master-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`;
        }
        
        // Preserve all columns from sheet record exactly as they are
        const finalRecord: MasterRecord = {
          ...sheetRecord,
          id: recordId
        };
        
        finalRecords.push(finalRecord);
      });

      // Replace entire database with sheet data
      await onUpdate(finalRecords);
      
      setSyncStatus(`Successfully synced ${finalRecords.length} records to database. Database now matches Google Sheet exactly.`);
      setError(null);
    } catch (err: any) {
      console.error('Error syncing to database:', err);
      setError(`Failed to sync to database: ${err.message || 'Unknown error'}`);
      setSyncStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [sheetData, masterData, onUpdate]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Sync Test</h2>
          <p className="text-slate-500 text-sm mt-1">
            Sync Google Sheet data to database - maintains all columns and account/line item structure
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {syncStatus && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <CheckCircle size={20} />
          <span>{syncStatus}</span>
        </div>
      )}

      {/* Authentication Section */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Google Sheets Connection</h3>
        
        {!isAuthenticated ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Google API Key
                </label>
                <input
                  type="text"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={googleApiKey}
                  onChange={e => setGoogleApiKey(e.target.value)}
                  placeholder="Enter Google API Key"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Google Client ID
                </label>
                <input
                  type="text"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={googleClientId}
                  onChange={e => setGoogleClientId(e.target.value)}
                  placeholder="Enter Google Client ID"
                />
              </div>
            </div>
            <button
              onClick={handleAuthenticate}
              disabled={isLoading || !googleApiKey || !googleClientId}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />}
              Authenticate with Google
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle size={20} />
              <span className="font-medium">Authenticated</span>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Sheet Configuration */}
      {isAuthenticated && (
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Sheet Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Spreadsheet ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={spreadsheetId}
                  onChange={e => {
                    const extracted = extractSpreadsheetId(e.target.value);
                    setSpreadsheetId(extracted);
                    if (extracted) {
                      localStorage.setItem('google_spreadsheet_id', extracted);
                    } else {
                      localStorage.removeItem('google_spreadsheet_id');
                    }
                  }}
                  placeholder="Enter Spreadsheet ID or full URL"
                />
                {spreadsheetId && (
                  <button
                    onClick={() => {
                      setSpreadsheetId('');
                      localStorage.removeItem('google_spreadsheet_id');
                    }}
                    className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50"
                    title="Clear"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Paste full URL or ID from: /spreadsheets/d/[ID]/edit
              </p>
              {spreadsheetId && (
                <div className="mt-2 p-2 bg-slate-50 rounded border border-slate-200">
                  <p className="text-xs text-slate-600 font-semibold mb-1">Using Spreadsheet ID:</p>
                  <p className="text-xs text-slate-800 font-mono break-all">{spreadsheetId}</p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tab Name
              </label>
              <input
                type="text"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={sheetTabName}
                onChange={e => {
                  const tabName = e.target.value.trim();
                  setSheetTabName(tabName);
                  if (tabName) {
                    localStorage.setItem('google_sheet_tab_name', tabName);
                  }
                }}
                placeholder="Sheet1"
              />
              <p className="text-xs text-slate-500 mt-1">
                Name of the tab/sheet (e.g., Sheet1, Data, Master Data)
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Range
              </label>
              <input
                type="text"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={sheetRange}
                onChange={e => {
                  const range = e.target.value.trim();
                  setSheetRange(range);
                  if (range) {
                    localStorage.setItem('google_sheet_range', range);
                  }
                }}
                placeholder="A1:ZZ"
              />
              <p className="text-xs text-slate-500 mt-1">
                Cell range (e.g., A1:ZZ, A1:Z1000)
              </p>
              {sheetTabName && sheetRange && (
                <p className="text-xs text-slate-600 mt-1 font-mono bg-slate-50 p-1 rounded">
                  Full range: {getFullRange(sheetTabName, sheetRange)}
                </p>
              )}
            </div>
          </div>
          
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              onClick={handleLoadSheet}
              disabled={isLoading || !spreadsheetId}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
              Load Sheet Data
            </button>
            
            {sheetData.length > 0 && (
              <button
                onClick={handleSyncToDatabase}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    Sync to Database ({sheetData.length} records)
                  </>
                )}
              </button>
            )}
          </div>

          {sheetData.length > 0 && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <Info size={20} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-blue-900 mb-1">Ready to Sync</h4>
                  <p className="text-xs text-blue-800">
                    Loaded {sheetData.length} records from Google Sheet. Click "Sync to Database" to replace your database with this data.
                    <br />• All columns from the sheet will be preserved
                    <br />• Column order will be maintained
                    <br />• Account and line item structure will be preserved
                    <br />• Existing IDs will be preserved where records match (Account + Billing Item)
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SyncTest;
