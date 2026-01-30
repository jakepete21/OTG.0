import React, { useState } from 'react';
import { useCarrierStatementById } from '../services/firebaseHooks';
import { CarrierType } from '../services/monthDetection';
import { CheckCircle, XCircle, Eye, Trash2 } from 'lucide-react';

const CARRIER_LABELS: Record<CarrierType, string> = {
  GoTo: 'GoTo',
  Lumen: 'Lumen',
  MetTel: 'MetTel',
  TBO: 'TBO',
  Zayo: 'Zayo',
  Allstream: 'Allstream',
};

interface CarrierStatusGridProps {
  monthData: {
    monthKey: string;
    carriers: Record<string, any>;
  };
  onViewFile: (fileName: string, storageId: string) => void;
  onDelete?: (statementId: string, processingMonth: string) => void;
}

const CarrierStatusGrid: React.FC<CarrierStatusGridProps> = ({ monthData, onViewFile, onDelete }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {(['GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream'] as CarrierType[]).map((carrier) => {
        const statementId = monthData.carriers[carrier];
        const isUploaded = !!statementId;
        // Convert Firebase ID to string if needed
        const statementIdStr = statementId ? String(statementId) : undefined;
        
        return (
          <CarrierStatusItem
            key={carrier}
            carrier={carrier}
            statementId={statementIdStr}
            isUploaded={isUploaded}
            processingMonth={monthData.monthKey}
            onViewFile={onViewFile}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
};

interface CarrierStatusItemProps {
  carrier: CarrierType;
  statementId: string | undefined;
  isUploaded: boolean;
  processingMonth: string;
  onViewFile: (fileName: string, storageId: string) => void;
  onDelete?: (statementId: string, processingMonth: string) => void;
}

const CarrierStatusItem: React.FC<CarrierStatusItemProps> = ({
  carrier,
  statementId,
  isUploaded,
  processingMonth,
  onViewFile,
  onDelete,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const statement = useCarrierStatementById(statementId || null);
  
  // Debug logging
  React.useEffect(() => {
    if (isUploaded) {
      console.log(`[CarrierStatusItem] ${carrier}:`, {
        statementId,
        hasOnDelete: !!onDelete,
        hasStatement: !!statement,
        showDeleteButton: !!(onDelete && statementId),
        statementIdType: typeof statementId,
        statementIdLength: statementId?.length
      });
    }
  }, [carrier, statementId, isUploaded, onDelete, statement]);

  return (
    <div
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
        {isUploaded && (
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <div className="text-xs text-slate-500">
              Uploaded
            </div>
            {statement?.fileUrl && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewFile(statement.filename, statement.fileUrl);
                }}
                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                title="View file"
              >
                <Eye size={12} />
                View
              </button>
            )}
            {onDelete && statementId && (
              <>
                {!showDeleteConfirm ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(true);
                    }}
                    className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                    title="Delete file"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onDelete && statementId) {
                          onDelete(statementId, processingMonth);
                        }
                        setShowDeleteConfirm(false);
                      }}
                      className="text-xs text-red-700 font-medium px-1"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(false);
                      }}
                      className="text-xs text-slate-500 px-1"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {!isUploaded && (
          <div className="text-xs text-slate-400">Missing</div>
        )}
      </div>
    </div>
  );
};

export default CarrierStatusGrid;
