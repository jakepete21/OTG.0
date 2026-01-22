/**
 * ProcessingMonths Component
 * Displays all processing months with carrier status indicators
 */

import React from 'react';
import { ProcessingMonthData, CarrierStatement, getMissingCarriers, getUploadedCarriers } from '../services/statementStorage';
import { CarrierType } from '../services/monthDetection';
import { CheckCircle, XCircle, Calendar, Clock } from 'lucide-react';

interface ProcessingMonthsProps {
  processingMonths: ProcessingMonthData[];
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
  processingMonths,
  onSelectMonth,
  selectedMonthKey,
}) => {
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
          const uploadedCarriers = getUploadedCarriers(monthData.monthKey);
          const missingCarriers = getMissingCarriers(monthData.monthKey);
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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'] as CarrierType[]).map((carrier) => {
                  const statement = monthData.carriers[carrier];
                  const isUploaded = !!statement;

                  return (
                    <div
                      key={carrier}
                      className={`flex items-center gap-2 p-3 rounded-lg border ${
                        isUploaded
                          ? 'bg-green-50 border-green-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      {isUploaded ? (
                        <CheckCircle className="text-green-600 flex-shrink-0" size={18} />
                      ) : (
                        <XCircle className="text-slate-400 flex-shrink-0" size={18} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-700">
                          {CARRIER_LABELS[carrier]}
                        </div>
                        {isUploaded && statement && (
                          <div className="text-xs text-slate-500">
                            {new Date(statement.uploadedAt).toLocaleDateString()}
                          </div>
                        )}
                        {!isUploaded && (
                          <div className="text-xs text-slate-400">Missing</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

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
    </div>
  );
};

export default ProcessingMonths;
