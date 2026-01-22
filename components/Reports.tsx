import React, { useMemo, useState } from 'react';
import { AnalysisResult, CommissionStatement, CarrierStatementProcessingResult, SellerStatement } from '../types';
import { Download, ChevronDown, ChevronUp, User, DollarSign, AlertTriangle } from 'lucide-react';
import { exportCommissionStatementPDF } from '../services/pdfExport';
import { getAllProcessingMonths, getMissingCarriers, getCombinedMatchedRows } from '../services/statementStorage';
import { generateSellerStatements } from '../services/sellerStatements';

interface ReportsProps {
  analysisResult: AnalysisResult | null;
  carrierStatementResult: CarrierStatementProcessingResult | null;
}

const Reports: React.FC<ReportsProps> = ({ analysisResult, carrierStatementResult }) => {
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [expandedRoleGroup, setExpandedRoleGroup] = useState<string | null>(null);

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

  const sellerStatements: SellerStatement[] = useMemo(() => {
    if (!carrierStatementResult) return [];
    return carrierStatementResult.sellerStatements;
  }, [carrierStatementResult]);

  // Check for partial processing
  const processingMonths = useMemo(() => getAllProcessingMonths(), []);
  const hasPartialProcessing = useMemo(() => {
    return processingMonths.some(month => month.status === 'partial');
  }, [processingMonths]);

  // Get missing carriers for most recent partial month
  const missingCarriersInfo = useMemo(() => {
    const partialMonths = processingMonths.filter(m => m.status === 'partial');
    if (partialMonths.length === 0) return null;
    
    // Get most recent partial month
    const latestPartial = partialMonths[partialMonths.length - 1];
    const missing = getMissingCarriers(latestPartial.monthKey);
    
    return {
      monthLabel: latestPartial.monthLabel,
      missingCarriers: missing,
    };
  }, [processingMonths]);

  const hasData = analysisResult || carrierStatementResult;

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
              Missing carriers: {missingCarriersInfo.missingCarriers.join(', ')}.
              Totals shown are only for uploaded carriers.
            </p>
          </div>
        </div>
      )}

      {/* Seller Statements (Carrier Statement Processing) */}
      {sellerStatements.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
            <User size={20} />
            Seller Statements (Carrier Statement Processing)
            {hasPartialProcessing && (
              <span className="ml-2 px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                Partial
              </span>
            )}
          </h3>
          <div className="grid grid-cols-1 gap-6">
            {sellerStatements.map((stmt) => (
              <div key={stmt.roleGroup} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all">
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
