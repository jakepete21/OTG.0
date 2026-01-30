import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { MasterRecord } from '../types';
import { Download, Upload, Loader2, AlertTriangle, FileJson, Building2, DollarSign, Search, RefreshCcw } from 'lucide-react';
import { loadReformattedMasterData } from '../services/reformattedMasterData';
import { groupRecordsByAccount, AccountGroup } from '../services/accountGrouping';
import AccountListItem from './AccountListItem';
import AccountDetailsModal from './AccountDetailsModal';
import { useSaveMasterData2 } from '../services/firebaseHooks';
import * as XLSX from 'xlsx';

interface MasterDataList2Props {
  data: MasterRecord[];
  onUpdate: (newData: MasterRecord[]) => void;
}

interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'percent';
  required?: boolean;
}

const MasterDataList2: React.FC<MasterDataList2Props> = ({ data, onUpdate }) => {
  const [isLoadingDefault, setIsLoadingDefault] = useState(false);
  const [hasLoadedDefault, setHasLoadedDefault] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveMasterData2 = useSaveMasterData2();
  
  // Local state that syncs with prop (for editing)
  const [localData, setLocalData] = useState<MasterRecord[]>(data);
  const [firebaseLoaded, setFirebaseLoaded] = useState(false);
  const [isUserUpdate, setIsUserUpdate] = useState(false);
  const [isLoadingFirebase, setIsLoadingFirebase] = useState(true); // Track Firebase loading state
  
  // Dynamic Column State - Will be populated from CSV or Firebase data
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  
  // Sync prop changes to local state and derive columns from Firebase data
  // Only update if not a user-initiated update (to avoid loops)
  useEffect(() => {
    // Don't sync if user just updated (Firebase will update via real-time listener)
    if (isUserUpdate) {
      return;
    }
    
    // Mark Firebase as loaded after a short delay (to distinguish between "loading" and "empty")
    // This helps show loading state instead of "no records found" initially
    const loadingTimeout = setTimeout(() => {
      setIsLoadingFirebase(false);
    }, 500); // Wait 500ms - if data hasn't loaded by then, show empty state
    
    if (data.length > 0) {
      // Data loaded - clear loading state immediately
      setIsLoadingFirebase(false);
      
      // Only update if length changed or columns need to be derived
      const needsUpdate = data.length !== localData.length || columns.length === 0;
      
      if (needsUpdate) {
        setLocalData(data);
        setFirebaseLoaded(true);
        setHasLoadedDefault(true); // Mark as loaded so we don't reload CSV
        
        // Derive columns from Firebase data if columns aren't set yet
        if (columns.length === 0 && data.length > 0) {
          const firstRecord = data[0];
          const allKeys = Object.keys(firstRecord).filter(key => 
            key !== 'id' && 
            key !== 'updatedAt' && 
            !key.startsWith('_') // Filter out internal Firebase fields
          );
          
          // Create a map of all keys for quick lookup
          const keySet = new Set(allKeys);
          
          // Order columns according to CSV_COLUMN_ORDER, then append any remaining columns
          const orderedKeys: string[] = [];
          
          // First, add columns in CSV order (if they exist in the record)
          CSV_COLUMN_ORDER.forEach(csvKey => {
            // Try exact match first
            if (keySet.has(csvKey)) {
              orderedKeys.push(csvKey);
              keySet.delete(csvKey);
            } else {
              // Try case-insensitive match
              const foundKey = Array.from(keySet).find(key => 
                normalizeHeader(key).toLowerCase() === normalizeHeader(csvKey).toLowerCase()
              );
              if (foundKey) {
                orderedKeys.push(foundKey);
                keySet.delete(foundKey);
              }
            }
          });
          
          // Add any remaining columns that weren't in CSV_COLUMN_ORDER
          orderedKeys.push(...Array.from(keySet));
          
          // Build column definitions in the correct order
          const derivedColumns: ColumnDef[] = orderedKeys.map(key => {
            const sampleValue = firstRecord[key];
            let type: 'text' | 'number' | 'percent' = 'text';
            
            if (key.toLowerCase().includes('price') || key.toLowerCase().includes('amount') || 
                (key.toLowerCase().includes('comp') && key.toLowerCase().includes('$'))) {
              type = 'number';
            } else if (key.toLowerCase().includes('%') || key.toLowerCase().includes('percent')) {
              type = 'percent';
            } else if (typeof sampleValue === 'number') {
              type = 'number';
            }
            
            return {
              key: key,
              label: key,
              type: type,
              required: false
            };
          });
          
          setColumns(derivedColumns);
          console.log(`[MasterDataList2] Derived ${derivedColumns.length} columns from Firebase data (ordered by CSV)`);
        }
        
        if (data.length !== localData.length) {
          console.log(`[MasterDataList2] Loaded ${data.length} records from Firebase`);
        }
      }
    } else if (data.length === 0 && firebaseLoaded) {
      // Firebase loaded but is empty - this is a real empty state
      setIsLoadingFirebase(false);
      console.log('[MasterDataList2] Firebase is empty');
    }
    
    return () => {
      clearTimeout(loadingTimeout);
    };
  }, [data, firebaseLoaded, columns.length, isUserUpdate, localData.length]);
  
  // Wrapper for onUpdate that also saves to Firebase
  const handleUpdate = useCallback(async (newData: MasterRecord[]) => {
    setIsUserUpdate(true); // Mark as user-initiated update
    setLocalData(newData);
    onUpdate(newData);
    
    // Save to Firebase
    setIsSaving(true);
    try {
      await saveMasterData2(newData);
      console.log('[MasterDataList2] Saved to Firebase');
    } catch (error: any) {
      console.error('[MasterDataList2] Failed to save to Firebase:', error);
      setImportError(`Failed to save to Firebase: ${error.message}`);
    } finally {
      setIsSaving(false);
      setIsUserUpdate(false);
    }
  }, [onUpdate, saveMasterData2]);
  
  // Account Details Modal State
  const [selectedAccount, setSelectedAccount] = useState<AccountGroup | null>(null);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 1000;

  // Helper function to get field value
  const getFieldValue = useCallback((record: MasterRecord, ...fieldNames: string[]): string | undefined => {
    for (const fieldName of fieldNames) {
      if (record[fieldName] !== undefined && record[fieldName] !== null && record[fieldName] !== '') {
        return String(record[fieldName]);
      }
      const lowerFieldName = fieldName.toLowerCase();
      for (const key in record) {
        if (key.toLowerCase() === lowerFieldName) {
          const value = record[key];
          if (value !== undefined && value !== null && value !== '') {
            return String(value);
          }
        }
      }
    }
    return undefined;
  }, []);

  // Group records by account (use localData for display)
  const accountGroups = useMemo(() => {
    if (localData.length === 0) return [];
    return groupRecordsByAccount(localData);
  }, [localData]);

  // Filter accounts based on search query
  const filteredAccountGroups = useMemo(() => {
    if (!searchQuery.trim()) return accountGroups;
    
    const query = searchQuery.toLowerCase().trim();
    return accountGroups.filter(account => {
      // Search by account name
      if (account.accountCarrier.toLowerCase().includes(query)) return true;
      
      // Search by billing item
      if (account.otgCompBillingItem.toLowerCase().includes(query)) return true;
      
      // Search by account number (BAN)
      const hasMatchingBan = account.lineItems.some(item => {
        const ban = getFieldValue(item, 'Cust. ACTIVE BAN', 'cust. active ban', 'Historic BAN - non-ZNS', 'historic ban - non-zns');
        return ban && ban.toLowerCase().includes(query);
      });
      if (hasMatchingBan) return true;
      
      // Search by Circuit ID
      const hasMatchingCircuitId = account.lineItems.some(item => {
        const circuitId = getFieldValue(item, 'Circuit ID', 'circuit id', 'circuit');
        return circuitId && circuitId.toLowerCase().includes(query);
      });
      if (hasMatchingCircuitId) return true;
      
      return false;
    });
  }, [accountGroups, searchQuery, getFieldValue]);

  // Pagination calculations
  const paginatedAccountGroups = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredAccountGroups.slice(start, end);
  }, [filteredAccountGroups, currentPage, itemsPerPage]);

  const totalPagesAccount = Math.ceil(filteredAccountGroups.length / itemsPerPage);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Update selectedAccount when data changes
  useEffect(() => {
    if (selectedAccount) {
      const updatedAccount = accountGroups.find(acc => acc.accountId === selectedAccount.accountId);
      if (updatedAccount) {
        setSelectedAccount(updatedAccount);
      } else {
        setSelectedAccount(null);
      }
    }
  }, [accountGroups, selectedAccount]);

  // CSV Column Order - matches the exact order from the reformatted CSV file (62 columns)
  const CSV_COLUMN_ORDER = [
    'ST',
    'Account **CARRIER**',
    'Carrier Comp Type OTG PDNG OTG ADD OTG - Zayo = zMAP NEW = On comp statement PDNG in Monday',
    'Carrier Relationship',
    'Service Provider',
    'Status / Type',
    'Opportunity "Promo Year" **KEEP ORIGINAL OPP**',
    'Promo Year Revenue / OG SF Opp zMAP = anything new to OTG **KEEP ORIGINAL OPP**',
    'Install Date OR OTG payable Date',
    'OTG Comp Billing item',
    'Cust. ACTIVE BAN',
    'Historic BAN - non-ZNS',
    'Item Desc. from current Carrier Statement',
    'PAYING Monthly Comp % to OTG from current Carrier Statement',
    'Quantity',
    'Price',
    'Monthly Unit Price Quantity x Price QRC/SEMI//YRC x 4, 6, or 12',
    'EXPECTED/Mo. OTG Comp % - column R Comp Key',
    'Monthly Comp to OTG per EXPECTED Comp %',
    'One-Time Unit Price / SPIFF',
    'One-Time Comp % to OTG',
    'One-Time Comp Expected to OTG',
    'Cust. Billed Type',
    'COMP 1',
    'COMP 2',
    'COMP 3',
    'COMP 4',
    'before 07/2025 COMP 1',
    'before 07/2025 COMP 2',
    'before 07/2025 COMP 3',
    'before 07/2025 COMP 4',
    'NOTES RED Highlight = Differs from before comp key',
    'MISSING OTG COMP',
    'SVC Change Date',
    'Prev. Unit Price',
    'OTG Compensable Product NAME',
    'MISSING MONDAY',
    'Sig Date',
    'Term',
    'Location Name',
    'Service Address',
    'Order #',
    'Circuit ID',
    'Unique Order Details SOC / SC',
    'TED',
    'Renewal Details',
    'Monday Product Comments - EXCLUDE SPLIT NOTES/VALUES',
    'Monday Item ID',
    'COMP CALC Mo. OTG RCVD Funds>>',
    'OTG PD since July Seller Statemen June Deposit',
    'July Seller Statement - June Deposit',
    'Aug Seller Stmt - July Deposit',
    'Sept Seller Stmt - Aug Deposit',
    'Oct Seller Stmt - Sept Deposit',
    'Nov Seller Stmt - Oct Deposit',
    'Dec Seller Stmt - Nov Deposit',
    'Jan Seller Stmt - Dec Deposit',
    'Feb Seller Stmt - Jan Deposit',
    'Mar Seller Stmt - Feb Deposit',
    'Apr Seller Stmt - Mar Deposit',
    'May Seller Stmt - Apr Deposit',
    'June Seller Stmt - May Deposit'
  ];

  // Helper to normalize CSV headers
  const normalizeHeader = (header: string): string => {
    return header.trim().replace(/^"|"$/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // Helper to parse currency strings
  const parseCurrency = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val).replace(/[^0-9.-]+/g, "");
    return parseFloat(str) || 0;
  };

  // Helper to parse percentage
  const parsePercent = (val: any): number => {
    if (typeof val === 'number') {
      return val > 1 ? val / 100 : val;
    }
    if (!val) return 0;
    const cleanStr = String(val).replace(/[^0-9.-]+/g, "");
    let num = parseFloat(cleanStr);
    
    if (String(val).includes('%')) {
      num = num / 100;
    } else if (num > 1) {
      num = num / 100;
    }
    return num || 0;
  };

  const processImportData = useCallback(async (rawData: any[]) => {
    if (rawData.length === 0) throw new Error("File is empty.");

    // Normalize Data Keys
    const normalizedData = rawData.map((row: any) => {
      const newRow: any = {};
      Object.keys(row).forEach(k => {
        const cleanKey = normalizeHeader(k);
        const cleanValue = typeof row[k] === 'string' ? row[k].trim() : row[k];
        newRow[cleanKey] = cleanValue;
      });
      return newRow;
    });

    const firstRow = normalizedData[0];
    const allFileKeys = Object.keys(firstRow);

    // Build column definitions from ALL columns in CSV (preserve order)
    const newColumnDefs: ColumnDef[] = allFileKeys.map(key => {
      // Determine type based on column name and sample value
      const sampleValue = firstRow[key];
      let type: 'text' | 'number' | 'percent' = 'text';
      
      if (key.toLowerCase().includes('price') || key.toLowerCase().includes('amount') || key.toLowerCase().includes('comp') && key.toLowerCase().includes('$')) {
        type = 'number';
      } else if (key.toLowerCase().includes('%') || key.toLowerCase().includes('percent')) {
        type = 'percent';
      } else if (typeof sampleValue === 'number') {
        type = 'number';
      }
      
      return {
        key: key,
        label: key, // Use full header name as label
        type: type,
        required: false // All columns optional for display
      };
    });

    // Build Records - preserve ALL columns
    const newRecords = normalizedData.map((row: any, idx: number) => {
      const record: any = {
        id: `master2-${Date.now()}-${idx}`
      };

      // Map standard fields if they exist
      const clientNameKey = allFileKeys.find(k => 
        normalizeHeader(k).toLowerCase().includes('account') && 
        normalizeHeader(k).toLowerCase().includes('carrier')
      );
      record.clientName = clientNameKey ? (row[clientNameKey] || '') : '';

      const serviceTypeKey = allFileKeys.find(k => 
        normalizeHeader(k).toLowerCase().includes('service provider')
      );
      record.serviceType = serviceTypeKey ? (row[serviceTypeKey] || '') : '';

      const salespersonKey = allFileKeys.find(k => 
        normalizeHeader(k).toLowerCase() === 'comp 1'
      );
      record.salesperson = salespersonKey ? (row[salespersonKey] || '') : '';

      const expectedAmountKey = allFileKeys.find(k => 
        normalizeHeader(k).toLowerCase().includes('monthly unit price')
      );
      record.expectedAmount = expectedAmountKey ? parseCurrency(row[expectedAmountKey]) : 0;

      const splitPercentageKey = allFileKeys.find(k => 
        normalizeHeader(k).toLowerCase().includes('expected') && 
        normalizeHeader(k).toLowerCase().includes('otg comp %')
      );
      record.splitPercentage = splitPercentageKey ? parsePercent(row[splitPercentageKey]) : 0.1;

      // Copy ALL other columns as custom fields (preserve original column names)
      allFileKeys.forEach(colKey => {
        if (colKey !== 'id') {
          record[colKey] = row[colKey];
        }
      });

      return record as MasterRecord;
    });

    if (newRecords.length === 0) {
      throw new Error("No valid records found.");
    }

    if (newColumnDefs.length > 0) setColumns(newColumnDefs);
    await handleUpdate(newRecords);
  }, [handleUpdate]);

  // NO auto-load CSV - only load from Firebase
  // User can manually click "Reload Reformatted CSV" if needed

  const handleReloadDefaultData = async () => {
    if (confirm('This will replace all current master data with the reformatted CSV file. Continue?')) {
      setIsLoadingDefault(true);
      setImportError(null);
      try {
        const rawData = await loadReformattedMasterData();
        processImportData(rawData);
        setHasLoadedDefault(true);
        // processImportData will save to Firebase automatically
      } catch (error: any) {
        console.error('Failed to reload reformatted master data:', error);
        setImportError(`Failed to reload reformatted data: ${error.message}`);
      } finally {
        setIsLoadingDefault(false);
      }
    }
  };
  

  const exportCSV = () => {
    if (columns.length === 0 || localData.length === 0) return;
    
    const headers = columns.map(c => c.label).join(',');
    const rows = localData.map(r => {
      return columns.map(c => {
        let val = r[c.key];
        if (typeof val === 'string') val = `"${val}"`;
        return val;
      }).join(',');
    });
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "master_data_2.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Master Data 2 (All Columns)</h2>
          <p className="text-slate-500 text-sm mt-1">Complete master service list with all {columns.length} columns displayed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSaving && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 text-green-700 rounded-lg text-xs sm:text-sm font-medium">
              <Loader2 className="animate-spin" size={16} />
              Saving to Firebase...
            </div>
          )}
          <button 
            onClick={exportCSV}
            disabled={localData.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-xs sm:text-sm font-medium disabled:opacity-50"
          >
            <Download size={16} /> Export CSV
          </button>

          <button 
            onClick={handleReloadDefaultData}
            disabled={isLoadingDefault}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-xs sm:text-sm font-medium shadow-sm disabled:opacity-50"
          >
            {isLoadingDefault ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
            Reload Reformatted CSV
          </button>
        </div>
      </div>

      {importError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertTriangle size={20} />
          <span>{importError}</span>
        </div>
      )}

      {/* Loading State */}
      {isLoadingDefault && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12">
          <div className="flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-indigo-600" size={32} />
            <p className="text-slate-600 font-medium">Loading reformatted master data...</p>
            <p className="text-sm text-slate-400">Parsing CSV file with all columns</p>
          </div>
        </div>
      )}

      {/* Account List View */}
      {!isLoadingDefault && (
        <div className="space-y-4">
          {/* Summary Stats */}
          {accountGroups.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-3">
                  <Building2 size={20} className="text-indigo-600" />
                  <div>
                    <p className="text-xs text-slate-500">Total Accounts</p>
                    <p className="text-lg font-semibold text-slate-800">{accountGroups.length}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <FileJson size={20} className="text-blue-600" />
                  <div>
                    <p className="text-xs text-slate-500">Total Line Items</p>
                    <p className="text-lg font-semibold text-slate-800">{localData.length}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <DollarSign size={20} className="text-green-600" />
                  <div>
                    <p className="text-xs text-slate-500">Total Columns</p>
                    <p className="text-lg font-semibold text-slate-800">{columns.length}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Search Bar */}
          {accountGroups.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="Search accounts by name, billing item, account number, or circuit ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                />
              </div>
            </div>
          )}

          {/* Account List */}
          {isLoadingFirebase && localData.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-16">
              <div className="flex flex-col items-center gap-2 text-center">
                <Loader2 className="animate-spin text-indigo-600" size={48} />
                <p className="text-lg font-medium text-slate-600">Loading Master Data 2...</p>
                <p className="text-sm text-slate-500">Fetching data from Firebase</p>
              </div>
            </div>
          ) : filteredAccountGroups.length === 0 && accountGroups.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-16">
              <div className="flex flex-col items-center gap-2 text-center">
                <Upload size={48} className="text-slate-300" />
                <p className="text-lg font-medium text-slate-600">No master records found</p>
                <p className="text-sm text-slate-500">Click "Reload Reformatted CSV" to load data</p>
              </div>
            </div>
          ) : filteredAccountGroups.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-16">
              <div className="flex flex-col items-center gap-2 text-center">
                <Search size={48} className="text-slate-300" />
                <p className="text-lg font-medium text-slate-600">No accounts found</p>
                <p className="text-sm text-slate-500">Try adjusting your search query</p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              {paginatedAccountGroups.map(account => (
                <AccountListItem
                  key={account.accountId}
                  account={account}
                  onClick={() => setSelectedAccount(account)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {filteredAccountGroups.length > 0 && totalPagesAccount > 1 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between">
              <div className="text-sm text-slate-600">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredAccountGroups.length)} of {filteredAccountGroups.length} accounts
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-600 px-3">
                  Page {currentPage} of {totalPagesAccount}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPagesAccount, prev + 1))}
                  disabled={currentPage === totalPagesAccount}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Account Details Modal */}
      {selectedAccount && (
          <AccountDetailsModal
          account={selectedAccount}
          columns={columns}
          onClose={() => setSelectedAccount(null)}
          onUpdate={handleUpdate}
          allRecords={localData}
        />
      )}
    </div>
  );
};

export default MasterDataList2;
