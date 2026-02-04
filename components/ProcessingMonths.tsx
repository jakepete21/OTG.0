/**
 * ProcessingMonths Component
 * Displays all processing months with carrier status indicators
 */

import React, { useState, useMemo } from 'react';
import { useProcessingMonths, useDeleteCarrierStatement, useRegenerateSellerStatements } from '../services/firebaseHooks';
import { CarrierType } from '../services/monthDetection';
import CarrierStatusGrid from './CarrierStatusGrid';
import FilePreviewModalWrapper from './FilePreviewModalWrapper';
import { Calendar, Clock } from 'lucide-react';

interface ProcessingMonthsProps {
  onSelectMonth: (monthKey: string) => void;
  selectedMonthKey?: string;
}

const CARRIER_LABELS: Record<CarrierType, string> = {
  GoTo: 'GoTo',
  Lumen: 'Lumen',
  MetTel: 'MetTel',
  TBO: 'TBO',
  Zayo: 'Zayo',
  Allstream: 'Allstream',
};

const ProcessingMonths: React.FC<ProcessingMonthsProps> = ({
  onSelectMonth,
  selectedMonthKey,
}) => {
  const [previewFile, setPreviewFile] = useState<{ fileName: string; storageId: string } | null>(null);
  const [deletingStatementId, setDeletingStatementId] = useState<string | null>(null);
  // Track statements that are being deleted (optimistic UI updates)
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
  
  // Get processing months from Firebase (derived from carrierStatements)
  const firebaseMonthsRaw = useProcessingMonths();
  
  // Filter out pending deletions from processing months (optimistic UI)
  const firebaseMonths = useMemo(() => {
    return firebaseMonthsRaw.map(month => ({
      ...month,
      carriers: Object.fromEntries(
        Object.entries(month.carriers).filter(([carrier, statementId]) => 
          !pendingDeletions.has(String(statementId))
        )
      ) as Record<string, string>,
    }));
  }, [firebaseMonthsRaw, pendingDeletions]);
  const deleteCarrierStatement = useDeleteCarrierStatement();
  const regenerateSellerStatements = useRegenerateSellerStatements();
  
  /**
   * Handle deleting a carrier statement
   * Uses optimistic UI updates - removes from UI immediately, then deletes in background
   */
  const handleDeleteStatement = async (statementId: string, processingMonth: string) => {
    if (!confirm('Are you sure you want to delete this carrier statement? This will remove all matches and regenerate seller statements.')) {
      return;
    }
    
    // Optimistic UI update: immediately remove from display
    setPendingDeletions(prev => new Set(prev).add(statementId));
    setDeletingStatementId(statementId);
    
    // Continue with backend deletion in background
    (async () => {
      try {
        console.log(`[handleDeleteStatement] Deleting statement ${statementId} for month ${processingMonth}`);
        
        // Delete the statement - function handles deleting matches
        await deleteCarrierStatement(statementId);
        console.log(`[handleDeleteStatement] Statement deleted successfully`);
        
        // Regenerate seller statements from remaining matches
        // Note: regenerateSellerStatements will fetch masterData from Firebase if not provided
        // Add a small delay to ensure deletion is committed
        await new Promise(resolve => setTimeout(resolve, 500));
        await regenerateSellerStatements(processingMonth);
        console.log(`[handleDeleteStatement] Seller statements regenerated after deletion`);
        
        // Remove from pending deletions once backend deletion completes
        // Firebase hooks will automatically update when data changes
        setTimeout(() => {
          setPendingDeletions(prev => {
            const next = new Set(prev);
            next.delete(statementId);
            return next;
          });
        }, 1000); // Give Firebase time to sync
      } catch (error: any) {
        console.error('[handleDeleteStatement] Error:', error);
        
        // Restore UI if deletion failed
        setPendingDeletions(prev => {
          const next = new Set(prev);
          next.delete(statementId);
          return next;
        });
        
        alert(`Failed to delete statement: ${error.message}\n\nThe statement has been restored in the UI.`);
      } finally {
        setDeletingStatementId(null);
      }
    })();
  };
  
  // Processing months are already in the correct format from useProcessingMonths hook
  const processingMonths = firebaseMonths.map(month => ({
    ...month,
    lastProcessedAt: month.lastProcessedAt ? new Date(month.lastProcessedAt) : undefined,
  }));

  if (processingMonths.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <Calendar className="mx-auto text-slate-400 mb-4" size={48} />
        <h3 className="text-lg font-semibold text-slate-700 mb-2">No Processing Months</h3>
        <p className="text-slate-500 text-sm">
          Upload carrier statements to create processing months automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-slate-800">Processing Months</h2>
        <span className="text-sm text-slate-500">
          {processingMonths.length} month{processingMonths.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {processingMonths.map((monthData) => {
          const allCarriers: CarrierType[] = ['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'];
          const uploadedCarriers = allCarriers.filter(c => monthData.carriers[c]);
          const missingCarriers = allCarriers.filter(c => !monthData.carriers[c]);
          const isSelected = selectedMonthKey === monthData.monthKey;
          const isComplete = monthData.status === 'complete';
          const isPartial = monthData.status === 'partial';

          return (
            <div
              key={monthData.monthKey}
              className={`bg-white border-2 rounded-xl p-6 cursor-pointer transition-all hover:shadow-md ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 hover:border-indigo-300'
              }`}
              onClick={() => onSelectMonth(monthData.monthKey)}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Calendar className="text-indigo-600" size={24} />
                  <h3 className="text-xl font-bold text-slate-800">
                    {monthData.monthLabel}
                  </h3>
                  {isComplete && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                      Complete
                    </span>
                  )}
                  {isPartial && (
                    <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                      Partial ({uploadedCarriers.length}/6)
                    </span>
                  )}
                </div>
                {monthData.lastProcessedAt && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock size={14} />
                    <span>
                      {new Date(monthData.lastProcessedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Carrier Status Grid */}
              <CarrierStatusGrid
                monthData={monthData}
                onViewFile={(fileName: string, storageId: string) => {
                  setPreviewFile({ fileName, storageId });
                }}
                onDelete={handleDeleteStatement}
              />

              {/* Summary Stats */}
              {isPartial && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <p className="text-sm text-amber-700">
                    <strong>Missing carriers:</strong>{' '}
                    {missingCarriers.map(c => CARRIER_LABELS[c]).join(', ')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModalWrapper
          fileName={previewFile.fileName}
          storageId={previewFile.storageId}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};

export default ProcessingMonths;
