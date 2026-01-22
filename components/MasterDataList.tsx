import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { MasterRecord } from '../types';
import { Trash2, Edit2, Save, X, Download, Upload, Loader2, AlertTriangle, FileJson, ClipboardPaste, RefreshCcw, Building2, DollarSign, Search } from 'lucide-react';
import { parseMasterDataUnstructured } from '../services/geminiService';
import { loadDefaultMasterData } from '../services/defaultMasterData';
import { groupRecordsByAccount, AccountGroup } from '../services/accountGrouping';
import AccountListItem from './AccountListItem';
import AccountDetailsModal from './AccountDetailsModal';
import * as XLSX from 'xlsx';

interface MasterDataListProps {
  data: MasterRecord[];
  onUpdate: (newData: MasterRecord[]) => void;
}

interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'percent';
  required?: boolean;
}

const MasterDataList: React.FC<MasterDataListProps> = ({ data, onUpdate }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<MasterRecord>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isLoadingDefault, setIsLoadingDefault] = useState(false);
  const [hasLoadedDefault, setHasLoadedDefault] = useState(false);
  
  // Drag and Drop State
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // Paste Modal State
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  
  // Account Details Modal State
  const [selectedAccount, setSelectedAccount] = useState<AccountGroup | null>(null);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 1000;
  
  // Dynamic Column State - Initial defaults
  const [columns, setColumns] = useState<ColumnDef[]>([
    { key: 'clientName', label: 'Client Name', type: 'text', required: true },
    { key: 'serviceType', label: 'Service Type', type: 'text', required: true },
    { key: 'salesperson', label: 'Salesperson', type: 'text', required: true },
    { key: 'expectedAmount', label: 'Expected Revenue', type: 'number', required: true },
    { key: 'splitPercentage', label: 'Split %', type: 'percent', required: true },
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 40; // More compact Monday.com-style row height

  // Helper function to get field value (similar to accountGrouping.ts)
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

  // Group records by account
  const accountGroups = useMemo(() => {
    if (data.length === 0) return [];
    return groupRecordsByAccount(data);
  }, [data]);

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

  // Update selectedAccount when data changes (to reflect updates/deletes)
  useEffect(() => {
    if (selectedAccount) {
      const updatedAccount = accountGroups.find(acc => acc.accountId === selectedAccount.accountId);
      if (updatedAccount) {
        setSelectedAccount(updatedAccount);
      } else {
        // Account was deleted or grouping changed, close modal
        setSelectedAccount(null);
      }
    }
  }, [accountGroups, selectedAccount]);

  // Helper to create empty record based on current columns
  const getEmptyRecord = (): Omit<MasterRecord, 'id'> => {
    const record: any = {};
    columns.forEach(col => {
      if (col.type === 'number' || col.type === 'percent') record[col.key] = 0;
      else record[col.key] = '';
    });
    // Defaults
    if(record.splitPercentage === 0) record.splitPercentage = 0.10;
    return record;
  };

  const handleEditClick = useCallback((record: MasterRecord) => {
    setEditingId(record.id);
    setEditForm({ ...record });
    setIsAdding(false);
  }, []);

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setEditForm({});
    setIsAdding(false);
  }, []);

  const handleSave = useCallback(() => {
    if (editingId && !isAdding) {
      // Update existing
      const updatedData = data.map(item => 
        item.id === editingId ? { ...item, ...editForm } as MasterRecord : item
      );
      onUpdate(updatedData);
    } else if (isAdding) {
      // Add new
      const newRecord = {
        ...editForm,
        id: `master-${Date.now()}`
      } as MasterRecord;
      onUpdate([...data, newRecord]);
    }
    setEditingId(null);
    setEditForm({});
    setIsAdding(false);
  }, [editingId, isAdding, editForm, data, onUpdate]);

  const handleDelete = useCallback((id: string) => {
    if (confirm('Are you sure you want to delete this record?')) {
      onUpdate(data.filter(item => item.id !== id));
    }
  }, [data, onUpdate]);


  const startAdd = () => {
    setIsAdding(true);
    setEditingId('new');
    setEditForm(getEmptyRecord());
  };

  const addCustomColumn = () => {
    const name = prompt("Enter new column name:");
    if (!name) return;
    
    // Create a safe key key
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    // Check duplicates
    if (columns.some(c => c.key === key)) {
      alert("Column already exists!");
      return;
    }

    setColumns([...columns, { key, label: name, type: 'text' }]);
  };

  const deleteColumn = (key: string) => {
    const col = columns.find(c => c.key === key);
    if (!col) return;

    let message = "Delete this column? It will be hidden from the view.";
    if (['clientName', 'serviceType', 'salesperson', 'expectedAmount', 'splitPercentage'].includes(key)) {
        message = `Warning: '${col.label}' is a standard field used for calculations. Deleting it may affect reports.\n\nAre you sure you want to hide it?`;
    }

    if (confirm(message)) {
      setColumns(columns.filter(c => c.key !== key));
    }
  }
  
  const resetColumns = () => {
      if(confirm("Reset columns to default standard fields?")) {
        setColumns([
            { key: 'clientName', label: 'Client Name', type: 'text', required: true },
            { key: 'serviceType', label: 'Service Type', type: 'text', required: true },
            { key: 'salesperson', label: 'Salesperson', type: 'text', required: true },
            { key: 'expectedAmount', label: 'Expected Revenue', type: 'number', required: true },
            { key: 'splitPercentage', label: 'Split %', type: 'percent', required: true },
        ]);
      }
  }

  // Column Reordering Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedColIndex(index);
    // Required for Firefox
    e.dataTransfer.effectAllowed = "move"; 
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessary to allow dropping
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedColIndex === null || draggedColIndex === dropIndex) return;
    
    const newCols = [...columns];
    const draggedItem = newCols[draggedColIndex];
    // Remove from old index
    newCols.splice(draggedColIndex, 1);
    // Insert at new index
    newCols.splice(dropIndex, 0, draggedItem);
    
    setColumns(newCols);
    setDraggedColIndex(null);
  };

  const exportCSV = () => {
    const headers = columns.map(c => c.label).join(',');
    const rows = data.map(r => {
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
    link.setAttribute("download", "master_service_list.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  // Helper function to normalize CSV headers (matches defaultMasterData.ts normalization)
  const normalizeHeader = (header: string): string => {
    return header.trim().replace(/^"|"$/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // Helper function to match headers (case-insensitive, handles variations)
  const headersMatch = (header1: string, header2: string): boolean => {
    const norm1 = normalizeHeader(header1).toLowerCase();
    const norm2 = normalizeHeader(header2).toLowerCase();
    return norm1 === norm2;
  };

  // Define exact CSV column order (62 columns) - these are the target normalized header names
  // This matches the order from the OTG.0 Comp Key CSV file
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

  const processImportData = useCallback((rawData: any[]) => {
      if (rawData.length === 0) throw new Error("File is empty.");

      // Normalize Data Keys (matches defaultMasterData.ts normalization)
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

      const newColumnDefs: ColumnDef[] = [];
      const standardFieldMapping: Record<string, string> = {}; // internalKey -> normalizedFileKey
      const usedFileKeys = new Set<string>();

      // Define Standard Fields with strict synonyms for your file format
      // NOTE: COMP 1, COMP 2, COMP 3, COMP 4 are NOT standard fields - they remain as custom columns
      const requiredFields = [
          { key: 'clientName', label: 'Client Name', synonyms: ['account **carrier**', 'account', 'carrier', 'customer', 'name', 'company', 'business'] },
          { key: 'serviceType', label: 'Service Type', synonyms: ['service provider', 'service', 'provider', 'product', 'item', 'description', 'plan'] },
          { key: 'expectedAmount', label: 'Expected Revenue', synonyms: ['expected', 'amount', 'price', 'cost', 'revenue', 'value', 'fee', 'mrr', 'monthly'] },
          { key: 'splitPercentage', label: 'Split %', synonyms: ['split', 'percent', 'rate', 'share'] } 
      ];

      // Map standard fields to their CSV headers
      requiredFields.forEach(field => {
          const match = allFileKeys.find(fileKey => {
              if (usedFileKeys.has(fileKey)) return false;
              const lower = fileKey.toLowerCase();
              
              // Special case for "Account **CARRIER**" header
              if (field.key === 'clientName' && lower.includes('account') && lower.includes('carrier')) return true;

              // Special case for "COMP 1" header
              if (field.key === 'salesperson' && lower === 'comp 1') return true;

              // Check exact match on internal key
              if (lower === field.key.toLowerCase()) return true;
              
              // Check synonyms
              return field.synonyms.some(syn => lower.includes(syn));
          });

          if (match) {
              standardFieldMapping[field.key] = match;
              usedFileKeys.add(match);
          }
      });

      // Build column definitions in CSV order
      // Iterate through CSV_COLUMN_ORDER to maintain exact order
      CSV_COLUMN_ORDER.forEach(csvHeaderNormalized => {
          // Find matching file key (normalized comparison)
          const fileKey = allFileKeys.find(k => headersMatch(k, csvHeaderNormalized));
          
          if (!fileKey) {
              // Column not found in file - skip it (might be a future column or typo)
              return;
          }

          // Check if this CSV header maps to a standard field
          const standardField = requiredFields.find(field => {
              const mappedKey = standardFieldMapping[field.key];
              if (!mappedKey) return false;
              
              // Check if this file key matches the mapped standard field key
              return headersMatch(mappedKey, fileKey);
          });

          if (standardField) {
              // This is a standard field - use internal key
              newColumnDefs.push({
                  key: standardField.key,
                  label: fileKey, // Use original CSV header as label
                  type: standardField.key === 'expectedAmount' ? 'number' : standardField.key === 'splitPercentage' ? 'percent' : 'text',
                  required: true
              });
          } else {
              // This is a custom field
              newColumnDefs.push({
                  key: fileKey, // Use normalized key from file
                  label: fileKey, // Use original CSV header as label
                  type: typeof firstRow[fileKey] === 'number' ? 'number' : 'text',
                  required: false
              });
          }
          
          usedFileKeys.add(fileKey);
      });

      // Add any remaining columns that weren't in CSV_COLUMN_ORDER (for backward compatibility)
      allFileKeys.forEach(fileKey => {
          if (!usedFileKeys.has(fileKey)) {
              newColumnDefs.push({
                  key: fileKey,
                  label: fileKey,
                  type: typeof firstRow[fileKey] === 'number' ? 'number' : 'text',
                  required: false
              });
          }
      });

      // Build Records
      const newRecords = normalizedData.map((row: any, idx: number) => {
          const record: any = {
              id: `imported-${Date.now()}-${idx}`
          };

          // Fill Standard Fields
          requiredFields.forEach(field => {
              const sourceKey = standardFieldMapping[field.key];
              if (sourceKey) {
                 let val = row[sourceKey];
                 // Type conversion
                 if (field.key === 'expectedAmount') val = parseCurrency(val);
                 if (field.key === 'splitPercentage') val = parsePercent(val);
                 record[field.key] = val;
              } else {
                 // Default values
                 if (field.key === 'expectedAmount') record[field.key] = 0;
                 else if (field.key === 'splitPercentage') record[field.key] = 0.1;
                 else record[field.key] = '';
              }
          });

          // Fill Custom Fields (all columns in order)
          newColumnDefs.forEach(colDef => {
              // Skip standard fields (already filled)
              if (requiredFields.some(f => f.key === colDef.key)) return;
              
              // Fill custom field
              const sourceKey = colDef.key;
              if (sourceKey && sourceKey !== 'id') {
                  // Protect internal 'id' collision
                  if (sourceKey === 'id') {
                      record['original_id'] = row[sourceKey];
                  } else {
                      record[sourceKey] = row[sourceKey];
                  }
              }
          });

          return record as MasterRecord;
      });

      if (newRecords.length === 0) {
        throw new Error("No valid records found.");
      }

      if (newColumnDefs.length > 0) setColumns(newColumnDefs);
      onUpdate(newRecords);
  }, [onUpdate, setColumns]);

  // Auto-load default CSV on mount (after processImportData is defined)
  useEffect(() => {
    const loadDefaultData = async () => {
      // Only load if no data exists and we haven't loaded yet
      if (data.length === 0 && !hasLoadedDefault && !isLoadingDefault) {
        setIsLoadingDefault(true);
        setImportError(null);
        try {
          const rawData = await loadDefaultMasterData();
          processImportData(rawData);
          setHasLoadedDefault(true);
        } catch (error: any) {
          console.error('Failed to load default master data:', error);
          setImportError(`Failed to load default data: ${error.message}`);
        } finally {
          setIsLoadingDefault(false);
        }
      }
    };

    loadDefaultData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processImportData]); // processImportData is stable via useCallback

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    
    const file = e.target.files[0];
    setIsImporting(true);
    setImportError(null);

    try {
      let rawData: any[] = [];
      let isStructured = false;

      // 1. Parse File Content
      if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().match(/\.(xlsx|xls)$/)) {
        isStructured = true;
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        rawData = XLSX.utils.sheet_to_json(worksheet);
      } 
      else if (file.name.toLowerCase().endsWith('.json')) {
        isStructured = true;
        const text = await file.text();
        const json = JSON.parse(text);
        
        if (Array.isArray(json)) {
            rawData = json;
        } else {
            const possibleArray = Object.values(json).find(v => Array.isArray(v));
            if (possibleArray) {
                rawData = possibleArray as any[];
            } else {
                throw new Error("JSON file must contain an array of records.");
            }
        }
      }

      if (isStructured) {
          processImportData(rawData);
      } else {
        // Fallback for Unstructured
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        const base64 = await base64Promise;
        const extracted = await parseMasterDataUnstructured(base64, file.type);
        
        const newRecords = extracted.map((item, idx) => ({
          ...item,
          id: `imported-${Date.now()}-${idx}`
        })) as MasterRecord[];
        
        if (newRecords.length === 0) throw new Error("No records found in document");
        onUpdate(newRecords);
      }

    } catch (err: any) {
      console.error(err);
      setImportError(err.message || "Failed to parse file.");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasteClick = () => {
    setShowPasteModal(true);
    setPasteContent('');
    setImportError(null);
  };

  const handleModalImport = () => {
      if(!pasteContent.trim()) return;

      setIsImporting(true);
      setImportError(null);

      try {
        const rows = pasteContent.trim().split(/[\r\n]+/);
        if (rows.length < 2) {
            throw new Error("Data looks too short. Please include headers AND data rows.");
        }

        // Detect separator: Tab (from Sheets/Excel copy) or Comma (raw CSV text)
        const firstRow = rows[0];
        const separator = firstRow.includes('\t') ? '\t' : ',';
        
        const headers = firstRow.split(separator).map(h => h.trim().replace(/^"|"$/g, ''));
        
        const rawData = rows.slice(1).map(rowStr => {
            const cells = rowStr.split(separator).map(c => c.trim().replace(/^"|"$/g, ''));
            const obj: any = {};
            headers.forEach((h, i) => {
                if(h) obj[h] = cells[i];
            });
            return obj;
        });

        processImportData(rawData);
        setShowPasteModal(false);

      } catch (err: any) {
        console.error(err);
        setImportError(err.message || "Failed to parse pasted data.");
      } finally {
        setIsImporting(false);
      }
  };

  const handleReloadDefaultData = async () => {
    if (confirm('This will replace all current master data with the default CSV file. Continue?')) {
      setIsLoadingDefault(true);
      setImportError(null);
      try {
        const rawData = await loadDefaultMasterData();
        processImportData(rawData);
        setHasLoadedDefault(true);
      } catch (error: any) {
        console.error('Failed to reload default master data:', error);
        setImportError(`Failed to reload default data: ${error.message}`);
      } finally {
        setIsLoadingDefault(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Master Service List</h2>
          <p className="text-slate-500 text-sm mt-1">Manage your active client services and commission rules.</p>
        </div>
        <div className="flex flex-wrap gap-2">
           <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".csv,.xlsx,.xls,.pdf,.jpg,.png,.json" 
            onChange={handleFileSelect}
          />
          
          <button 
            onClick={handlePasteClick}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs sm:text-sm font-medium shadow-sm disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="animate-spin" size={16} /> : <ClipboardPaste size={16} />}
            Paste from Sheets
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-xs sm:text-sm font-medium disabled:opacity-50"
          >
            <Upload size={16} /> Upload File
          </button>

          <button 
            onClick={exportCSV}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-xs sm:text-sm font-medium"
          >
            <Download size={16} /> Export
          </button>

          <button 
            onClick={handleReloadDefaultData}
            disabled={isLoadingDefault || isImporting}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-xs sm:text-sm font-medium shadow-sm disabled:opacity-50"
          >
            {isLoadingDefault ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
            Reload Default CSV
          </button>

          <button 
            onClick={resetColumns}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-xs sm:text-sm font-medium"
          >
            <RefreshCcw size={16} /> Reset Columns
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
            <p className="text-slate-600 font-medium">Loading master data...</p>
            <p className="text-sm text-slate-400">Parsing CSV file</p>
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
                    <p className="text-lg font-semibold text-slate-800">{data.length}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <DollarSign size={20} className="text-green-600" />
                  <div>
                    <p className="text-xs text-slate-500">Total Monthly Comp</p>
                    <p className="text-lg font-semibold text-slate-800">
                      ${accountGroups.reduce((sum, acc) => sum + acc.summary.totalMonthlyComp, 0).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
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
          {filteredAccountGroups.length === 0 && accountGroups.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-16">
              <div className="flex flex-col items-center gap-2 text-center">
                <Upload size={48} className="text-slate-300" />
                <p className="text-lg font-medium text-slate-600">No master records found</p>
                <p className="text-sm text-slate-500">Use the buttons above to import data</p>
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
          onUpdate={onUpdate}
          allRecords={data}
        />
      )}

      {/* Paste Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-800">Paste Data from Spreadsheet</h3>
              <button onClick={() => setShowPasteModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-hidden flex flex-col">
              <p className="text-sm text-slate-500 mb-2">
                Copy your data from Google Sheets or Excel (including headers) and paste it below:
              </p>
              <textarea
                className="w-full flex-1 border border-slate-300 rounded-lg p-4 font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                placeholder="Paste headers and rows here..."
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
              />
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-xl">
              <button 
                onClick={() => setShowPasteModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleModalImport}
                disabled={!pasteContent.trim()}
                className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterDataList;