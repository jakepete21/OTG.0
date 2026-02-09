import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnalysisResult, CommissionStatement, CarrierStatementProcessingResult, SellerStatement } from '../types';
import { Download, ChevronDown, ChevronUp, User, DollarSign, AlertTriangle, Calendar, CheckCircle, XCircle, Trash2, RefreshCw, Filter } from 'lucide-react';
import { exportCommissionStatementPDF } from '../services/pdfExport';
import { useProcessingMonths, useSellerStatements, useCarrierStatements, useAllCarrierStatements, useDeleteCarrierStatement, useRegenerateSellerStatements, useRemoveItemsFromSellerStatements, useFixCarrierStatementProcessingMonth, useMatchesForProcessingMonth } from '../services/firebaseHooks';
import type { CarrierStatementDoc } from '../services/firebaseQueries';
import { CarrierType } from '../services/monthDetection';
import { formatCurrency } from '../services/numberFormat';
import { markAsPendingDeletion, removePendingDeletion } from '../services/pendingDeletions';

interface ReportsProps {
  analysisResult: AnalysisResult | null;
  carrierStatementResult: CarrierStatementProcessingResult | null;
  masterData: any[]; // MasterRecord[]
}

const CARRIER_LABELS: Record<CarrierType, string> = {
  GoTo: 'GoTo',
  Lumen: 'Lumen',
  MetTel: 'MetTel',
  TBO: 'TBO',
  Zayo: 'Zayo',
  Allstream: 'Allstream',
};

interface MonthSectionProps {
  monthData: {
    monthKey: string;
    monthLabel: string;
    carriers: Record<string, string>;
    status: 'complete' | 'partial' | 'empty';
  };
  isExpanded: boolean;
  onToggle: () => void;
  statusBadge: string;
  statusColor: string;
  allCarriers: CarrierType[];
  uploadedCarriers: CarrierType[];
  pendingDeletions: Set<string>;
  deletingStatementId: string | null;
  deleteConfirmStatementId: string | null;
  setDeleteConfirmStatementId: (statementId: string | null) => void;
  onDeleteCarrier: (statementId: string, carrier: string, processingMonth: string, sellerStatementsForMonth?: SellerStatement[]) => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  onFixZayoProcessingMonth?: (zayoStatementId: string, correctProcessingMonth: string) => void;
  zayoFixNeeded?: { statementId: string; currentMonth: string; correctMonth: string } | null;
  carrierStatementResult: CarrierStatementProcessingResult | null;
  optimisticSellerStatements: {
    monthKey: string;
    statementId: string;
    filteredStatements: SellerStatement[];
  } | null;
  expandedRoleGroup: string | null;
  toggleRoleGroup: (roleGroup: string) => void;
}

/**
 * Account-level aggregation for seller statements
 */
interface AccountSummary {
  accountName: string;
  state: string;
  provider: string;
  carrier?: string;
  totalOtgComp: number;
  totalSellerComp: number;
  itemCount: number;
}

/** Column filter: text input + Sheets-style value dropdown. Defined at module level so it keeps focus when typing. */
interface ColumnFilterDropdownProps {
  columnId: string;
  label: string;
  alignRight: boolean;
  uniqueValues: string[];
  selectedValues: string[] | null;
  onSelectedValuesChange: (v: string[] | null) => void;
  textFilter: string;
  onTextFilterChange: (v: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}
const ColumnFilterDropdown: React.FC<ColumnFilterDropdownProps> = ({
  columnId,
  label,
  alignRight,
  uniqueValues,
  selectedValues,
  onSelectedValuesChange,
  textFilter,
  onTextFilterChange,
  isOpen,
  onOpenChange,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !wrapperRef.current) {
      setPanelPosition(null);
      return;
    }
    const rect = wrapperRef.current.getBoundingClientRect();
    setPanelPosition({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, onOpenChange]);

  const effectiveSelected = selectedValues ?? uniqueValues;
  const searchLower = search.trim().toLowerCase();
  const filteredUnique = searchLower
    ? uniqueValues.filter(v => v.toLowerCase().includes(searchLower))
    : uniqueValues;

  const dropdownPanel = panelPosition && (
    <div
      ref={panelRef}
      className="fixed min-w-[200px] max-w-[280px] bg-white border border-slate-200 rounded-lg shadow-lg py-2 z-[9999]"
      style={{ top: panelPosition.top, left: panelPosition.left, maxHeight: 'min(320px, calc(100vh - 1rem))' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="px-2 pb-2 border-b border-slate-100">
        <p className="text-xs font-medium text-slate-500 mb-1.5">{label}</p>
        <input
          type="text"
          placeholder="Search list..."
          className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-slate-50"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 mt-1.5">
          <button
            type="button"
            className="text-xs text-indigo-600 hover:underline"
            onClick={() => onSelectedValuesChange(null)}
          >
            Select all
          </button>
          <button
            type="button"
            className="text-xs text-slate-500 hover:underline"
            onClick={() => onSelectedValuesChange([])}
          >
            Deselect all
          </button>
        </div>
      </div>
      <div className="max-h-[220px] overflow-y-auto overflow-x-hidden px-2 pt-2">
        {filteredUnique.length === 0 ? (
          <p className="text-xs text-slate-400">No values</p>
        ) : (
          filteredUnique.map(val => {
            const checked = effectiveSelected.includes(val);
            return (
              <label key={val} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? effectiveSelected.filter(x => x !== val)
                      : [...effectiveSelected, val];
                    onSelectedValuesChange(next.length === uniqueValues.length ? null : next);
                  }}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <span className="text-xs text-slate-700 truncate" title={val}>{val || '(blank)'}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
      <input
        type="text"
        placeholder="Text..."
        className={`flex-1 min-w-0 max-w-[72px] px-1.5 py-0.5 text-xs border border-slate-200 rounded bg-white ${alignRight ? 'text-right' : ''}`}
        value={textFilter}
        onChange={e => onTextFilterChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        className={`p-0.5 rounded border shrink-0 ${isOpen ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
        title="Filter by value"
        aria-label={`Filter ${label}`}
      >
        <Filter size={14} />
      </button>
      {isOpen && createPortal(dropdownPanel, document.body)}
    </div>
  );
};

/**
 * Wrapper component that queries carrier statements directly for more reliable status
 */
const MonthSectionWithCarrierQuery: React.FC<Omit<MonthSectionProps, 'statusBadge' | 'statusColor' | 'allCarriers' | 'uploadedCarriers'> & {
  monthData: MonthSectionProps['monthData'];
  isExpanded: boolean;
  onToggle: () => void;
}> = (props) => {
  const { monthData } = props;
  
  // Query carrier statements directly for this month to get most up-to-date data
  const carrierStatementsForMonth = useCarrierStatements(monthData.monthKey);
  
  // Also get ALL carrier statements to debug if Zayo exists with wrong processing month
  const allCarrierStatements = useAllCarrierStatements();
  
  // Get seller statements to check if Zayo data exists
  const sellerStatementsForMonth = useSellerStatements(monthData.monthKey);
  
  
  // Detect if Zayo has wrong processing month
  // Show fix button if Zayo exists but has wrong processing month
  // For now, show it if Zayo has wrong processing month and we're looking at February
  // (since the diagnostic log shows Zayo should be in February based on RCVD date)
  const zayoFixNeeded = useMemo(() => {
    const zayoStatements = allCarrierStatements.filter(s => s.carrier === 'Zayo');
    if (zayoStatements.length > 0) {
      const zayo = zayoStatements[0];
      
      // Check if seller statements have Zayo data (indicating it should be here)
      const hasZayoData = sellerStatementsForMonth && sellerStatementsForMonth.some(stmt => 
        stmt.items.some((item: any) => item.provider === 'Zayo')
      );
      
      // Calculate what processing month SHOULD be based on statement month + Zayo's +2 offset
      let expectedProcessingMonth: string | null = null;
      if (zayo.statementMonth) {
        // Parse statement month (format: "YYYY-MM")
        const [year, month] = zayo.statementMonth.split('-').map(Number);
        const statementDate = new Date(year, month - 1, 1); // month is 1-indexed in string
        // Add Zayo's +2 month offset
        const processingDate = new Date(statementDate);
        processingDate.setMonth(processingDate.getMonth() + 2);
        expectedProcessingMonth = `${processingDate.getFullYear()}-${String(processingDate.getMonth() + 1).padStart(2, '0')}`;
      }
      
      // Also check filename for RCVD date to calculate correct processing month
      // If filename has "RCVD 2025-12", statement month should be December 2025 → February 2026
      let rcvdBasedProcessingMonth: string | null = null;
      if (zayo.filename && zayo.filename.toLowerCase().includes('rcvd')) {
        const rcvdMatch = zayo.filename.toLowerCase().match(/rcvd\s+(\d{4})-(\d{1,2})/);
        if (rcvdMatch) {
          const rcvdYear = parseInt(rcvdMatch[1], 10);
          const rcvdMonth = parseInt(rcvdMatch[2], 10) - 1; // JS months are 0-indexed
          // For Zayo, statement month = RCVD month, processing month = RCVD month + 2
          const rcvdProcessingDate = new Date(rcvdYear, rcvdMonth, 1);
          rcvdProcessingDate.setMonth(rcvdProcessingDate.getMonth() + 2);
          rcvdBasedProcessingMonth = `${rcvdProcessingDate.getFullYear()}-${String(rcvdProcessingDate.getMonth() + 1).padStart(2, '0')}`;
        }
      }
      
      // Show fix button if:
      // - Zayo has wrong processing month AND
      // - (Seller statements have Zayo data OR expected processing month matches current month OR RCVD-based processing month matches)
      const shouldShowFix = zayo.processingMonth !== monthData.monthKey && 
          (hasZayoData || 
           expectedProcessingMonth === monthData.monthKey || 
           rcvdBasedProcessingMonth === monthData.monthKey);
      
      if (shouldShowFix) {
        return {
          statementId: zayo.id,
          currentMonth: zayo.processingMonth,
          correctMonth: monthData.monthKey
        };
      }
    }
    return null;
  }, [allCarrierStatements, monthData.monthKey, sellerStatementsForMonth]);
  
  // Merge carriers: START with monthData.carriers (immediate, already computed)
  // Then enhance with direct query results once they arrive (for real-time updates)
  // This ensures instant display while still getting real-time updates
  const mergedCarriers = useMemo(() => {
    // Start with monthData.carriers (immediate, no async delay)
    const merged: Record<string, string> = { ...monthData.carriers };
    
    // Enhance with direct query results (once Firebase returns data)
    // This ensures we get real-time updates if a statement is added/deleted
    carrierStatementsForMonth.forEach(stmt => {
      if (stmt.carrier) {
        merged[stmt.carrier] = stmt.id;
      }
    });
    
    // Also check allCarrierStatements for this specific month (in case query missed it)
    // This is a safety net - if direct query doesn't find it but it exists, include it
    allCarrierStatements.forEach(stmt => {
      if (stmt.carrier && stmt.processingMonth === monthData.monthKey && !merged[stmt.carrier]) {
        merged[stmt.carrier] = stmt.id;
      }
    });
    
    // Only include Zayo if its processingMonth matches this month
    // If seller statements have Zayo data but no matching Zayo statement for this month,
    // don't add it to carriers (let the fix button handle mismatches)
    if (!merged['Zayo']) {
      const zayoStatement = allCarrierStatements.find(s => s.carrier === 'Zayo' && s.processingMonth === monthData.monthKey);
      if (zayoStatement) {
        merged['Zayo'] = zayoStatement.id;
      }
    }
    
    return merged;
  }, [monthData.carriers, monthData.monthKey, carrierStatementsForMonth, allCarrierStatements]);
  
  const allCarriers: CarrierType[] = ['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'];
  const uploadedCarriers = Object.keys(mergedCarriers).filter(Boolean) as CarrierType[];
  const uploadedCount = uploadedCarriers.length;
  
  // Recalculate status based on merged carriers (most reliable)
  const actualStatus: 'complete' | 'partial' | 'empty' = 
    uploadedCount === 0 ? 'empty' :
    uploadedCount === 6 ? 'complete' :
    'partial';
  
  
  const statusBadge = actualStatus === 'complete' ? 'Complete' : 
                     actualStatus === 'partial' ? `Partial (${uploadedCount}/6)` : 
                     'Empty';
  const statusColor = actualStatus === 'complete' ? 'bg-green-100 text-green-700' :
                     actualStatus === 'partial' ? 'bg-amber-100 text-amber-700' :
                     'bg-slate-100 text-slate-500';
  
  // Create monthData with merged carriers for MonthSection
  const monthDataWithMergedCarriers = {
    ...monthData,
    carriers: mergedCarriers,
    status: actualStatus,
  };
  
  return (
    <MonthSection
      {...props}
      monthData={monthDataWithMergedCarriers}
      statusBadge={statusBadge}
      statusColor={statusColor}
      allCarriers={allCarriers}
      uploadedCarriers={uploadedCarriers}
      zayoFixNeeded={zayoFixNeeded}
    />
  );
};

/**
 * MonthSection component - displays a single expandable month with carrier status and seller statements
 */
const MonthSection: React.FC<MonthSectionProps> = ({
  monthData,
  isExpanded,
  onToggle,
  statusBadge,
  statusColor,
  allCarriers,
  uploadedCarriers,
  pendingDeletions,
  deletingStatementId,
  deleteConfirmStatementId,
  setDeleteConfirmStatementId,
  onDeleteCarrier,
  onRegenerate,
  isRegenerating,
  carrierStatementResult,
  optimisticSellerStatements,
  expandedRoleGroup,
  toggleRoleGroup,
  onFixZayoProcessingMonth,
  zayoFixNeeded,
}) => {
  // View toggle: 'account' or 'line-item'
  const [sellerStatementView, setSellerStatementView] = useState<'account' | 'line-item'>('account');
  // Column filters per table: key = `${roleGroup}_${view}`, value = { columnId: filterText }
  const [columnFilters, setColumnFilters] = useState<Record<string, Record<string, string>>>({});
  // Selected values per column (Sheets-style): null = all selected, string[] = only these values
  const [columnSelectedValues, setColumnSelectedValues] = useState<Record<string, Record<string, string[] | null>>>({});
  // Which column filter popover is open: `${filterKey}__${columnId}`
  const [openFilterPopover, setOpenFilterPopover] = useState<string | null>(null);
  // Column sort per table: key = filterKey, value = { columnId, direction }
  const [columnSort, setColumnSort] = useState<Record<string, { columnId: string; direction: 'asc' | 'desc' } | null>>({});

  // Use hooks for this specific month
  const sellerStatementsForMonth = useSellerStatements(monthData.monthKey);
  const carrierStatementsForMonth = useCarrierStatements(monthData.monthKey);
  const matchesForMonth = useMatchesForProcessingMonth(monthData.monthKey);

  // Note: mergedCarriers is now passed from MonthSectionWithCarrierQuery wrapper
  // monthData.carriers already contains merged data from the wrapper
  
  // Process seller statements
  const sellerStatements: SellerStatement[] = useMemo(() => {
    let statements: SellerStatement[] = [];
    
    // Check for duplicates in Firebase data
    if (sellerStatementsForMonth && sellerStatementsForMonth.length > 0) {
      // Check for duplicate document IDs
      const docIds = sellerStatementsForMonth.map(s => s.id);
      const uniqueDocIds = new Set(docIds);
      if (docIds.length !== uniqueDocIds.size) {
        // Duplicate document IDs detected; deduplication handled below by roleGroup merge
      }
      
      // Check for duplicate roleGroups
      const roleGroups = sellerStatementsForMonth.map(s => s.roleGroup);
      const roleGroupCounts = new Map<string, number>();
      roleGroups.forEach(rg => roleGroupCounts.set(rg, (roleGroupCounts.get(rg) || 0) + 1));
      const duplicateRoleGroups = Array.from(roleGroupCounts.entries()).filter(([_, count]) => count > 1);
      if (duplicateRoleGroups.length > 0) {
        // Merged below by key to prevent double-counting
      }
      
      statements = sellerStatementsForMonth.map(stmt => ({
        roleGroup: stmt.roleGroup,
        items: stmt.items,
        totalOtgComp: stmt.totalOtgComp,
        totalSellerComp: stmt.totalSellerComp,
      }));
    } else if (carrierStatementResult && monthData.monthKey === "2026-01") {
      // Fallback to local result if Firebase data not available (only for January 2026)
      statements = carrierStatementResult.sellerStatements;
    }

    // Apply optimistic filtering if we have a pending deletion for this month
    if (optimisticSellerStatements && optimisticSellerStatements.monthKey === monthData.monthKey) {
      statements = optimisticSellerStatements.filteredStatements;
    }

    // Deduplicate statements with the same roleGroup by merging them properly
    // IMPORTANT: If duplicate documents exist, merge items by key (billingItem|accountName)
    // to avoid double-counting the same items
    const deduplicated = new Map<string, SellerStatement>();
    statements.forEach((stmt) => {
      const existing = deduplicated.get(stmt.roleGroup);
      if (existing) {
        // Create a map of existing items by key (billingItem|accountName)
        const existingItemsMap = new Map<string, any>();
        existing.items.forEach((item: any) => {
          const key = `${item.otgCompBillingItem}|${item.accountName}`;
          existingItemsMap.set(key, item);
        });
        
        // Merge new items with existing items by key
        const mergedItems: any[] = [...existing.items];
        stmt.items.forEach((newItem: any) => {
          const key = `${newItem.otgCompBillingItem}|${newItem.accountName}`;
          const existingItem = existingItemsMap.get(key);
          
          if (existingItem) {
            // Item already exists - check if values match
            const otgMatch = Math.abs((existingItem.otgComp || 0) - (newItem.otgComp || 0)) < 0.01;
            const sellerMatch = Math.abs((existingItem.sellerComp || 0) - (newItem.sellerComp || 0)) < 0.01;
            
            // Don't add duplicate item - keep existing one
          } else {
            // New item - add it
            mergedItems.push(newItem);
            existingItemsMap.set(key, newItem);
          }
        });
        
        // Recalculate totals from merged items (not by adding totals, which would double-count)
        const totalOtgComp = mergedItems.reduce((sum, item) => sum + (item.otgComp || 0), 0);
        const totalSellerComp = mergedItems.reduce((sum, item) => sum + (item.sellerComp || 0), 0);
        
        deduplicated.set(stmt.roleGroup, {
          roleGroup: stmt.roleGroup,
          items: mergedItems,
          totalOtgComp,
          totalSellerComp,
        });
      } else {
        deduplicated.set(stmt.roleGroup, stmt);
      }
    });

    return Array.from(deduplicated.values());
  }, [monthData.monthKey, sellerStatementsForMonth, carrierStatementResult, optimisticSellerStatements]);

  // Commissionable to OTG = sum of Seller Comp $ from seller statement items, grouped by carrier
  const commissionableToOtg = useMemo(() => {
    const totals: Record<string, number> = {};
    sellerStatements.forEach((stmt) => {
      (stmt.items || []).forEach((item: { carrier?: string; sellerComp?: number }) => {
        const carrier = (item.carrier || '').trim();
        if (!carrier) return;
        const amount = Number(item.sellerComp) || 0;
        totals[carrier] = (totals[carrier] ?? 0) + amount;
      });
    });
    return totals;
  }, [sellerStatements]);

  // Deposit totals = actual OTG Comp $ from each carrier statement (sum of commission amount from every line of the statement)
  const depositTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    carrierStatementsForMonth.forEach((statement: CarrierStatementDoc) => {
      if (statement.carrier) {
        totals[statement.carrier] = statement.totalCommissionAmount ?? 0;
      }
    });
    return totals;
  }, [carrierStatementsForMonth]);

  // Differences report: why Deposit Total ≠ Commissionable to OTG per carrier
  const differencesReport = useMemo(() => {
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const statementById = new Map<string, CarrierStatementDoc>();
    carrierStatementsForMonth.forEach((s: CarrierStatementDoc) => {
      statementById.set(s.id, s);
    });
    const matchedTotalByStatement: Record<string, number> = {};
    matchesForMonth.forEach((m) => {
      const sid = m.carrierStatementId;
      const amt = Number((m.matchedRow && m.matchedRow.commissionAmount) ?? 0) || 0;
      matchedTotalByStatement[sid] = (matchedTotalByStatement[sid] ?? 0) + amt;
    });
    const rows: Array<{
      carrier: string;
      depositTotal: number;
      commissionable: number;
      difference: number;
      unmatchedDollars: number;
      splitOrRoundingDollars: number;
      unmatchedLineItems: Array<{ accountName: string; otgCompBillingItem: string; commissionAmount: number; state?: string }>;
    }> = [];
    uploadedCarriers.forEach((carrier) => {
      const statementId = monthData.carriers[carrier];
      if (!statementId) return;
      const statement = statementById.get(statementId);
      const depositTotal = round2(depositTotals[carrier] ?? 0);
      const commissionable = round2(commissionableToOtg[carrier] ?? 0);
      const matchedTotal = round2(matchedTotalByStatement[statementId] ?? 0);
      const unmatchedDollars = round2(Math.max(0, depositTotal - matchedTotal));
      const splitOrRoundingDollars = round2(matchedTotal - commissionable);
      const difference = round2(depositTotal - commissionable);
      const unmatchedLineItems = (statement?.unmatchedRows ?? []).map((r: any) => ({
        accountName: r.accountName ?? '',
        otgCompBillingItem: r.otgCompBillingItem ?? '',
        commissionAmount: Number(r.commissionAmount) || 0,
        state: r.state,
      }));
      if (difference !== 0 || unmatchedDollars !== 0 || Math.abs(splitOrRoundingDollars) > 0.01 || unmatchedLineItems.length > 0) {
        rows.push({
          carrier,
          depositTotal,
          commissionable,
          difference,
          unmatchedDollars,
          splitOrRoundingDollars,
          unmatchedLineItems,
        });
      }
    });
    return rows;
  }, [carrierStatementsForMonth, matchesForMonth, monthData.carriers, depositTotals, commissionableToOtg, uploadedCarriers]);

  // Aggregate items by account for Account View
  const accountSummariesByRoleGroup = useMemo(() => {
    const summaries = new Map<string, Map<string, AccountSummary>>();
    
    sellerStatements.forEach(stmt => {
      const accountMap = new Map<string, AccountSummary>();
      
      stmt.items.forEach(item => {
        const accountKey = item.accountName || 'Unknown Account';
        const existing = accountMap.get(accountKey);
        
        if (existing) {
          existing.totalOtgComp += item.otgComp || 0;
          existing.totalSellerComp += item.sellerComp || 0;
          existing.itemCount += 1;
          // Use first non-empty state/provider/carrier if current is empty
          if (!existing.state && item.state) existing.state = item.state;
          if (!existing.provider && item.provider) existing.provider = item.provider;
          if (!existing.carrier && item.carrier) existing.carrier = item.carrier;
        } else {
          accountMap.set(accountKey, {
            accountName: accountKey,
            state: item.state || '',
            provider: item.provider || '',
            carrier: item.carrier || '',
            totalOtgComp: item.otgComp || 0,
            totalSellerComp: item.sellerComp || 0,
            itemCount: 1,
          });
        }
      });
      
      summaries.set(stmt.roleGroup, accountMap);
    });
    
    return summaries;
  }, [sellerStatements]);
  

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Month Header - Always Visible */}
      <div 
        className="p-6 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {isExpanded ? (
              <ChevronUp className="text-indigo-600" size={20} />
            ) : (
              <ChevronDown className="text-indigo-600" size={20} />
            )}
            <div>
              <h3 className="text-xl font-bold text-slate-800">{monthData.monthLabel}</h3>
              <p className="text-sm text-slate-500 mt-1">Click to {isExpanded ? 'collapse' : 'expand'} seller statements</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColor}`}>
              {statusBadge}
            </span>
          </div>
        </div>
        
        {/* Carrier Status Grid - Always Visible */}
        <div className="mt-4 pt-4 border-t border-slate-200">
          <p className="text-xs font-medium text-slate-600 mb-2">Carrier Status:</p>
          <div className="flex flex-wrap gap-2">
            {allCarriers.map((carrier) => {
              // Use monthData.carriers (already merged in wrapper component)
              const statementId = monthData.carriers[carrier];
              const statementIdStr = statementId ? String(statementId) : null;
              const isUploaded = !!statementId && !pendingDeletions.has(String(statementId));
              const isDeleting = deletingStatementId === statementId || pendingDeletions.has(String(statementId || ''));
              const showConfirm = deleteConfirmStatementId === statementIdStr;
              
              return (
                <div
                  key={carrier}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                    isUploaded
                      ? 'bg-green-100 text-green-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isUploaded ? (
                    <CheckCircle size={12} />
                  ) : (
                    <XCircle size={12} />
                  )}
                  <span>{CARRIER_LABELS[carrier]}</span>
                  {isUploaded && statementId && (
                    <>
                      {!showConfirm ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmStatementId(statementIdStr);
                          }}
                          className="ml-1 text-red-600 hover:text-red-700"
                          title="Delete carrier statement"
                          disabled={isDeleting}
                        >
                          <Trash2 size={12} />
                        </button>
                      ) : (
                        <div className="ml-1 flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteCarrier(String(statementId), carrier, monthData.monthKey, sellerStatementsForMonth);
                            }}
                            className="text-xs text-red-700 font-medium"
                            disabled={isDeleting}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmStatementId(null);
                            }}
                            className="text-xs text-slate-500"
                            disabled={isDeleting}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {isDeleting && <span className="text-xs text-slate-500 ml-1">Deleting...</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Differences report: why Deposit Total ≠ Commissionable to OTG */}
        {differencesReport.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs font-medium text-slate-600 mb-2">Differences (Deposit Total vs Commissionable to OTG):</p>
            <div className="space-y-2 text-sm">
              {differencesReport.map((row) => (
                <div key={row.carrier} className="bg-amber-50/80 border border-amber-200/80 rounded-lg px-3 py-2">
                  <p className="font-medium text-slate-800">
                    {CARRIER_LABELS[row.carrier as CarrierType] ?? row.carrier}: Deposit {formatCurrency(row.depositTotal)} vs Commissionable {formatCurrency(row.commissionable)}
                    {row.difference !== 0 && (
                      <span className="text-amber-700 ml-1">(diff {formatCurrency(row.difference)})</span>
                    )}
                  </p>
                  <ul className="mt-1 text-xs text-slate-600 list-disc list-inside space-y-0.5">
                    {row.unmatchedDollars > 0 && (
                      <li>Line items on carrier statement not in comp key: {formatCurrency(row.unmatchedDollars)}</li>
                    )}
                    {Math.abs(row.splitOrRoundingDollars) > 0.01 && (
                      <li>
                        {row.splitOrRoundingDollars > 0
                          ? `Matched total exceeds seller comp (rounding/splits): ${formatCurrency(row.splitOrRoundingDollars)}`
                          : `Seller comp exceeds matched total (rounding/splits): ${formatCurrency(-row.splitOrRoundingDollars)}`}
                      </li>
                    )}
                    {row.difference !== 0 && row.unmatchedDollars === 0 && Math.abs(row.splitOrRoundingDollars) <= 0.01 && (
                      <li>Difference from rounding across multiple line items</li>
                    )}
                  </ul>
                  {row.unmatchedLineItems.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs border border-slate-200 rounded bg-white">
                        <thead>
                          <tr className="bg-slate-100 text-slate-600">
                            <th className="px-2 py-1 text-left font-medium">State</th>
                            <th className="px-2 py-1 text-left font-medium">Account Name</th>
                            <th className="px-2 py-1 text-left font-medium">OTG Comp Billing Item</th>
                            <th className="px-2 py-1 text-right font-medium">Commission $</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.unmatchedLineItems.map((item, idx) => (
                            <tr key={idx} className="border-t border-slate-100">
                              <td className="px-2 py-1 text-slate-700">{item.state || '-'}</td>
                              <td className="px-2 py-1 text-slate-700">{item.accountName || '-'}</td>
                              <td className="px-2 py-1 font-mono text-slate-700">{item.otgCompBillingItem || '-'}</td>
                              <td className="px-2 py-1 text-right font-mono text-slate-700">{formatCurrency(item.commissionAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Commissionable to OTG - sum of Seller Comp $ per carrier from seller statements */}
        <div className="mt-4 pt-4 border-t border-slate-200">
          <p className="text-xs font-medium text-slate-600 mb-2">Commissionable to OTG:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
            {allCarriers.map((carrier) => {
              const statementId = monthData.carriers[carrier];
              const isUploaded = !!statementId && !pendingDeletions.has(String(statementId));
              const total = commissionableToOtg[carrier] ?? 0;
              const label = CARRIER_LABELS[carrier];
              if (!isUploaded) return null;
              return (
                <span key={carrier}>
                  {label}: {formatCurrency(total)}
                </span>
              );
            })}
            {uploadedCarriers.length === 0 && (
              <span className="text-slate-500">No carrier statements uploaded</span>
            )}
          </div>
        </div>

        {/* Deposit Totals - actual OTG Comp $ from each carrier statement (sum of commission amount from every line) */}
        <div className="mt-4 pt-4 border-t border-slate-200">
          <p className="text-xs font-medium text-slate-600 mb-2">Deposit Totals:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
            {allCarriers.map((carrier) => {
              const statementId = monthData.carriers[carrier];
              const isUploaded = !!statementId && !pendingDeletions.has(String(statementId));
              const total = depositTotals[carrier] ?? 0;
              const label = CARRIER_LABELS[carrier];
              if (!isUploaded) return null;
              return (
                <span key={carrier}>
                  {label}: {formatCurrency(total)}
                </span>
              );
            })}
            {uploadedCarriers.length === 0 && (
              <span className="text-slate-500">No carrier statements uploaded</span>
            )}
          </div>
        </div>
      </div>

      {/* Seller Statements - Only Visible When Expanded */}
      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-50/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
              <User size={18} />
              Seller Statements
            </h4>
            <div className="flex items-center gap-3">
              {/* View Toggle */}
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSellerStatementView('account');
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    sellerStatementView === 'account'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Account View
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSellerStatementView('line-item');
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    sellerStatementView === 'line-item'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Line Item View
                </button>
              </div>
              {zayoFixNeeded && onFixZayoProcessingMonth && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Fix Zayo processing month from "${zayoFixNeeded.currentMonth}" to "${zayoFixNeeded.correctMonth}"? This will update the Zayo statement and all its matches, then regenerate seller statements.`)) {
                      onFixZayoProcessingMonth(zayoFixNeeded.statementId, zayoFixNeeded.correctMonth);
                    }
                  }}
                  className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 flex items-center gap-2 transition-colors"
                  title={`Fix Zayo processing month: ${zayoFixNeeded.currentMonth} → ${zayoFixNeeded.correctMonth}`}
                >
                  <AlertTriangle size={14} />
                  Fix Zayo Month
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRegenerate();
                }}
                disabled={isRegenerating}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                title="Regenerate seller statements from all carrier matches"
              >
                <RefreshCw size={14} className={isRegenerating ? 'animate-spin' : ''} />
                {isRegenerating ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
          </div>
          
          {sellerStatements.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
              <p className="text-slate-500">No seller statements yet.</p>
              <p className="text-sm text-slate-400 mt-2">
                Upload carrier statements to generate commissions.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {sellerStatements.map((stmt, idx) => {
                const accountSummaries = accountSummariesByRoleGroup.get(stmt.roleGroup);
                const accounts = accountSummaries ? Array.from(accountSummaries.values()) : [];
                
                return (
                  <div key={`${stmt.roleGroup}-${idx}`} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div 
                      className="p-4 cursor-pointer hover:bg-slate-50 flex items-center justify-between"
                      onClick={() => toggleRoleGroup(stmt.roleGroup)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-sm">
                          {stmt.roleGroup.charAt(0)}
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-slate-800">{stmt.roleGroup}</h4>
                          <p className="text-xs text-slate-500">
                            {sellerStatementView === 'account' 
                              ? `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`
                              : `${stmt.items.length} billing item${stmt.items.length !== 1 ? 's' : ''}`
                            }
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-slate-400 uppercase font-medium">Seller Comp</p>
                          <p className="text-lg font-bold text-indigo-600">{formatCurrency(stmt.totalSellerComp)}</p>
                          <p className="text-xs text-slate-400 mt-0.5">OTG Comp: {formatCurrency(stmt.totalOtgComp)}</p>
                        </div>
                        {expandedRoleGroup === stmt.roleGroup ? <ChevronUp className="text-slate-400" size={18} /> : <ChevronDown className="text-slate-400" size={18} />}
                      </div>
                    </div>

                    {expandedRoleGroup === stmt.roleGroup && (
                      <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                        {(() => {
                          const showPctColumn = stmt.roleGroup === 'OTG' || stmt.roleGroup === 'OVR/RD5';
                          const formatPct = (seller: number, otg: number) =>
                            otg === 0 ? '-' : `${((seller / otg) * 100).toFixed(1)}%`;
                          const filterKey = `${stmt.roleGroup}_${sellerStatementView}`;
                          const filters = columnFilters[filterKey] || {};
                          const selectedByCol = columnSelectedValues[filterKey] || {};
                          const setFilter = (col: string, value: string) => {
                            setColumnFilters(prev => ({
                              ...prev,
                              [filterKey]: { ...(prev[filterKey] || {}), [col]: value },
                            }));
                          };
                          const setSelectedValues = (col: string, value: string[] | null) => {
                            setColumnSelectedValues(prev => ({
                              ...prev,
                              [filterKey]: { ...(prev[filterKey] || {}), [col]: value },
                            }));
                          };
                            const popoverKey = (col: string) => `${filterKey}__${col}`;
                          const sortState = columnSort[filterKey] ?? null;
                          const setSort = (columnId: string) => {
                            setColumnSort(prev => {
                              const current = prev[filterKey];
                              const nextDir = current?.columnId === columnId && current?.direction === 'asc' ? 'desc' : 'asc';
                              return { ...prev, [filterKey]: { columnId, direction: nextDir } };
                            });
                          };
                          const matchesFilters = (
                            getCellValue: (row: any, col: string) => string | number,
                            row: any,
                            columnIds: string[]
                          ) => {
                            return columnIds.every(col => {
                              const filterVal = (filters[col] || '').trim();
                              const cellVal = String(getCellValue(row, col) ?? '');
                              if (filterVal && !cellVal.toLowerCase().includes(filterVal.toLowerCase())) return false;
                              const sel = selectedByCol[col];
                              if (sel != null) {
                                if (sel.length === 0) return false;
                                if (!sel.includes(cellVal)) return false;
                              }
                              return true;
                            });
                            };
                          return sellerStatementView === 'account' ? (
                          /* Account View */
                          (() => {
                            const accountCols = [
                              { id: 'state', label: 'State', right: false },
                              { id: 'accountName', label: 'Account Name', right: false },
                              { id: 'provider', label: 'Provider', right: false },
                              { id: 'carrier', label: 'Carrier', right: false },
                              { id: 'itemCount', label: 'Line Items', right: true },
                              { id: 'totalOtgComp', label: 'OTG Comp $', right: true },
                              { id: 'totalSellerComp', label: 'Seller Comp $', right: true },
                              ...(showPctColumn ? [{ id: 'pct', label: '%', right: true }] : []),
                            ];
                            const accountNumericCols = new Set(['itemCount', 'totalOtgComp', 'totalSellerComp', 'pct']);
                            const getAccountCell = (acc: AccountSummary, col: string) =>
                              col === 'pct' ? formatPct(acc.totalSellerComp, acc.totalOtgComp) : (acc as any)[col];
                            const filteredAccounts = accounts.filter(acc =>
                              matchesFilters(getAccountCell, acc, accountCols.map(c => c.id))
                            );
                            const sortedAccounts = sortState
                              ? [...filteredAccounts].sort((a, b) => {
                                  const col = sortState.columnId;
                                  const dir = sortState.direction === 'asc' ? 1 : -1;
                                  if (col === 'pct') {
                                    const ra = a.totalOtgComp === 0 ? 0 : (a.totalSellerComp / a.totalOtgComp);
                                    const rb = b.totalOtgComp === 0 ? 0 : (b.totalSellerComp / b.totalOtgComp);
                                    return dir * (ra - rb);
                                  }
                                  const va = getAccountCell(a, col);
                                  const vb = getAccountCell(b, col);
                                  if (accountNumericCols.has(col)) {
                                    const na = Number(va);
                                    const nb = Number(vb);
                                    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
                                    if (Number.isNaN(na)) return 1;
                                    if (Number.isNaN(nb)) return -1;
                                    return dir * (na - nb);
                                  }
                                  const sa = String(va ?? '');
                                  const sb = String(vb ?? '');
                                  return dir * sa.localeCompare(sb, undefined, { numeric: true });
                                })
                              : filteredAccounts;
                            const filteredItemCount = sortedAccounts.reduce((s, a) => s + a.itemCount, 0);
                            const filteredOtg = sortedAccounts.reduce((s, a) => s + a.totalOtgComp, 0);
                            const filteredSeller = sortedAccounts.reduce((s, a) => s + a.totalSellerComp, 0);
                            const accountUniqueValues = (colId: string) =>
                              [...new Set(accounts.map(a => String(getAccountCell(a, colId) ?? '')))].sort();
                            return (
                          <table className="w-full text-sm text-left bg-white border border-slate-200 rounded-lg overflow-hidden">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                              <tr>
                                {accountCols.map(c => (
                                  <th
                                    key={c.id}
                                    className={`px-3 py-2 font-medium text-xs ${c.right ? 'text-right' : ''} cursor-pointer select-none hover:bg-slate-100`}
                                    onClick={() => setSort(c.id)}
                                  >
                                    <span className="inline-flex items-center gap-0.5">
                                      {c.label}
                                      {sortState?.columnId === c.id && (
                                        sortState.direction === 'asc' ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />
                                      )}
                                    </span>
                                  </th>
                                ))}
                              </tr>
                              <tr className="bg-slate-100/80 border-b border-slate-200">
                                {accountCols.map(c => (
                                  <th key={c.id} className="px-2 py-1">
                                    <ColumnFilterDropdown
                                      columnId={c.id}
                                      label={c.label}
                                      alignRight={c.right}
                                      uniqueValues={accountUniqueValues(c.id)}
                                      selectedValues={selectedByCol[c.id] ?? null}
                                      onSelectedValuesChange={v => setSelectedValues(c.id, v)}
                                      textFilter={filters[c.id] ?? ''}
                                      onTextFilterChange={v => setFilter(c.id, v)}
                                      isOpen={openFilterPopover === popoverKey(c.id)}
                                      onOpenChange={open => setOpenFilterPopover(open ? popoverKey(c.id) : null)}
                                    />
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {sortedAccounts.length === 0 ? (
                                <tr>
                                  <td colSpan={accountCols.length} className="px-3 py-8 text-center text-slate-500 text-xs align-top" style={{ minHeight: 200 }}>
                                    No rows match the current filters. Adjust filters or select values again in the filter dropdown.
                                  </td>
                                </tr>
                              ) : (
                                sortedAccounts.map((account, accountIdx) => (
                                  <tr key={accountIdx} className="hover:bg-slate-50">
                                    <td className="px-3 py-2 text-slate-600 text-xs">{account.state || '-'}</td>
                                    <td className="px-3 py-2 text-slate-800 text-xs font-medium">{account.accountName}</td>
                                    <td className="px-3 py-2 text-slate-600 text-xs">{account.provider || '-'}</td>
                                    <td className="px-3 py-2 text-slate-600 text-xs">{account.carrier || '-'}</td>
                                    <td className="px-3 py-2 text-right text-slate-600 text-xs">{account.itemCount}</td>
                                    <td className="px-3 py-2 text-right font-mono text-slate-600 text-xs">{formatCurrency(account.totalOtgComp)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-medium text-indigo-600 text-xs">{formatCurrency(account.totalSellerComp)}</td>
                                    {showPctColumn && (
                                      <td className="px-3 py-2 text-right text-slate-600 text-xs">{formatPct(account.totalSellerComp, account.totalOtgComp)}</td>
                                    )}
                                  </tr>
                                ))
                              )}
                              <tr className="bg-indigo-50/50 font-bold border-t border-indigo-100">
                                <td colSpan={showPctColumn ? 5 : 4} className="px-3 py-2 text-right text-indigo-900 text-xs">Totals:</td>
                                <td className="px-3 py-2 text-right text-indigo-700 text-xs">{filteredItemCount}</td>
                                <td className="px-3 py-2 text-right text-indigo-700 text-xs">{formatCurrency(filteredOtg)}</td>
                                <td className="px-3 py-2 text-right text-indigo-700 text-xs">{formatCurrency(filteredSeller)}</td>
                                {showPctColumn && (
                                  <td className="px-3 py-2 text-right text-indigo-700 text-xs">{formatPct(filteredSeller, filteredOtg)}</td>
                                )}
                              </tr>
                            </tbody>
                          </table>
                            );
                          })()
                        ) : (
                          /* Line Item View */
                          (() => {
                            const lineCols = [
                              { id: 'state', label: 'State', right: false },
                              { id: 'otgCompBillingItem', label: 'OTG Comp Billing Item', right: false },
                              { id: 'accountName', label: 'Account Name', right: false },
                              { id: 'provider', label: 'Provider', right: false },
                              { id: 'carrier', label: 'Carrier', right: false },
                              { id: 'otgComp', label: 'OTG Comp $', right: true },
                              { id: 'sellerComp', label: 'Seller Comp $', right: true },
                              ...(showPctColumn ? [{ id: 'pct', label: '%', right: true }] : []),
                            ];
                            const lineNumericCols = new Set(['otgComp', 'sellerComp', 'pct']);
                            const getItemCell = (item: any, col: string) =>
                              col === 'pct' ? formatPct(item.sellerComp ?? 0, item.otgComp ?? 0) : (item[col] ?? '');
                            const filteredItems = stmt.items.filter((item: any) =>
                              matchesFilters(getItemCell, item, lineCols.map(c => c.id))
                            );
                            const sortedItems = sortState
                              ? [...filteredItems].sort((a: any, b: any) => {
                                  const col = sortState.columnId;
                                  const dir = sortState.direction === 'asc' ? 1 : -1;
                                  if (col === 'pct') {
                                    const oa = Number(a.otgComp) || 0;
                                    const ob = Number(b.otgComp) || 0;
                                    const ra = oa === 0 ? 0 : ((Number(a.sellerComp) || 0) / oa);
                                    const rb = ob === 0 ? 0 : ((Number(b.sellerComp) || 0) / ob);
                                    return dir * (ra - rb);
                                  }
                                  const va = getItemCell(a, col);
                                  const vb = getItemCell(b, col);
                                  if (lineNumericCols.has(col)) {
                                    const na = Number(va);
                                    const nb = Number(vb);
                                    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
                                    if (Number.isNaN(na)) return 1;
                                    if (Number.isNaN(nb)) return -1;
                                    return dir * (na - nb);
                                  }
                                  const sa = String(va ?? '');
                                  const sb = String(vb ?? '');
                                  return dir * sa.localeCompare(sb, undefined, { numeric: true });
                                })
                              : filteredItems;
                            const filteredOtg = sortedItems.reduce((s: number, i: any) => s + (Number(i.otgComp) || 0), 0);
                            const filteredSeller = sortedItems.reduce((s: number, i: any) => s + (Number(i.sellerComp) || 0), 0);
                            const lineItemUniqueValues = (colId: string) =>
                              [...new Set(stmt.items.map((i: any) => String(getItemCell(i, colId) ?? '')))].sort();
                            return (
                          <table className="w-full text-sm text-left bg-white border border-slate-200 rounded-lg overflow-hidden">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                              <tr>
                                {lineCols.map(c => (
                                  <th
                                    key={c.id}
                                    className={`px-3 py-2 font-medium text-xs ${c.right ? 'text-right' : ''} cursor-pointer select-none hover:bg-slate-100`}
                                    onClick={() => setSort(c.id)}
                                  >
                                    <span className="inline-flex items-center gap-0.5">
                                      {c.label}
                                      {sortState?.columnId === c.id && (
                                        sortState.direction === 'asc' ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />
                                      )}
                                    </span>
                                  </th>
                                ))}
                              </tr>
                              <tr className="bg-slate-100/80 border-b border-slate-200">
                                {lineCols.map(c => (
                                  <th key={c.id} className="px-2 py-1">
                                    <ColumnFilterDropdown
                                      columnId={c.id}
                                      label={c.label}
                                      alignRight={c.right}
                                      uniqueValues={lineItemUniqueValues(c.id)}
                                      selectedValues={selectedByCol[c.id] ?? null}
                                      onSelectedValuesChange={v => setSelectedValues(c.id, v)}
                                      textFilter={filters[c.id] ?? ''}
                                      onTextFilterChange={v => setFilter(c.id, v)}
                                      isOpen={openFilterPopover === popoverKey(c.id)}
                                      onOpenChange={open => setOpenFilterPopover(open ? popoverKey(c.id) : null)}
                                    />
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {sortedItems.length === 0 ? (
                                <tr>
                                  <td colSpan={lineCols.length} className="px-3 py-8 text-center text-slate-500 text-xs align-top" style={{ minHeight: 200 }}>
                                    No rows match the current filters. Adjust filters or select values again in the filter dropdown.
                                  </td>
                                </tr>
                              ) : (
                                sortedItems.map((item: any, itemIdx: number) => (
                                  <tr key={itemIdx} className="hover:bg-slate-50">
                                    <td className="px-3 py-2 text-slate-600 text-xs">{item.state || '-'}</td>
                                    <td className="px-3 py-2 font-mono font-medium text-slate-800 text-xs">{item.otgCompBillingItem || '-'}</td>
                                    <td className="px-3 py-2 text-slate-800 text-xs">{item.accountName}</td>
                                    <td className="px-3 py-2 text-slate-600 text-xs">{item.provider || '-'}</td>
                                    <td className="px-3 py-2 text-slate-600 text-xs">{item.carrier || '-'}</td>
                                    <td className="px-3 py-2 text-right font-mono text-slate-600 text-xs">{formatCurrency(item.otgComp)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-medium text-indigo-600 text-xs">{formatCurrency(item.sellerComp)}</td>
                                    {showPctColumn && (
                                      <td className="px-3 py-2 text-right text-slate-600 text-xs">{formatPct(item.sellerComp ?? 0, item.otgComp ?? 0)}</td>
                                    )}
                                  </tr>
                                ))
                              )}
                              <tr className="bg-indigo-50/50 font-bold border-t border-indigo-100">
                                <td colSpan={showPctColumn ? 6 : 5} className="px-3 py-2 text-right text-indigo-900 text-xs">Totals:</td>
                                <td className="px-3 py-2 text-right text-indigo-700 text-xs">{formatCurrency(filteredOtg)}</td>
                                <td className="px-3 py-2 text-right text-indigo-700 text-xs">{formatCurrency(filteredSeller)}</td>
                                {showPctColumn && (
                                  <td className="px-3 py-2 text-right text-indigo-700 text-xs">{formatPct(filteredSeller, filteredOtg)}</td>
                                )}
                              </tr>
                            </tbody>
                          </table>
                            );
                          })()
                        );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Reports: React.FC<ReportsProps> = ({ analysisResult, carrierStatementResult, masterData }) => {
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [expandedRoleGroup, setExpandedRoleGroup] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [deletingStatementId, setDeletingStatementId] = useState<string | null>(null);
  const [deleteConfirmStatementId, setDeleteConfirmStatementId] = useState<string | null>(null);
  // Track statements that are being deleted (optimistic UI updates)
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
  // Track optimistically filtered seller statements (for pending deletions)
  const [optimisticSellerStatements, setOptimisticSellerStatements] = useState<{
    monthKey: string;
    statementId: string;
    filteredStatements: SellerStatement[];
  } | null>(null);
  
  // Firebase hooks
  const processingMonthsRaw = useProcessingMonths();
  
  // Filter out pending deletions from processing months (optimistic UI)
  const processingMonths = useMemo(() => {
    return processingMonthsRaw.map(month => ({
      ...month,
      carriers: Object.fromEntries(
        Object.entries(month.carriers).filter(([carrier, statementId]) => 
          !pendingDeletions.has(String(statementId))
        )
      ) as Record<string, string>,
    }));
  }, [processingMonthsRaw, pendingDeletions]);
  
  // Generate months: January 2026 through June 2026
  const generatedMonths = useMemo(() => {
    return [
      { monthKey: "2026-01", monthLabel: "January 2026" },
      { monthKey: "2026-02", monthLabel: "February 2026" },
      { monthKey: "2026-03", monthLabel: "March 2026" },
      { monthKey: "2026-04", monthLabel: "April 2026" },
      { monthKey: "2026-05", monthLabel: "May 2026" },
      { monthKey: "2026-06", monthLabel: "June 2026" },
    ];
  }, []);
  
  // Merge generated months with Firebase processing months
  // Use Firebase data if available, otherwise use generated structure
  const allMonths = useMemo(() => {
    const monthMap = new Map<string, {
      monthKey: string;
      monthLabel: string;
      carriers: Record<string, string>;
      status: 'complete' | 'partial' | 'empty';
      lastProcessedAt?: number;
    }>();
    
    // Add generated months first (with empty structure)
    generatedMonths.forEach(month => {
      monthMap.set(month.monthKey, {
        monthKey: month.monthKey,
        monthLabel: month.monthLabel,
        carriers: {},
        status: 'empty',
      });
    });
    
    // Merge Firebase processing months (overwrite with real data if available)
    processingMonths.forEach(month => {
      if (monthMap.has(month.monthKey)) {
        // Update existing month with Firebase data
        const existing = monthMap.get(month.monthKey)!;
        monthMap.set(month.monthKey, {
          ...existing,
          carriers: month.carriers,
          status: month.status,
          lastProcessedAt: month.lastProcessedAt,
        });
      } else {
        // Add Firebase month if outside Jan-Jun range (optional - can filter out)
        monthMap.set(month.monthKey, month);
      }
    });
    
    // Return sorted array (Jan-Jun first, then others)
    return Array.from(monthMap.values()).sort((a, b) => {
      // Jan-Jun 2026 first
      if (a.monthKey >= "2026-01" && a.monthKey <= "2026-06" &&
          b.monthKey >= "2026-01" && b.monthKey <= "2026-06") {
        return a.monthKey.localeCompare(b.monthKey);
      }
      if (a.monthKey >= "2026-01" && a.monthKey <= "2026-06") return -1;
      if (b.monthKey >= "2026-01" && b.monthKey <= "2026-06") return 1;
      return b.monthKey.localeCompare(a.monthKey);
    });
  }, [generatedMonths, processingMonths]);
  
  // Toggle month expansion
  const toggleMonthExpansion = (monthKey: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  // Clear optimistic state when month changes (no longer needed with new structure)
  // Keep for backward compatibility with deletion logic
  const deleteCarrierStatement = useDeleteCarrierStatement();
  const regenerateSellerStatements = useRegenerateSellerStatements();
  const removeItemsFromSellerStatements = useRemoveItemsFromSellerStatements();
  const fixCarrierStatementProcessingMonth = useFixCarrierStatementProcessingMonth();
  const [isRegenerating, setIsRegenerating] = useState(false);
  // Track regeneration timeout to batch multiple deletions
  const regenerationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Accumulate deleted matches for batched updates
  const pendingDeletedMatchesRef = useRef<Array<{ processingMonth: string; matches: any[] }>>([]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (regenerationTimeoutRef.current) {
        clearTimeout(regenerationTimeoutRef.current);
      }
    };
  }, []);
  
  /**
   * Manually regenerate seller statements for a specific month
   */
  const handleRegenerateSellerStatements = async (monthKey: string) => {
    const monthData = allMonths.find(m => m.monthKey === monthKey);
    const monthLabel = monthData?.monthLabel || monthKey;
    
    if (!confirm(`Regenerate seller statements for ${monthLabel}? This will re-extract carrier statement data, re-match against Comp Key, and regenerate seller statements.`)) {
      return;
    }
    
    try {
      setIsRegenerating(true);
      
      const hasMasterData = masterData && Array.isArray(masterData) && masterData.length > 0;
      if (!hasMasterData) {
        alert('Comp Key is empty. Please load Comp Key before regenerating seller statements.');
        return;
      }
      
      const result = await regenerateSellerStatements(monthKey, masterData);
      
      if (result.matchedRowsCount === 0) {
        alert('No matched rows found for this processing month. Please upload carrier statements first.');
        return;
      }
      
      alert(`Seller statements regenerated successfully!\n\nTotal matches: ${result.matchedRowsCount}\nSeller statement groups: ${result.sellerStatementGroups}`);
    } catch (error: any) {
      alert(`Failed to regenerate seller statements: ${error.message}`);
    } finally {
      setIsRegenerating(false);
    }
  };
  
  /**
   * Handle deleting a carrier statement from the Commissions tab
   * Uses optimistic UI updates - removes from UI immediately, then deletes in background
   */
  const handleDeleteCarrier = async (statementId: string, carrier: string, processingMonth: string, sellerStatementsForMonth?: SellerStatement[]) => {
    if (!confirm(`Are you sure you want to delete the ${CARRIER_LABELS[carrier as CarrierType]} statement? This will remove all matches and regenerate seller statements.`)) {
      return;
    }
    
    // Optimistic UI update: immediately remove carrier statement from display
    setPendingDeletions(prev => new Set(prev).add(statementId));
    setDeletingStatementId(statementId);
    setDeleteConfirmStatementId(null);
    
    // Mark as pending deletion globally (so Dashboard.tsx can check it)
    markAsPendingDeletion(statementId, carrier, processingMonth);
    
    // Fetch matches for this statement to optimistically filter seller statements
    let matchesToRemove: any[] = [];
    try {
      const matches = await getMatchesForCarrierStatement(statementId);
      matchesToRemove = matches.map(m => m.matchedRow);
    } catch (error: any) {
      // Continue with deletion even if we can't fetch matches
    }

    // Create a set of identifiers for items to remove from seller statements
    // Match by otgCompBillingItem + accountName (key fields)
    const itemsToRemove = new Set<string>();
    matchesToRemove.forEach(match => {
      if (match.otgCompBillingItem && match.accountName) {
        const key = `${match.otgCompBillingItem}|${match.accountName}`;
        itemsToRemove.add(key);
      }
    });

    // Optimistically filter seller statements
    if (itemsToRemove.size > 0 && sellerStatementsForMonth && sellerStatementsForMonth.length > 0) {
      const filteredStatements = sellerStatementsForMonth.map((stmt: SellerStatement) => {
        // Filter out items that match the deleted statement's matches
        const filteredItems = stmt.items.filter(item => {
          const key = `${item.otgCompBillingItem}|${item.accountName}`;
          return !itemsToRemove.has(key);
        });

        // Recalculate totals
        const totalOtgComp = filteredItems.reduce((sum, item) => sum + (item.otgComp || 0), 0);
        const totalSellerComp = filteredItems.reduce((sum, item) => sum + (item.sellerComp || 0), 0);

        return {
          roleGroup: stmt.roleGroup,
          items: filteredItems,
          totalOtgComp,
          totalSellerComp,
        };
      }).filter(stmt => stmt.items.length > 0); // Remove empty role groups

      // Set optimistic seller statements
      setOptimisticSellerStatements({
        monthKey: processingMonth,
        statementId,
        filteredStatements,
      });
    }
    
    // Continue with backend deletion in background
    (async () => {
      try {
        // Delete the statement - function handles deleting matches and returns deleted matches
        const result = await deleteCarrierStatement(statementId);
        
        // Clear this statement from pending deletions immediately (deletion succeeded)
        setPendingDeletions(prev => {
          const next = new Set(prev);
          next.delete(statementId);
          return next;
        });
        
        // Remove from global pending deletions tracker
        removePendingDeletion(statementId);
        
        // Clear optimistic seller statements for this specific deletion
        // (Firebase hooks will update with real data)
        if (optimisticSellerStatements?.statementId === statementId) {
          setOptimisticSellerStatements(null);
        }
        
        // Update seller statements directly by removing items (much faster than regenerating)
        // Accumulate deleted matches for batched update
        if (result.deletedMatches && result.deletedMatches.length > 0) {
          // Add to pending updates
          const existing = pendingDeletedMatchesRef.current.find(p => p.processingMonth === processingMonth);
          if (existing) {
            existing.matches.push(...result.deletedMatches);
          } else {
            pendingDeletedMatchesRef.current.push({
              processingMonth,
              matches: [...result.deletedMatches],
            });
          }
        }
        
        // Debounce: if multiple deletions happen quickly, batch the updates
        // Clear any existing timeout
        if (regenerationTimeoutRef.current) {
          clearTimeout(regenerationTimeoutRef.current);
        }
        
        // Set a new timeout to update seller statements after a short delay
        // This batches multiple deletions into a single update
        regenerationTimeoutRef.current = setTimeout(async () => {
          try {
            // Process all pending updates
            const updatesToProcess = [...pendingDeletedMatchesRef.current];
            pendingDeletedMatchesRef.current = [];
            
            for (const update of updatesToProcess) {
              // Add a small delay to ensure all deletions are committed
              await new Promise(resolve => setTimeout(resolve, 200));
              await removeItemsFromSellerStatements(update.processingMonth, update.matches);
            }
          } catch (error: any) {
            // Fallback to regeneration if direct update fails
            const monthsToRegenerate = [...new Set(pendingDeletedMatchesRef.current.map(p => p.processingMonth))];
            for (const month of monthsToRegenerate) {
              if (masterData && Array.isArray(masterData) && masterData.length > 0) {
                await regenerateSellerStatements(month, masterData);
              } else {
                await regenerateSellerStatements(month);
              }
            }
            pendingDeletedMatchesRef.current = [];
          }
          regenerationTimeoutRef.current = null;
        }, 500); // Wait 500ms for potential additional deletions
        
      } catch (error: any) {
        // Restore UI if deletion failed
        setPendingDeletions(prev => {
          const next = new Set(prev);
          next.delete(statementId);
          return next;
        });
        
        // Remove from global pending deletions tracker (deletion failed, restore it)
        removePendingDeletion(statementId);
        
        if (optimisticSellerStatements?.statementId === statementId) {
          setOptimisticSellerStatements(null);
        }
        
        alert(`Failed to delete statement: ${error.message}\n\nThe statement has been restored in the UI.`);
      } finally {
        setDeletingStatementId(null);
      }
    })();
  };

  const statements: CommissionStatement[] = useMemo(() => {
    if (!analysisResult) return [];
    
    // Group by salesperson
    const grouped: Record<string, CommissionStatement> = {};

    analysisResult.processedItems.forEach(item => {
      // If the item has a salesperson (either matched or manually assigned by AI), include it
      const sp = item.salesperson || 'Unassigned';
      
      if (!grouped[sp]) {
        grouped[sp] = {
          salesperson: sp,
          totalCommission: 0,
          items: []
        };
      }
      
      grouped[sp].items.push(item);
      grouped[sp].totalCommission += item.commissionAmount;
    });

    return Object.values(grouped).sort((a, b) => b.totalCommission - a.totalCommission);
  }, [analysisResult]);

  // Check if we have data from Firebase or local state
  const hasData = analysisResult || carrierStatementResult || (allMonths.length > 0);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <DollarSign size={48} className="mb-4 opacity-20" />
        <p className="text-lg">No commission data available.</p>
        <p className="text-sm">Upload and process a statement in Upload Statement first.</p>
      </div>
    );
  }


  const toggleExpand = (name: string) => {
    setExpandedPerson(expandedPerson === name ? null : name);
  };

  const toggleRoleGroup = (roleGroup: string) => {
    setExpandedRoleGroup(expandedRoleGroup === roleGroup ? null : roleGroup);
  };

  const handleExportPDF = (statement: CommissionStatement) => {
    exportCommissionStatementPDF(statement);
  };

  return (
    <div className="space-y-6">
       <div>
        <h2 className="text-2xl font-bold text-slate-800">Commissions</h2>
        <p className="text-slate-500 mt-1">Monthly commission statements per salesperson and role group.</p>
      </div>

      {/* Expandable Month Sections */}
      <div className="space-y-4">
        {allMonths.map((monthData) => (
          <MonthSectionWithCarrierQuery
            key={monthData.monthKey}
            monthData={monthData}
            isExpanded={expandedMonths.has(monthData.monthKey)}
            onToggle={() => toggleMonthExpansion(monthData.monthKey)}
            pendingDeletions={pendingDeletions}
            deletingStatementId={deletingStatementId}
            deleteConfirmStatementId={deleteConfirmStatementId}
            setDeleteConfirmStatementId={setDeleteConfirmStatementId}
            onDeleteCarrier={handleDeleteCarrier}
            onRegenerate={() => handleRegenerateSellerStatements(monthData.monthKey)}
            isRegenerating={isRegenerating}
            onFixZayoProcessingMonth={async (statementId: string, correctProcessingMonth: string) => {
              try {
                setIsRegenerating(true);
                await fixCarrierStatementProcessingMonth(statementId, correctProcessingMonth);
                await handleRegenerateSellerStatements(correctProcessingMonth);
              } catch (error: any) {
                console.error(`[Reports] Error fixing Zayo processing month:`, error);
                alert(`Error fixing Zayo processing month: ${error.message}`);
              } finally {
                setIsRegenerating(false);
              }
            }}
            carrierStatementResult={carrierStatementResult}
            optimisticSellerStatements={optimisticSellerStatements}
            expandedRoleGroup={expandedRoleGroup}
            toggleRoleGroup={toggleRoleGroup}
          />
        ))}
      </div>

      {/* Vendor Statement Commissions */}
      {statements.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
            <User size={20} />
            Vendor Statement Commissions
          </h3>
          <div className="grid grid-cols-1 gap-6">
        {statements.map((stmt) => (
          <div key={stmt.salesperson} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all">
            <div 
              className="p-6 cursor-pointer hover:bg-slate-50 flex items-center justify-between"
              onClick={() => toggleExpand(stmt.salesperson)}
            >
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold">
                  {stmt.salesperson === 'Unassigned' ? '?' : stmt.salesperson.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{stmt.salesperson}</h3>
                  <p className="text-sm text-slate-500">{stmt.items.length} transactions processed</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-xs text-slate-400 uppercase font-medium">Total Payout</p>
                  <p className="text-xl font-bold text-indigo-600">{formatCurrency(stmt.totalCommission)}</p>
                </div>
                {expandedPerson === stmt.salesperson ? <ChevronUp className="text-slate-400" /> : <ChevronDown className="text-slate-400" />}
              </div>
            </div>

            {expandedPerson === stmt.salesperson && (
              <div className="border-t border-slate-100 bg-slate-50/50 p-6 animate-fade-in">
                <div className="flex justify-end mb-4">
                   <button 
                    onClick={() => handleExportPDF(stmt)}
                    className="flex items-center gap-2 text-sm text-slate-600 hover:text-indigo-600 px-3 py-1.5 border border-slate-200 bg-white rounded shadow-sm hover:shadow transition-all"
                   >
                     <Download size={14} /> Export PDF
                   </button>
                </div>
                <table className="w-full text-sm text-left bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Client</th>
                      <th className="px-4 py-2 font-medium">Service</th>
                      <th className="px-4 py-2 font-medium text-right">Revenue</th>
                      <th className="px-4 py-2 font-medium text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stmt.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600">{item.date}</td>
                        <td className="px-4 py-2 font-medium text-slate-800">{item.clientName}</td>
                        <td className="px-4 py-2 text-slate-600 truncate max-w-xs">{item.serviceDescription}</td>
                        <td className="px-4 py-2 text-right font-mono text-slate-600">{formatCurrency(item.amountReceived)}</td>
                        <td className="px-4 py-2 text-right font-mono font-medium text-indigo-600">{formatCurrency(item.commissionAmount)}</td>
                      </tr>
                    ))}
                    <tr className="bg-indigo-50/50 font-bold border-t border-indigo-100">
                      <td colSpan={4} className="px-4 py-3 text-right text-indigo-900">Total Payout:</td>
                      <td className="px-4 py-3 text-right text-indigo-700">{formatCurrency(stmt.totalCommission)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
