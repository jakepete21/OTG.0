import React, { useMemo, useState, useEffect, useRef } from 'react';
import { AnalysisResult, CommissionStatement, CarrierStatementProcessingResult, SellerStatement } from '../types';
import { Download, ChevronDown, ChevronUp, User, DollarSign, AlertTriangle, Calendar, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react';
import { exportCommissionStatementPDF } from '../services/pdfExport';
import { useProcessingMonths, useSellerStatements, useCarrierStatements, useDeleteCarrierStatement, useRegenerateSellerStatements, useRemoveItemsFromSellerStatements } from '../services/firebaseHooks';
import { CarrierType } from '../services/monthDetection';
import { getMatchesForCarrierStatement } from '../services/firebaseQueries';

interface ReportsProps {
  analysisResult: AnalysisResult | null;
  carrierStatementResult: CarrierStatementProcessingResult | null;
}

const CARRIER_LABELS: Record<CarrierType, string> = {
  GoTo: 'GoTo',
  Lumen: 'Lumen',
  MetTel: 'MetTel',
  TBO: 'TBO',
  Zayo: 'Zayo',
  Allstream: 'Allstream',
};

const Reports: React.FC<ReportsProps> = ({ analysisResult, carrierStatementResult }) => {
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [expandedRoleGroup, setExpandedRoleGroup] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [deletingStatementId, setDeletingStatementId] = useState<string | null>(null);
  const [deleteConfirmCarrier, setDeleteConfirmCarrier] = useState<string | null>(null);
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
  
  const selectedMonth = useMemo(() => {
    // If a month is explicitly selected, use it
    if (selectedMonthKey) {
      return selectedMonthKey;
    }
    // Otherwise, auto-select the first available month
    if (processingMonths.length > 0) {
      return processingMonths[0].monthKey;
    }
    // No months available yet
    return null;
  }, [selectedMonthKey, processingMonths]);

  // Clear optimistic state when month changes
  useEffect(() => {
    if (optimisticSellerStatements && optimisticSellerStatements.monthKey !== selectedMonth) {
      setOptimisticSellerStatements(null);
    }
  }, [selectedMonth, optimisticSellerStatements]);
  
  const sellerStatementsForMonth = useSellerStatements(selectedMonth);
  const carrierStatementsForMonth = useCarrierStatements(selectedMonth);
  const deleteCarrierStatement = useDeleteCarrierStatement();
  const regenerateSellerStatements = useRegenerateSellerStatements();
  const removeItemsFromSellerStatements = useRemoveItemsFromSellerStatements();
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
   * Manually regenerate seller statements for the selected month
   */
  const handleRegenerateSellerStatements = async () => {
    if (!selectedMonth) {
      alert('Please select a processing month first');
      return;
    }
    
    if (!confirm(`Regenerate seller statements for ${selectedMonth}? This will process all matches from all carriers and regenerate seller statements.`)) {
      return;
    }
    
    try {
      setIsRegenerating(true);
      console.log(`[Reports] Manual regeneration triggered for month: ${selectedMonth}`);
      
      const result = await regenerateSellerStatements(selectedMonth);
      
      console.log(`[Reports] Regeneration complete`);
      console.log(`[Reports] Total matches processed: ${result.matchedRowsCount}`);
      
      if (result.matchedRowsCount === 0) {
        alert('No matched rows found for this processing month. Please upload carrier statements first.');
        return;
      }
      
      alert(`Seller statements regenerated successfully!\n\nTotal matches: ${result.matchedRowsCount}\nSeller statement groups: ${result.sellerStatementGroups}`);
    } catch (error: any) {
      console.error('[Reports] Error regenerating seller statements:', error);
      alert(`Failed to regenerate seller statements: ${error.message}`);
    } finally {
      setIsRegenerating(false);
    }
  };
  
  /**
   * Handle deleting a carrier statement from the Commissions tab
   * Uses optimistic UI updates - removes from UI immediately, then deletes in background
   */
  const handleDeleteCarrier = async (statementId: string, carrier: string, processingMonth: string) => {
    if (!confirm(`Are you sure you want to delete the ${CARRIER_LABELS[carrier as CarrierType]} statement? This will remove all matches and regenerate seller statements.`)) {
      return;
    }
    
    // Optimistic UI update: immediately remove carrier statement from display
    setPendingDeletions(prev => new Set(prev).add(statementId));
    setDeletingStatementId(statementId);
    setDeleteConfirmCarrier(null);
    
    // Fetch matches for this statement to optimistically filter seller statements
    let matchesToRemove: any[] = [];
    try {
      const matches = await getMatchesForCarrierStatement(statementId);
      matchesToRemove = matches.map(m => m.matchedRow);
      console.log(`[Reports] Found ${matchesToRemove.length} matches to remove optimistically`);
    } catch (error: any) {
      console.warn('[Reports] Could not fetch matches for optimistic update:', error);
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
      const filteredStatements = sellerStatementsForMonth.map(stmt => {
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
        console.log(`[Reports] Deleting carrier ${carrier} statement ${statementId} for month ${processingMonth}`);
        
        // Delete the statement - function handles deleting matches and returns deleted matches
        const result = await deleteCarrierStatement(statementId);
        console.log(`[Reports] Statement deleted successfully, ${result.deletedMatchesCount} matches removed`);
        
        // Clear this statement from pending deletions immediately (deletion succeeded)
        setPendingDeletions(prev => {
          const next = new Set(prev);
          next.delete(statementId);
          return next;
        });
        
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
              console.log(`[Reports] Updating seller statements for ${update.processingMonth} (removing ${update.matches.length} items directly)`);
              // Add a small delay to ensure all deletions are committed
              await new Promise(resolve => setTimeout(resolve, 200));
              await removeItemsFromSellerStatements(update.processingMonth, update.matches);
              console.log(`[Reports] Seller statements updated (items removed directly)`);
            }
          } catch (error: any) {
            console.error('[Reports] Error updating seller statements:', error);
            // Fallback to regeneration if direct update fails
            console.log('[Reports] Falling back to full regeneration...');
            const monthsToRegenerate = [...new Set(pendingDeletedMatchesRef.current.map(p => p.processingMonth))];
            for (const month of monthsToRegenerate) {
              await regenerateSellerStatements(month);
            }
            pendingDeletedMatchesRef.current = [];
          }
          regenerationTimeoutRef.current = null;
        }, 500); // Wait 500ms for potential additional deletions
        
      } catch (error: any) {
        console.error('[Reports] Error deleting statement:', error);
        
        // Restore UI if deletion failed
        setPendingDeletions(prev => {
          const next = new Set(prev);
          next.delete(statementId);
          return next;
        });
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

  // Get seller statements from Firebase or fallback to local result
  // Apply optimistic filtering for pending deletions
  // Deduplicate statements with the same roleGroup (merge items and totals)
  const sellerStatements: SellerStatement[] = useMemo(() => {
    let statements: SellerStatement[] = [];
    
    if (sellerStatementsForMonth && sellerStatementsForMonth.length > 0) {
      statements = sellerStatementsForMonth.map(stmt => ({
        roleGroup: stmt.roleGroup,
        items: stmt.items,
        totalOtgComp: stmt.totalOtgComp,
        totalSellerComp: stmt.totalSellerComp,
      }));
    } else if (carrierStatementResult) {
      // Fallback to local result if Firebase data not available
      statements = carrierStatementResult.sellerStatements;
    }

    // Apply optimistic filtering if we have a pending deletion for this month
    if (optimisticSellerStatements && optimisticSellerStatements.monthKey === selectedMonth) {
      statements = optimisticSellerStatements.filteredStatements;
    }

    // Deduplicate statements with the same roleGroup by merging them
    const deduplicated = new Map<string, SellerStatement>();
    statements.forEach(stmt => {
      const existing = deduplicated.get(stmt.roleGroup);
      if (existing) {
        // Merge: combine items and recalculate totals
        const mergedItems = [...existing.items, ...stmt.items];
        deduplicated.set(stmt.roleGroup, {
          roleGroup: stmt.roleGroup,
          items: mergedItems,
          totalOtgComp: existing.totalOtgComp + stmt.totalOtgComp,
          totalSellerComp: existing.totalSellerComp + stmt.totalSellerComp,
        });
      } else {
        deduplicated.set(stmt.roleGroup, stmt);
      }
    });

    return Array.from(deduplicated.values());
  }, [selectedMonth, sellerStatementsForMonth, carrierStatementResult, optimisticSellerStatements]);

  // Get current month data
  const currentMonthData = useMemo(() => {
    if (!selectedMonth) return null;
    return processingMonths.find(m => m.monthKey === selectedMonth);
  }, [selectedMonth, processingMonths]);

  // Get missing carriers for selected month
  const missingCarriersInfo = useMemo(() => {
    if (!currentMonthData) return null;
    
    const allCarriers: CarrierType[] = ['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'];
    const uploadedCarriers = Object.keys(currentMonthData.carriers).filter(Boolean) as CarrierType[];
    const missing = allCarriers.filter(c => !uploadedCarriers.includes(c));
    
    if (missing.length === 0) return null;
    
    return {
      monthLabel: currentMonthData.monthLabel,
      missingCarriers: missing,
      uploadedCarriers,
    };
  }, [currentMonthData]);

  const hasPartialProcessing = currentMonthData?.status === 'partial';

  // Check if we have data from Firebase or local state
  const hasData = analysisResult || carrierStatementResult || (sellerStatements.length > 0) || (processingMonths.length > 0);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <DollarSign size={48} className="mb-4 opacity-20" />
        <p className="text-lg">No commission data available.</p>
        <p className="text-sm">Upload and process a statement in Upload Statement first.</p>
      </div>
    );
  }

  // If no month is selected but we have months, show message
  if (processingMonths.length > 0 && !selectedMonth) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <Calendar size={48} className="mb-4 opacity-20" />
        <p className="text-lg">Select a processing month to view commissions.</p>
        <p className="text-sm">Use the month selector above to choose a month.</p>
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

      {/* Month Selector */}
      {processingMonths.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <Calendar className="text-indigo-600" size={20} />
            <label className="text-sm font-medium text-slate-700">Processing Month:</label>
          </div>
          <div className="flex flex-wrap gap-2">
            {processingMonths.map((month) => (
              <button
                key={month.monthKey}
                onClick={() => setSelectedMonthKey(month.monthKey)}
                className={`px-4 py-2 rounded-lg border transition-all ${
                  selectedMonth === month.monthKey
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'
                }`}
              >
                {month.monthLabel}
                {month.status === 'complete' && (
                  <CheckCircle className="inline ml-2" size={14} />
                )}
                {month.status === 'partial' && (
                  <span className="ml-2 text-xs opacity-75">({Object.keys(month.carriers).length}/6)</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Month Header */}
      {currentMonthData && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-indigo-900 mb-2">
                {currentMonthData.monthLabel}
              </h3>
              <p className="text-sm text-indigo-700">
                Commission statements for this processing month
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRegenerateSellerStatements}
                disabled={isRegenerating}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                title="Regenerate seller statements from all carrier matches"
              >
                <RefreshCw size={16} className={isRegenerating ? 'animate-spin' : ''} />
                {isRegenerating ? 'Generating...' : 'Regenerate'}
              </button>
              {currentMonthData.status === 'complete' && (
                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full flex items-center gap-1">
                  <CheckCircle size={14} />
                  Complete
                </span>
              )}
              {currentMonthData.status === 'partial' && (
                <span className="px-3 py-1 bg-amber-100 text-amber-700 text-sm font-medium rounded-full">
                  Partial ({Object.keys(currentMonthData.carriers).length}/6 carriers)
                </span>
              )}
            </div>
          </div>
          
          {/* Carrier Status */}
          <div className="mt-4 pt-4 border-t border-indigo-200">
            <p className="text-xs font-medium text-indigo-600 mb-2">Carrier Status:</p>
            <div className="flex flex-wrap gap-2">
              {(['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'] as CarrierType[]).map((carrier) => {
                const statementId = currentMonthData.carriers[carrier];
                const isUploaded = !!statementId && !pendingDeletions.has(String(statementId));
                const isDeleting = deletingStatementId === statementId || pendingDeletions.has(String(statementId || ''));
                const showConfirm = deleteConfirmCarrier === carrier;
                
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
                    {isUploaded && statementId && selectedMonth && (
                      <>
                        {!showConfirm ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmCarrier(carrier);
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
                                handleDeleteCarrier(String(statementId), carrier, selectedMonth);
                              }}
                              className="text-xs text-red-700 font-medium"
                              disabled={isDeleting}
                            >
                              Confirm
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmCarrier(null);
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
        </div>
      )}

      {/* Partial Processing Warning */}
      {hasPartialProcessing && missingCarriersInfo && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              Partial Processing Detected
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Seller statements for <strong>{missingCarriersInfo.monthLabel}</strong> are based on partial data.
              Missing carriers: {missingCarriersInfo.missingCarriers.map(c => CARRIER_LABELS[c]).join(', ')}.
              Totals shown are only for uploaded carriers ({missingCarriersInfo.uploadedCarriers.map(c => CARRIER_LABELS[c]).join(', ')}).
            </p>
          </div>
        </div>
      )}

      {/* Seller Statements (Carrier Statement Processing) */}
      {selectedMonth && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
            <User size={20} />
            Seller Statements
            {currentMonthData && (
              <span className="text-sm font-normal text-slate-500">
                ({currentMonthData.monthLabel})
              </span>
            )}
            {hasPartialProcessing && (
              <span className="ml-2 px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                Partial
              </span>
            )}
          </h3>
          {sellerStatements.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
              <p className="text-slate-500">No seller statements found for this month.</p>
              <p className="text-sm text-slate-400 mt-2">
                {currentMonthData?.status === 'partial' 
                  ? 'Upload more carrier statements to generate seller statements.'
                  : 'Process carrier statements to generate seller statements.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {sellerStatements.map((stmt, idx) => (
                <div key={`${stmt.roleGroup}-${idx}`} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all">
                  <div 
                    className="p-6 cursor-pointer hover:bg-slate-50 flex items-center justify-between"
                    onClick={() => toggleRoleGroup(stmt.roleGroup)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold">
                        {stmt.roleGroup.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">{stmt.roleGroup}</h3>
                        <p className="text-sm text-slate-500">{stmt.items.length} billing items</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-slate-400 uppercase font-medium">Seller Comp</p>
                        <p className="text-xl font-bold text-indigo-600">${stmt.totalSellerComp.toFixed(2)}</p>
                        <p className="text-xs text-slate-400 mt-1">OTG Comp: ${stmt.totalOtgComp.toFixed(2)}</p>
                      </div>
                      {expandedRoleGroup === stmt.roleGroup ? <ChevronUp className="text-slate-400" /> : <ChevronDown className="text-slate-400" />}
                    </div>
                  </div>

                  {expandedRoleGroup === stmt.roleGroup && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-6 animate-fade-in">
                      <table className="w-full text-sm text-left bg-white border border-slate-200 rounded-lg overflow-hidden">
                        <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-2 font-medium">State</th>
                            <th className="px-4 py-2 font-medium">OTG Comp Billing Item</th>
                            <th className="px-4 py-2 font-medium">Account Name</th>
                            <th className="px-4 py-2 font-medium">Provider</th>
                            <th className="px-4 py-2 font-medium text-right">OTG Comp $</th>
                            <th className="px-4 py-2 font-medium text-right">Seller Comp $</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stmt.items.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="px-4 py-2 text-slate-600">{item.state || '-'}</td>
                              <td className="px-4 py-2 font-mono font-medium text-slate-800">{item.otgCompBillingItem || '-'}</td>
                              <td className="px-4 py-2 text-slate-800">{item.accountName}</td>
                              <td className="px-4 py-2 text-slate-600">{item.provider || '-'}</td>
                              <td className="px-4 py-2 text-right font-mono text-slate-600">${item.otgComp.toFixed(2)}</td>
                              <td className="px-4 py-2 text-right font-mono font-medium text-indigo-600">${item.sellerComp.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr className="bg-indigo-50/50 font-bold border-t border-indigo-100">
                            <td colSpan={4} className="px-4 py-3 text-right text-indigo-900">Totals:</td>
                            <td className="px-4 py-3 text-right text-indigo-700">${stmt.totalOtgComp.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-indigo-700">${stmt.totalSellerComp.toFixed(2)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                  <p className="text-xl font-bold text-indigo-600">${stmt.totalCommission.toFixed(2)}</p>
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
                        <td className="px-4 py-2 text-right font-mono text-slate-600">${item.amountReceived.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-mono font-medium text-indigo-600">${item.commissionAmount.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-indigo-50/50 font-bold border-t border-indigo-100">
                      <td colSpan={4} className="px-4 py-3 text-right text-indigo-900">Total Payout:</td>
                      <td className="px-4 py-3 text-right text-indigo-700">${stmt.totalCommission.toFixed(2)}</td>
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
