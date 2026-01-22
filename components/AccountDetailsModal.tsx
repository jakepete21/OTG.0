import React, { useState, useCallback, useMemo } from 'react';
import { X, Edit2, Trash2, Save, FileText, DollarSign, ChevronDown, ChevronUp, Bug } from 'lucide-react';
import { MasterRecord } from '../types';
import { AccountGroup } from '../services/accountGrouping';

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
              {account.summary.lineItemCount} line item{account.summary.lineItemCount !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="overflow-y-auto overflow-x-auto flex-1">
            {/* List Header */}
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

            {/* Line Items List */}
            {account.lineItems.length === 0 ? (
              <div className="px-4 py-16 text-center text-slate-400">
                No line items found
              </div>
            ) : (
              <div>
                {account.lineItems.map((record) => {
                  const isEditing = editingId === record.id;
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
                              ${priceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="w-36 flex-shrink-0 text-right pt-0.5">
                            <span className="text-sm font-semibold text-slate-800">
                              ${monthlyUnitPriceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="w-32 flex-shrink-0 text-right pt-0.5">
                            <span className="text-sm font-semibold text-indigo-600">
                              ${monthlyCompNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                    <span className="text-sm font-bold text-slate-800">{totals.totalQuantity.toLocaleString('en-US')}</span>
                  </div>
                  <div className="w-32 flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-slate-800">
                      ${totals.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="w-36 flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-slate-800">
                      ${totals.totalMonthlyUnitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="w-32 flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-indigo-700">
                      ${totals.totalMonthlyComp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
