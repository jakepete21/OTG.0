import React, { useState, useCallback, useMemo } from 'react';
import { X, Edit2, Trash2, Save, FileText, DollarSign, ChevronDown, ChevronUp, Bug, Plus } from 'lucide-react';
import { MasterRecord } from '../types';
import { AccountGroup } from '../services/accountGrouping';
import { formatNumber, formatCurrency, formatWholeNumber } from '../services/numberFormat';

interface AccountDetailsModalProps {
  account: AccountGroup;
  columns: ColumnDef[];
  onClose: () => void;
  onUpdate: (updatedRecords: MasterRecord[]) => void;
  allRecords: MasterRecord[];
}

interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'percent';
  required?: boolean;
}

const AccountDetailsModal: React.FC<AccountDetailsModalProps> = ({
  account,
  columns,
  onClose,
  onUpdate,
  allRecords,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<MasterRecord>>({});
  const [expandedCell, setExpandedCell] = useState<{ recordId: string; field: string } | null>(null);
  
  // Add Line Item State
  const [isAddingLineItem, setIsAddingLineItem] = useState(false);
  const [newLineItemForm, setNewLineItemForm] = useState<Partial<MasterRecord>>({});
  const [addLineItemErrors, setAddLineItemErrors] = useState<Record<string, string>>({});

  const handleEditClick = useCallback((record: MasterRecord) => {
    setEditingId(record.id);
    // Copy all fields from record to editForm
    setEditForm({ ...record });
  }, []);

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setEditForm({});
  }, []);

  const handleSave = useCallback(() => {
    if (!editingId) return;

    // Update the record in allRecords
    const updatedRecords = allRecords.map(item =>
      item.id === editingId ? { ...item, ...editForm } as MasterRecord : item
    );
    
    onUpdate(updatedRecords);
    setEditingId(null);
    setEditForm({});
    
    // Note: If Account **CARRIER** or OTG Comp Billing item changed, the account grouping
    // will change. The modal will show the old account until closed, which is acceptable UX.
  }, [editingId, editForm, allRecords, onUpdate]);

  const handleDelete = useCallback((id: string) => {
    if (confirm('Are you sure you want to delete this line item?')) {
      const updatedRecords = allRecords.filter(item => item.id !== id);
      onUpdate(updatedRecords);
    }
  }, [allRecords, onUpdate]);

  // Handle Add Line Item
  const handleAddLineItem = useCallback(() => {
    setIsAddingLineItem(true);
    // Pre-fill Account **CARRIER** and OTG Comp Billing item from account
    const preFilledForm: Partial<MasterRecord> = {
      'Account **CARRIER**': account.accountCarrier,
      'OTG Comp Billing item': account.otgCompBillingItem,
      clientName: account.accountCarrier,
      otgCompBillingItem: account.otgCompBillingItem,
    };
    setNewLineItemForm(preFilledForm);
    setAddLineItemErrors({});
  }, [account]);

  const handleCancelAddLineItem = useCallback(() => {
    setIsAddingLineItem(false);
    setNewLineItemForm({});
    setAddLineItemErrors({});
  }, []);

  const handleSaveNewLineItem = useCallback(() => {
    // Validate required fields (should already be pre-filled, but check anyway)
    const errors: Record<string, string> = {};
    const accountCarrier = newLineItemForm['Account **CARRIER**'] || newLineItemForm.clientName || account.accountCarrier;
    const otgCompBillingItem = newLineItemForm['OTG Comp Billing item'] || newLineItemForm.otgCompBillingItem || account.otgCompBillingItem;

    if (!accountCarrier.trim()) {
      errors.accountCarrier = 'Account **CARRIER** is required';
    }
    if (!otgCompBillingItem.trim()) {
      errors.otgCompBillingItem = 'OTG Comp Billing item is required';
    }

    if (Object.keys(errors).length > 0) {
      setAddLineItemErrors(errors);
      return;
    }

    // Create new record with all fields
    const newRecord: MasterRecord = {
      id: `master-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      clientName: accountCarrier,
      serviceType: newLineItemForm['Service Provider'] || newLineItemForm.serviceType || '',
      salesperson: newLineItemForm['COMP 1'] || newLineItemForm.salesperson || '',
      expectedAmount: parseNumeric(newLineItemForm['Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)'] || newLineItemForm.expectedAmount || 0),
      splitPercentage: parsePercent(newLineItemForm['EXPECTED/Mo. OTG Comp % - column R Comp Key'] || newLineItemForm.splitPercentage || 0),
      ...newLineItemForm,
      'Account **CARRIER**': accountCarrier,
      'OTG Comp Billing item': otgCompBillingItem,
    };

    // Add to allRecords
    onUpdate([...allRecords, newRecord]);
    
    // Close form and reset
    setIsAddingLineItem(false);
    setNewLineItemForm({});
    setAddLineItemErrors({});
  }, [newLineItemForm, allRecords, account, onUpdate]);

  const handleLogColumns = useCallback((record: MasterRecord) => {
    console.log('=== ALL COLUMNS FOR LINE ITEM ===');
    console.log('Record ID:', record.id);
    console.log('Account:', record.clientName || record['Account **CARRIER**'] || 'N/A');
    console.log('Billing Item:', record['OTG Comp Billing item'] || record['OTG Comp Billing Item'] || 'N/A');
    console.log('\n--- ALL COLUMN NAMES ---');
    const allKeys = Object.keys(record);
    console.log('Total columns:', allKeys.length);
    console.log('Column names:', allKeys.sort());
    console.log('\n--- ALL COLUMN VALUES ---');
    const columnData: Record<string, any> = {};
    allKeys.forEach(key => {
      columnData[key] = record[key];
    });
    console.log(columnData);
    console.log('\n--- COMP-RELATED COLUMNS ---');
    const compKeys = allKeys.filter(k => 
      k.toLowerCase().includes('comp') || 
      k.toLowerCase().includes('rd1') ||
      k.toLowerCase().includes('rd2')
    );
    console.log('COMP-related columns:', compKeys);
    compKeys.forEach(key => {
      console.log(`  ${key}: "${record[key]}"`);
    });
    console.log('=== END COLUMN LOG ===');
  }, []);

  // Helper to get field value (returns original type)
  const getFieldValue = (record: MasterRecord, ...fieldNames: string[]): string | number | undefined => {
    for (const fieldName of fieldNames) {
      // Try exact match first
      if (record[fieldName] !== undefined && record[fieldName] !== null && record[fieldName] !== '') {
        return record[fieldName];
      }
      // Try case-insensitive match
      const lowerFieldName = fieldName.toLowerCase();
      for (const key in record) {
        if (key.toLowerCase() === lowerFieldName) {
          const value = record[key];
          if (value !== undefined && value !== null && value !== '') {
            return value;
          }
        }
      }
    }
    return undefined;
  };

  // Helper to get numeric field value (for edit form inputs) - returns number or undefined
  const getNumericFieldValue = (record: Partial<MasterRecord>, ...fieldNames: string[]): number | undefined => {
    for (const fieldName of fieldNames) {
      // Try exact match first
      if (record[fieldName] !== undefined && record[fieldName] !== null && record[fieldName] !== '') {
        const val = record[fieldName];
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const cleaned = val.replace(/[^0-9.-]+/g, '');
          if (cleaned) {
            const parsed = parseFloat(cleaned);
            if (!isNaN(parsed)) return parsed;
          }
        }
      }
      // Try case-insensitive match
      const lowerFieldName = fieldName.toLowerCase();
      for (const key in record) {
        if (key.toLowerCase() === lowerFieldName) {
          const value = record[key];
          if (value !== undefined && value !== null && value !== '') {
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
              const cleaned = value.replace(/[^0-9.-]+/g, '');
              if (cleaned) {
                const parsed = parseFloat(cleaned);
                if (!isNaN(parsed)) return parsed;
              }
            }
          }
        }
      }
    }
    return undefined;
  };

  // Helper to parse numeric value
  const parseNumeric = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const cleaned = String(val).replace(/[^0-9.-]+/g, '');
    return parseFloat(cleaned) || 0;
  };

  // Helper to parse percentage (handles both decimal and percentage formats)
  const parsePercent = (val: any): number => {
    if (typeof val === 'number') {
      return val > 1 ? val / 100 : val;
    }
    if (!val) return 0;
    const cleanStr = String(val).replace(/[^0-9.-]+/g, '');
    let num = parseFloat(cleanStr);
    
    if (String(val).includes('%')) {
      num = num / 100;
    } else if (num > 1) {
      num = num / 100;
    }
    return num || 0;
  };

  // Helper to check if cell should be expandable
  const isCellExpanded = (recordId: string, field: string): boolean => {
    return expandedCell?.recordId === recordId && expandedCell?.field === field;
  };

  const toggleCellExpand = (recordId: string, field: string) => {
    if (isCellExpanded(recordId, field)) {
      setExpandedCell(null);
    } else {
      setExpandedCell({ recordId, field });
    }
  };

  // Expandable cell component
  const ExpandableCell = ({ 
    recordId, 
    field, 
    value, 
    className = '', 
    width, 
    align = 'left',
    isBadge = false
  }: { 
    recordId: string; 
    field: string; 
    value: string | number; 
    className?: string;
    width: string;
    align?: 'left' | 'right';
    isBadge?: boolean;
  }) => {
    const strValue = String(value || '-');
    const isExpanded = isCellExpanded(recordId, field);
    const isLong = strValue.length > (isBadge ? 15 : 20);
    const displayValue = isExpanded ? strValue : (isLong ? strValue.substring(0, isBadge ? 15 : 20) + '...' : strValue);

    if (!isLong && strValue === '-') {
      return (
        <div className={`${width} flex-shrink-0 ${align === 'right' ? 'text-right' : ''}`}>
          {isBadge ? (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>-</span>
          ) : (
            <span className={`text-sm text-slate-700 ${className}`}>-</span>
          )}
        </div>
      );
    }

    if (isBadge) {
      return (
        <div className={`${width} flex-shrink-0`}>
          <button
            onClick={() => isLong && toggleCellExpand(recordId, field)}
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className} ${isLong ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${isExpanded ? 'break-words whitespace-normal' : 'truncate max-w-full'}`}
            title={isLong ? (isExpanded ? 'Click to collapse' : 'Click to expand') : strValue}
          >
            {displayValue}
            {isLong && (
              isExpanded ? (
                <ChevronUp size={12} className="inline-block ml-1 flex-shrink-0" />
              ) : (
                <ChevronDown size={12} className="inline-block ml-1 flex-shrink-0" />
              )
            )}
          </button>
        </div>
      );
    }

    return (
      <div className={`${width} flex-shrink-0 ${align === 'right' ? 'text-right' : ''}`}>
        <button
          onClick={() => isLong && toggleCellExpand(recordId, field)}
          className={`w-full text-left ${isLong ? 'cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors' : ''} ${className}`}
          title={isLong ? (isExpanded ? 'Click to collapse' : 'Click to expand') : strValue}
        >
          {isExpanded ? (
            <div className="break-words whitespace-normal text-sm">
              {strValue}
              {isLong && <ChevronUp size={12} className="inline-block ml-1 text-slate-400" />}
            </div>
          ) : (
            <div className="truncate text-sm">
              {displayValue}
              {isLong && <ChevronDown size={12} className="inline-block ml-1 text-slate-400" />}
            </div>
          )}
        </button>
      </div>
    );
  };

  // Get all relevant fields for display
  const getDisplayFields = (record: MasterRecord) => {
    const st = getFieldValue(record, 'ST', 'st') || '-';
    const otgCompBillingItem = getFieldValue(record, 'OTG Comp Billing item', 'OTG Comp Billing Item', 'otgCompBillingItem') || '-';
    const serviceType = getFieldValue(record, 'Service Provider', 'service provider', 'serviceType') || '-';
    const statusType = getFieldValue(record, 'Status / Type', 'status / type', 'status', 'type') || '-';
    const itemDesc = getFieldValue(record, 'Item Desc. from current Carrier Statement', 'item desc. from current carrier statement', 'item desc') || '-';
    const activeBan = getFieldValue(record, 'Cust. ACTIVE BAN', 'cust. active ban', 'active ban', 'ban') || '-';
    const historicBan = getFieldValue(record, 'Historic BAN - non-ZNS', 'historic ban - non-zns', 'historic ban') || '-';
    const quantity = getFieldValue(record, 'Quantity', 'quantity') || '-';
    const price = getFieldValue(record, 'Price', 'price');
    const priceNum = parseNumeric(price);
    const monthlyUnitPrice = getFieldValue(record, 'Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)', 'monthly unit price', 'monthly unit price (qty x price; qrc/semi/yrc x 4,6,or 12)');
    const monthlyUnitPriceNum = parseNumeric(monthlyUnitPrice);
    const monthlyComp = getFieldValue(record, 'Monthly Comp to OTG per EXPECTED Comp %', 'monthly comp to otg per expected comp %', 'Monthly Comp to OTG', 'monthly comp');
    const monthlyCompNum = parseNumeric(monthlyComp);
    const comp1 = getFieldValue(record, 'COMP 1', 'comp 1') || '-';
    const comp2 = getFieldValue(record, 'COMP 2', 'comp 2') || '-';
    const comp3 = getFieldValue(record, 'COMP 3', 'comp 3') || '-';
    const comp4 = getFieldValue(record, 'COMP 4', 'comp 4') || '-';
    const locationName = getFieldValue(record, 'Location Name', 'location name', 'location') || '-';
    const serviceAddress = getFieldValue(record, 'Service Address', 'service address', 'address') || '-';
    const orderNum = getFieldValue(record, 'Order #', 'order #', 'order', 'order number') || '-';
    const circuitId = getFieldValue(record, 'Circuit ID', 'circuit id', 'circuit') || '-';
    const installDate = getFieldValue(record, 'Install Date OR OTG Payable Date', 'install date or otg payable date', 'install date') || '-';
    
    return { 
      st, otgCompBillingItem, serviceType, statusType, itemDesc, activeBan, historicBan, quantity, priceNum, 
      monthlyUnitPriceNum, monthlyCompNum, comp1, comp2, comp3, comp4, 
      locationName, serviceAddress, orderNum, circuitId, installDate 
    };
  };

  // Calculate totals for numeric columns
  const totals = useMemo(() => {
    let totalQuantity = 0;
    let totalPrice = 0;
    let totalMonthlyUnitPrice = 0;
    let totalMonthlyComp = 0;

    account.lineItems.forEach(record => {
      const { quantity, priceNum, monthlyUnitPriceNum, monthlyCompNum } = getDisplayFields(record);
      
      // Parse quantity (might be string or number)
      const qty = typeof quantity === 'number' ? quantity : parseFloat(String(quantity).replace(/[^0-9.-]+/g, '')) || 0;
      totalQuantity += qty;
      totalPrice += priceNum;
      totalMonthlyUnitPrice += monthlyUnitPriceNum;
      totalMonthlyComp += monthlyCompNum;
    });

    return {
      totalQuantity,
      totalPrice,
      totalMonthlyUnitPrice,
      totalMonthlyComp,
    };
  }, [account.lineItems]);

  // Check if we should show all columns dynamically (for Master Data 2 with many columns)
  const showAllColumns = columns.length > 20;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-[95vw] flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-slate-800 mb-1 truncate">{account.accountCarrier}</h2>
            <p className="text-sm text-slate-600 truncate">{account.otgCompBillingItem}</p>
            <p className="text-xs text-slate-500 mt-2">
              {account.summary.lineItemCount} line item{account.summary.lineItemCount !== 1 ? 's' : ''} • {columns.length} columns
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddLineItem}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
            >
              <Plus size={16} /> Add Line Item
            </button>
            <button
              onClick={onClose}
              className="ml-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="overflow-y-auto overflow-x-auto flex-1">
            {/* List Header */}
            {showAllColumns ? (
              // Dynamic header for all columns
              <div className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 uppercase tracking-wider" style={{ minWidth: `${columns.length * 150}px` }}>
                  {columns.map((col) => (
                    <div 
                      key={col.key} 
                      className={`flex-shrink-0 ${col.type === 'number' || col.type === 'percent' ? 'text-right' : ''}`}
                      style={{ width: col.type === 'number' || col.type === 'percent' ? '120px' : '150px' }}
                      title={col.label}
                    >
                      <div className="truncate">{col.label}</div>
                    </div>
                  ))}
                  <div className="w-24 flex-shrink-0 text-right">Actions</div>
                </div>
              </div>
            ) : (
              // Fixed header for standard columns
              <div className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-3 text-xs font-semibold text-slate-600 uppercase tracking-wider" style={{ minWidth: '2200px' }}>
                  <div className="w-12 flex-shrink-0">ST</div>
                  <div className="w-32 flex-shrink-0">OTG Comp Billing Item</div>
                  <div className="w-40 flex-shrink-0">Service Provider</div>
                  <div className="w-32 flex-shrink-0">Status/Type</div>
                  <div className="w-48 flex-shrink-0">Item Description</div>
                  <div className="w-28 flex-shrink-0">Active BAN</div>
                  <div className="w-24 flex-shrink-0 text-right">Qty</div>
                  <div className="w-32 flex-shrink-0 text-right">Price</div>
                  <div className="w-36 flex-shrink-0 text-right">Monthly Unit Price</div>
                  <div className="w-32 flex-shrink-0 text-right">Monthly Comp</div>
                  <div className="w-28 flex-shrink-0">COMP 1</div>
                  <div className="w-28 flex-shrink-0">COMP 2</div>
                  <div className="w-28 flex-shrink-0">COMP 3</div>
                  <div className="w-28 flex-shrink-0">COMP 4</div>
                  <div className="w-32 flex-shrink-0">Location</div>
                  <div className="w-40 flex-shrink-0">Order #</div>
                  <div className="w-40 flex-shrink-0">Circuit ID</div>
                  <div className="w-32 flex-shrink-0">Install Date</div>
                  <div className="w-24 flex-shrink-0 text-right">Actions</div>
                </div>
              </div>
            )}

            {/* Add Line Item Form */}
            {isAddingLineItem && (
              <div className="border-b-2 border-green-200 bg-green-50/30 px-4 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">Add New Line Item</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveNewLineItem}
                      className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors"
                      title="Save"
                    >
                      <Save size={16} />
                    </button>
                    <button
                      onClick={handleCancelAddLineItem}
                      className="p-1.5 text-slate-500 hover:bg-slate-100 rounded transition-colors"
                      title="Cancel"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                {showAllColumns ? (
                  // Dynamic form for all columns
                  <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: `${columns.length * 150}px` }}>
                    {columns.map((col) => {
                      const isRequired = col.key === 'Account **CARRIER**' || col.key === 'OTG Comp Billing item';
                      const isDisabled = isRequired; // Disable required fields (pre-filled)
                      const errorKey = col.key === 'Account **CARRIER**' ? 'accountCarrier' : 
                                      col.key === 'OTG Comp Billing item' ? 'otgCompBillingItem' : col.key;
                      const hasError = addLineItemErrors[errorKey];
                      const inputType = col.type === 'number' || col.type === 'percent' ? 'number' : 'text';
                      const value = newLineItemForm[col.key] !== undefined && newLineItemForm[col.key] !== null 
                        ? String(newLineItemForm[col.key]) 
                        : '';
                      
                      return (
                        <div
                          key={col.key}
                          className={`flex-shrink-0 ${col.type === 'number' || col.type === 'percent' ? 'text-right' : ''}`}
                          style={{ width: col.type === 'number' || col.type === 'percent' ? '120px' : '150px' }}
                        >
                          <input
                            type={inputType}
                            step={col.type === 'percent' ? '0.01' : col.type === 'number' ? '0.01' : undefined}
                            className={`w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                              hasError ? 'border-red-300 bg-red-50' : isDisabled ? 'border-slate-200 bg-slate-100' : 'border-slate-300'
                            }`}
                            value={value}
                            onChange={e => {
                              const newValue = col.type === 'number' || col.type === 'percent' 
                                ? (e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)
                                : e.target.value;
                              setNewLineItemForm({ ...newLineItemForm, [col.key]: newValue });
                              // Clear error when user types
                              if (hasError) {
                                const newErrors = { ...addLineItemErrors };
                                delete newErrors[errorKey];
                                setAddLineItemErrors(newErrors);
                              }
                            }}
                            disabled={isDisabled}
                            placeholder={col.label}
                            title={isDisabled ? `${col.label} (pre-filled from account)` : col.label}
                          />
                          {hasError && (
                            <p className="text-xs text-red-600 mt-0.5">{hasError}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // Standard form for fixed columns
                  <div className="flex items-center gap-3 flex-wrap" style={{ minWidth: '2200px' }}>
                    <div className="w-12 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm.ST || newLineItemForm.st || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, ST: e.target.value, st: e.target.value })}
                        placeholder="ST"
                      />
                    </div>
                    <div className="w-32 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-200 bg-slate-100 rounded px-2 py-1 text-sm"
                        value={String(newLineItemForm['Account **CARRIER**'] || account.accountCarrier || '')}
                        disabled
                        title="Account **CARRIER** (pre-filled from account)"
                      />
                    </div>
                    <div className="w-32 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-200 bg-slate-100 rounded px-2 py-1 text-sm"
                        value={String(newLineItemForm['OTG Comp Billing item'] || account.otgCompBillingItem || '')}
                        disabled
                        title="OTG Comp Billing item (pre-filled from account)"
                      />
                    </div>
                    <div className="w-40 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['Service Provider'] || newLineItemForm.serviceProvider || newLineItemForm.serviceType || '')}
                        onChange={e => {
                          const val = e.target.value;
                          setNewLineItemForm({ ...newLineItemForm, 'Service Provider': val, serviceProvider: val, serviceType: val });
                        }}
                        placeholder="Service Provider"
                      />
                    </div>
                    <div className="w-32 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['Status / Type'] || newLineItemForm.status || newLineItemForm.type || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, 'Status / Type': e.target.value, status: e.target.value, type: e.target.value })}
                        placeholder="Status/Type"
                      />
                    </div>
                    <div className="w-48 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['Item Desc. from current Carrier Statement'] || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, 'Item Desc. from current Carrier Statement': e.target.value })}
                        placeholder="Item Description"
                      />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['Cust. ACTIVE BAN'] || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, 'Cust. ACTIVE BAN': e.target.value })}
                        placeholder="Active BAN"
                      />
                    </div>
                    <div className="w-24 flex-shrink-0 text-right">
                      <input
                        type="number"
                        step="1"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={newLineItemForm.Quantity || newLineItemForm.quantity || ''}
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                          setNewLineItemForm({ ...newLineItemForm, Quantity: val, quantity: val });
                        }}
                        placeholder="0"
                      />
                    </div>
                    <div className="w-32 flex-shrink-0 text-right">
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={newLineItemForm.Price || newLineItemForm.price || ''}
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                          setNewLineItemForm({ ...newLineItemForm, Price: val, price: val });
                        }}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="w-36 flex-shrink-0 text-right">
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={newLineItemForm['Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)'] || ''}
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                          setNewLineItemForm({ ...newLineItemForm, 'Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)': val });
                        }}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="w-32 flex-shrink-0 text-right">
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={newLineItemForm['EXPECTED/Mo. OTG Comp % - column R Comp Key'] || ''}
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                          setNewLineItemForm({ ...newLineItemForm, 'EXPECTED/Mo. OTG Comp % - column R Comp Key': val });
                        }}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['COMP 1'] || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, 'COMP 1': e.target.value })}
                        placeholder="COMP 1"
                      />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['COMP 2'] || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, 'COMP 2': e.target.value })}
                        placeholder="COMP 2"
                      />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['COMP 3'] || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, 'COMP 3': e.target.value })}
                        placeholder="COMP 3"
                      />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <input
                        type="text"
                        className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        value={String(newLineItemForm['COMP 4'] || '')}
                        onChange={e => setNewLineItemForm({ ...newLineItemForm, 'COMP 4': e.target.value })}
                        placeholder="COMP 4"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Line Items List */}
            {account.lineItems.length === 0 && !isAddingLineItem ? (
              <div className="px-4 py-16 text-center text-slate-400">
                No line items found
              </div>
            ) : (
              <div>
                {account.lineItems.map((record) => {
                  const isEditing = editingId === record.id;

                  // If showing all columns, render dynamically
                  if (showAllColumns) {
                    return (
                      <div
                        key={record.id}
                        className={`border-b border-slate-100 transition-all group ${
                          isEditing
                            ? 'bg-indigo-50/50 shadow-sm'
                            : 'bg-white hover:bg-slate-50/80'
                        }`}
                      >
                        {isEditing ? (
                          // Dynamic editing mode for all columns
                          <div className="px-4 py-3 flex items-center gap-2" style={{ minWidth: `${columns.length * 150}px` }}>
                            {columns.map((col) => {
                              const value = editForm[col.key] !== undefined ? editForm[col.key] : record[col.key];
                              const inputType = col.type === 'number' || col.type === 'percent' ? 'number' : 'text';
                              
                              return (
                                <div
                                  key={col.key}
                                  className={`flex-shrink-0 ${col.type === 'number' || col.type === 'percent' ? 'text-right' : ''}`}
                                  style={{ width: col.type === 'number' || col.type === 'percent' ? '120px' : '150px' }}
                                >
                                  <input
                                    type={inputType}
                                    step={col.type === 'percent' ? '0.01' : col.type === 'number' ? '0.01' : undefined}
                                    className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    value={value !== undefined && value !== null ? String(value) : ''}
                                    onChange={e => {
                                      const newValue = col.type === 'number' || col.type === 'percent' 
                                        ? (e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)
                                        : e.target.value;
                                      setEditForm({ ...editForm, [col.key]: newValue });
                                    }}
                                    placeholder={col.label}
                                    title={col.label}
                                  />
                                </div>
                              );
                            })}
                            <div className="w-24 flex-shrink-0 flex justify-end gap-2">
                              <button
                                onClick={handleSave}
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                                title="Save"
                              >
                                <Save size={14} />
                              </button>
                              <button
                                onClick={handleCancel}
                                className="p-1.5 text-slate-500 hover:bg-slate-100 rounded transition-colors"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          // Dynamic view mode for all columns
                          <div className="px-4 py-3 flex items-start gap-2" style={{ minWidth: `${columns.length * 150}px` }}>
                            {columns.map((col) => {
                              const value = record[col.key];
                              const strValue = value !== undefined && value !== null ? String(value) : '';
                              const isLong = strValue.length > 30;
                              const isExpanded = expandedCell?.recordId === record.id && expandedCell?.field === col.key;
                              
                              return (
                                <div
                                  key={col.key}
                                  className={`flex-shrink-0 ${col.type === 'number' || col.type === 'percent' ? 'text-right' : ''}`}
                                  style={{ width: col.type === 'number' || col.type === 'percent' ? '120px' : '150px' }}
                                >
                                  {isLong ? (
                                    <button
                                      onClick={() => setExpandedCell(isExpanded ? null : { recordId: record.id, field: col.key })}
                                      className="w-full text-left text-sm text-slate-700 hover:bg-slate-100 rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors"
                                      title={isExpanded ? 'Click to collapse' : 'Click to expand'}
                                    >
                                      {isExpanded ? (
                                        <div className="break-words whitespace-normal">
                                          {strValue}
                                        </div>
                                      ) : (
                                        <div className="truncate">
                                          {strValue.substring(0, 30)}...
                                        </div>
                                      )}
                                    </button>
                                  ) : (
                                    <div className="text-sm text-slate-700 truncate" title={strValue}>
                                      {col.type === 'number' || col.type === 'percent' ? (
                                        typeof value === 'number' ? (
                                          col.type === 'percent' 
                                            ? `${(value * 100).toFixed(2)}%`
                                            : formatNumber(value, 2)
                                        ) : (
                                          strValue
                                        )
                                      ) : (
                                        strValue || '-'
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            <div className="w-24 flex-shrink-0 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleEditClick(record)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                                title="Edit"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(record.id)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Standard rendering for fixed columns
                  const { 
                    st, otgCompBillingItem, serviceType, statusType, itemDesc, activeBan, quantity, priceNum, 
                    monthlyUnitPriceNum, monthlyCompNum, comp1, comp2, comp3, comp4,
                    locationName, orderNum, circuitId, installDate 
                  } = getDisplayFields(record);

                  return (
                    <div
                      key={record.id}
                      className={`border-b border-slate-100 transition-all group ${
                        isEditing
                          ? 'bg-indigo-50/50 shadow-sm'
                          : 'bg-white hover:bg-slate-50/80'
                      }`}
                    >
                      {isEditing ? (
                        // Standard editing mode for fixed columns
                        <div className="px-4 py-3 flex items-center gap-3" style={{ minWidth: '2200px' }}>
                            <div className="w-12 flex-shrink-0">
                              <input
                                type="text"
                                className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                value={String(getFieldValue(editForm as MasterRecord, 'ST', 'st') || editForm.ST || editForm.st || '')}
                                onChange={e => setEditForm({ ...editForm, ST: e.target.value, st: e.target.value })}
                                placeholder="ST"
                              />
                            </div>
                          <div className="w-32 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'OTG Comp Billing item', 'OTG Comp Billing Item', 'otgCompBillingItem') || editForm['OTG Comp Billing item'] || editForm['OTG Comp Billing Item'] || editForm.otgCompBillingItem || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'OTG Comp Billing item': val, 'OTG Comp Billing Item': val, otgCompBillingItem: val });
                              }}
                              placeholder="OTG Comp Billing Item"
                            />
                          </div>
                          <div className="w-40 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Service Provider', 'service provider', 'serviceType') || editForm['Service Provider'] || editForm.serviceProvider || editForm.serviceType || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'Service Provider': val, serviceProvider: val, serviceType: val });
                              }}
                              placeholder="Service Provider"
                            />
                          </div>
                          <div className="w-32 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Status / Type', 'status / type', 'status', 'type') || editForm['Status / Type'] || editForm.status || editForm.type || '')}
                              onChange={e => setEditForm({ ...editForm, 'Status / Type': e.target.value, status: e.target.value, type: e.target.value })}
                              placeholder="Status/Type"
                            />
                          </div>
                          <div className="w-48 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Item Desc. from current Carrier Statement', 'item desc. from current carrier statement', 'item desc') || editForm['Item Desc. from current Carrier Statement'] || '')}
                              onChange={e => setEditForm({ ...editForm, 'Item Desc. from current Carrier Statement': e.target.value })}
                              placeholder="Item Description"
                            />
                          </div>
                          <div className="w-28 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Cust. ACTIVE BAN', 'cust. active ban', 'active ban', 'ban') || editForm['Cust. ACTIVE BAN'] || editForm['cust. active ban'] || '')}
                              onChange={e => setEditForm({ ...editForm, 'Cust. ACTIVE BAN': e.target.value })}
                              placeholder="Active BAN"
                            />
                          </div>
                          <div className="w-24 flex-shrink-0 text-right">
                            <input
                              type="number"
                              step="1"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={getNumericFieldValue(editForm, 'Quantity', 'quantity') ?? editForm.Quantity ?? editForm.quantity ?? ''}
                              onChange={e => {
                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                setEditForm({ ...editForm, Quantity: val, quantity: val });
                              }}
                              placeholder="0"
                            />
                          </div>
                          <div className="w-32 flex-shrink-0 text-right">
                            <input
                              type="number"
                              step="0.01"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={getNumericFieldValue(editForm, 'Price', 'price') ?? editForm.Price ?? editForm.price ?? ''}
                              onChange={e => {
                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                setEditForm({ ...editForm, Price: val, price: val });
                              }}
                              placeholder="0.00"
                            />
                          </div>
                          <div className="w-36 flex-shrink-0 text-right">
                            <input
                              type="number"
                              step="0.01"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={getNumericFieldValue(editForm, 'Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)', 'monthly unit price', 'monthly unit price (qty x price; qrc/semi/yrc x 4,6,or 12)', 'Monthly Unit Price') ?? editForm['Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)'] ?? ''}
                              onChange={e => {
                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                setEditForm({ ...editForm, 'Monthly Unit Price (Qty x Price; QRC/SEMI/YRC x 4,6,or 12)': val });
                              }}
                              placeholder="0.00"
                            />
                          </div>
                          <div className="w-32 flex-shrink-0 text-right">
                            <input
                              type="number"
                              step="0.01"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={getNumericFieldValue(editForm, 'Monthly Comp to OTG per EXPECTED Comp %', 'monthly comp to otg per expected comp %', 'Monthly Comp to OTG', 'monthly comp') ?? editForm['Monthly Comp to OTG per EXPECTED Comp %'] ?? ''}
                              onChange={e => {
                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                setEditForm({ ...editForm, 'Monthly Comp to OTG per EXPECTED Comp %': val, monthlyComp: val });
                              }}
                              placeholder="0.00"
                            />
                          </div>
                          <div className="w-28 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'COMP 1', 'comp 1') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'COMP 1': val });
                              }}
                              placeholder="COMP 1"
                            />
                          </div>
                          <div className="w-28 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'COMP 2', 'comp 2') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'COMP 2': val });
                              }}
                              placeholder="COMP 2"
                            />
                          </div>
                          <div className="w-28 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'COMP 3', 'comp 3') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'COMP 3': val });
                              }}
                              placeholder="COMP 3"
                            />
                          </div>
                          <div className="w-28 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'COMP 4', 'comp 4') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'COMP 4': val });
                              }}
                              placeholder="COMP 4"
                            />
                          </div>
                          <div className="w-32 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Location Name', 'location name', 'location') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'Location Name': val, location: val });
                              }}
                              placeholder="Location"
                            />
                          </div>
                          <div className="w-40 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Order #', 'order #', 'order', 'order number') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'Order #': val, order: val });
                              }}
                              placeholder="Order #"
                            />
                          </div>
                          <div className="w-40 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Circuit ID', 'circuit id', 'circuit') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'Circuit ID': val, circuit: val });
                              }}
                              placeholder="Circuit ID"
                            />
                          </div>
                          <div className="w-32 flex-shrink-0">
                            <input
                              type="text"
                              className="w-full border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={String(getFieldValue(editForm as MasterRecord, 'Install Date OR OTG Payable Date', 'install date or otg payable date', 'install date') || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setEditForm({ ...editForm, 'Install Date OR OTG Payable Date': val, installDate: val });
                              }}
                              placeholder="Install Date"
                            />
                          </div>
                          <div className="w-24 flex-shrink-0 flex justify-end gap-2">
                            <button
                              onClick={handleSave}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                              title="Save"
                            >
                              <Save size={14} />
                            </button>
                            <button
                              onClick={handleCancel}
                              className="p-1.5 text-slate-500 hover:bg-slate-100 rounded transition-colors"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 py-3 flex items-start gap-3" style={{ minWidth: '2200px' }}>
                          <div className="w-12 flex-shrink-0 pt-0.5">
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {st}
                            </span>
                          </div>
                          <ExpandableCell 
                            recordId={record.id} 
                            field="otgCompBillingItem" 
                            value={otgCompBillingItem}
                            className="text-slate-800 font-mono font-medium"
                            width="w-32"
                          />
                          <ExpandableCell 
                            recordId={record.id} 
                            field="serviceType" 
                            value={serviceType}
                            className="text-slate-800"
                            width="w-40"
                          />
                          <ExpandableCell 
                            recordId={record.id} 
                            field="statusType" 
                            value={statusType}
                            className="text-slate-700"
                            width="w-32"
                          />
                          <ExpandableCell 
                            recordId={record.id} 
                            field="itemDesc" 
                            value={itemDesc}
                            className="text-slate-700"
                            width="w-48"
                          />
                          <ExpandableCell 
                            recordId={record.id} 
                            field="activeBan" 
                            value={activeBan}
                            className="text-slate-700 font-mono"
                            width="w-28"
                          />
                          <div className="w-24 flex-shrink-0 text-right pt-0.5">
                            <span className="text-sm font-semibold text-slate-800">{quantity}</span>
                          </div>
                          <div className="w-32 flex-shrink-0 text-right pt-0.5">
                            <span className="text-sm font-semibold text-slate-800">
                              {formatCurrency(priceNum)}
                            </span>
                          </div>
                          <div className="w-36 flex-shrink-0 text-right pt-0.5">
                            <span className="text-sm font-semibold text-slate-800">
                              {formatCurrency(monthlyUnitPriceNum)}
                            </span>
                          </div>
                          <div className="w-32 flex-shrink-0 text-right pt-0.5">
                            <span className="text-sm font-semibold text-indigo-600">
                              {formatCurrency(monthlyCompNum)}
                            </span>
                          </div>
                          <div className="w-28 flex-shrink-0 pt-0.5">
                            <ExpandableCell 
                              recordId={record.id} 
                              field="comp1" 
                              value={comp1}
                              className="bg-blue-50 text-blue-700 border border-blue-200"
                              width="w-full"
                              isBadge={true}
                            />
                          </div>
                          <div className="w-28 flex-shrink-0 pt-0.5">
                            <ExpandableCell 
                              recordId={record.id} 
                              field="comp2" 
                              value={comp2}
                              className="bg-purple-50 text-purple-700 border border-purple-200"
                              width="w-full"
                              isBadge={true}
                            />
                          </div>
                          <div className="w-28 flex-shrink-0 pt-0.5">
                            <ExpandableCell 
                              recordId={record.id} 
                              field="comp3" 
                              value={comp3}
                              className="bg-green-50 text-green-700 border border-green-200"
                              width="w-full"
                              isBadge={true}
                            />
                          </div>
                          <div className="w-28 flex-shrink-0 pt-0.5">
                            <ExpandableCell 
                              recordId={record.id} 
                              field="comp4" 
                              value={comp4}
                              className="bg-orange-50 text-orange-700 border border-orange-200"
                              width="w-full"
                              isBadge={true}
                            />
                          </div>
                          <ExpandableCell 
                            recordId={record.id} 
                            field="locationName" 
                            value={locationName}
                            className="text-slate-700"
                            width="w-32"
                          />
                          <ExpandableCell 
                            recordId={record.id} 
                            field="orderNum" 
                            value={orderNum}
                            className="text-slate-700 font-mono"
                            width="w-40"
                          />
                          <ExpandableCell 
                            recordId={record.id} 
                            field="circuitId" 
                            value={circuitId}
                            className="text-slate-700 font-mono"
                            width="w-40"
                          />
                          <ExpandableCell 
                            recordId={record.id} 
                            field="installDate" 
                            value={installDate}
                            className="text-slate-600"
                            width="w-32"
                          />
                          <div className="w-24 flex-shrink-0 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                            <button
                              onClick={() => handleLogColumns(record)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Log All Columns (Check Console)"
                            >
                              <Bug size={14} />
                            </button>
                            <button
                              onClick={() => handleEditClick(record)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(record.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {/* Totals Row */}
                <div className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-300 px-4 py-3 flex items-center gap-3" style={{ minWidth: '2200px' }}>
                  <div className="w-12 flex-shrink-0"></div>
                  <div className="w-32 flex-shrink-0"></div>
                  <div className="w-40 flex-shrink-0">
                    <span className="text-sm font-bold text-slate-800">TOTALS</span>
                  </div>
                  <div className="w-32 flex-shrink-0"></div>
                  <div className="w-48 flex-shrink-0"></div>
                  <div className="w-28 flex-shrink-0"></div>
                  <div className="w-24 flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-slate-800">{formatWholeNumber(totals.totalQuantity)}</span>
                  </div>
                  <div className="w-32 flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-slate-800">
                      {formatCurrency(totals.totalPrice)}
                    </span>
                  </div>
                  <div className="w-36 flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-slate-800">
                      {formatCurrency(totals.totalMonthlyUnitPrice)}
                    </span>
                  </div>
                  <div className="w-32 flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-indigo-700">
                      {formatCurrency(totals.totalMonthlyComp)}
                    </span>
                  </div>
                  <div className="w-28 flex-shrink-0"></div>
                  <div className="w-28 flex-shrink-0"></div>
                  <div className="w-28 flex-shrink-0"></div>
                  <div className="w-28 flex-shrink-0"></div>
                  <div className="w-32 flex-shrink-0"></div>
                  <div className="w-40 flex-shrink-0"></div>
                  <div className="w-40 flex-shrink-0"></div>
                  <div className="w-32 flex-shrink-0"></div>
                  <div className="w-24 flex-shrink-0"></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end items-center rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountDetailsModal;
