import React from 'react';
import { AnalysisResult, DiscrepancyType, ProcessedItem, CarrierStatementProcessingResult, DisputeType } from '../types';
import { AlertTriangle, XCircle, DollarSign, FileWarning, TrendingUp, Calendar } from 'lucide-react';

interface DisputesProps {
  analysisResult: AnalysisResult | null;
  carrierStatementResult: CarrierStatementProcessingResult | null;
}

const Disputes: React.FC<DisputesProps> = ({ analysisResult, carrierStatementResult }) => {
  // Use carrier statement disputes if available, otherwise use vendor statement disputes
  const hasCarrierDisputes = carrierStatementResult && carrierStatementResult.disputes.length > 0;
  const hasVendorDisputes = analysisResult && (
    analysisResult.processedItems.some(i => i.discrepancyType !== DiscrepancyType.NONE) ||
    analysisResult.missingFromStatement.length > 0
  );

  if (!hasCarrierDisputes && !hasVendorDisputes) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <FileWarning size={48} className="mb-4 opacity-20" />
        <p className="text-lg">No disputes found.</p>
        <p className="text-sm">Upload and process a statement to view discrepancies.</p>
      </div>
    );
  }

  // Process vendor statement disputes
  let discrepancyItems: ProcessedItem[] = [];
  let groupedByType: Record<string, ProcessedItem[]> = {};
  let missingPayments: any[] = [];
  let totalDiscrepancies = 0;

  if (analysisResult) {
    discrepancyItems = analysisResult.processedItems.filter(
      item => item.discrepancyType !== DiscrepancyType.NONE
    );
    discrepancyItems.forEach(item => {
      const type = item.discrepancyType;
      if (!groupedByType[type]) {
        groupedByType[type] = [];
      }
      groupedByType[type].push(item);
    });
    missingPayments = analysisResult.missingFromStatement;
    totalDiscrepancies = discrepancyItems.length + missingPayments.length;
  }

  // Process carrier statement disputes
  let carrierDisputesByType: Record<string, any[]> = {};
  let totalCarrierDisputes = 0;

  if (carrierStatementResult) {
    carrierStatementResult.disputes.forEach(dispute => {
      const type = dispute.type;
      if (!carrierDisputesByType[type]) {
        carrierDisputesByType[type] = [];
      }
      carrierDisputesByType[type].push(dispute);
    });
    totalCarrierDisputes = carrierStatementResult.disputes.length;
  }

  const totalAllDisputes = totalDiscrepancies + totalCarrierDisputes;

  const getDisputeTypeLabel = (type: DisputeType): string => {
    switch (type) {
      case DisputeType.NEW_ACCOUNT: return 'New Accounts';
      case DisputeType.ZERO: return 'Zeros';
      case DisputeType.CHARGEBACK: return 'Chargebacks';
      case DisputeType.CANCELED: return 'Canceled / Missing';
      case DisputeType.CHANGED_RATE: return 'Changed Rates';
      case DisputeType.MONTHS_HELD: return 'Months Held';
      default: return type;
    }
  };

  const getDisputeIcon = (type: DisputeType) => {
    switch (type) {
      case DisputeType.NEW_ACCOUNT:
        return <FileWarning size={18} className="text-blue-600" />;
      case DisputeType.ZERO:
        return <XCircle size={18} className="text-amber-600" />;
      case DisputeType.CHARGEBACK:
        return <XCircle size={18} className="text-red-600" />;
      case DisputeType.CANCELED:
        return <AlertTriangle size={18} className="text-orange-600" />;
      case DisputeType.CHANGED_RATE:
        return <TrendingUp size={18} className="text-purple-600" />;
      case DisputeType.MONTHS_HELD:
        return <Calendar size={18} className="text-indigo-600" />;
      default:
        return <AlertTriangle size={18} className="text-gray-600" />;
    }
  };

  const getDiscrepancyIcon = (type: DiscrepancyType) => {
    switch (type) {
      case DiscrepancyType.MISSING_PAYMENT:
        return <XCircle size={18} className="text-red-600" />;
      case DiscrepancyType.AMOUNT_MISMATCH:
        return <AlertTriangle size={18} className="text-amber-600" />;
      case DiscrepancyType.UNKNOWN_SERVICE:
        return <FileWarning size={18} className="text-gray-600" />;
      case DiscrepancyType.DUPLICATE:
        return <AlertTriangle size={18} className="text-orange-600" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Disputes</h2>
        <p className="text-slate-500 mt-1">Review discrepancies and issues from statement analysis.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 font-medium mb-1">Total Disputes</p>
          <div className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <AlertTriangle size={20} className="text-amber-500" />
            {totalAllDisputes}
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 font-medium mb-1">Carrier Statement Disputes</p>
          <div className="text-2xl font-bold text-indigo-600">
            {totalCarrierDisputes}
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 font-medium mb-1">Vendor Statement Disputes</p>
          <div className="text-2xl font-bold text-amber-600">
            {totalDiscrepancies}
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 font-medium mb-1">New Accounts</p>
          <div className="text-2xl font-bold text-blue-600">
            {carrierDisputesByType[DisputeType.NEW_ACCOUNT]?.length || 0}
          </div>
        </div>
      </div>

      {/* Missing Payments Section */}
      {missingPayments.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-red-100 flex items-center gap-2">
            <XCircle className="text-red-600" size={20} />
            <h3 className="font-bold text-red-800">Missing Payments ({missingPayments.length})</h3>
            <span className="text-xs text-red-600 ml-auto">Expected but not found in statement</span>
          </div>
          <div className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="bg-red-100/50 text-red-900">
                <tr>
                  <th className="px-6 py-3 font-medium">Expected Client</th>
                  <th className="px-6 py-3 font-medium">Service</th>
                  <th className="px-6 py-3 font-medium">Salesperson</th>
                  <th className="px-6 py-3 font-medium text-right">Expected Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100">
                {missingPayments.map(item => (
                  <tr key={item.id} className="hover:bg-red-50">
                    <td className="px-6 py-3 text-slate-700 font-medium">{item.clientName}</td>
                    <td className="px-6 py-3 text-slate-600">{item.serviceType}</td>
                    <td className="px-6 py-3">{item.salesperson}</td>
                    <td className="px-6 py-3 text-right font-mono text-slate-700">${item.expectedAmount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Carrier Statement Disputes */}
      {Object.entries(carrierDisputesByType).map(([type, disputes]) => {
        const disputeType = type as DisputeType;
        return (
          <div key={`carrier-${type}`} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              {getDisputeIcon(disputeType)}
              <h3 className="font-bold text-slate-800">
                {getDisputeTypeLabel(disputeType)} ({disputes.length})
              </h3>
              <span className="text-xs text-indigo-600 ml-auto bg-indigo-100 px-2 py-1 rounded">Carrier Statement</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Account Name</th>
                    <th className="px-6 py-3 font-semibold">Billing Item</th>
                    <th className="px-6 py-3 font-semibold">Provider</th>
                    <th className="px-6 py-3 font-semibold text-right">Expected</th>
                    <th className="px-6 py-3 font-semibold text-right">Actual</th>
                    <th className="px-6 py-3 font-semibold text-right">Difference</th>
                    <th className="px-6 py-3 font-semibold w-1/3">Explanation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {disputes.map((dispute) => (
                    <tr key={dispute.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-slate-800">{dispute.accountName}</td>
                      <td className="px-6 py-3 text-slate-600">{dispute.otgCompBillingItem}</td>
                      <td className="px-6 py-3 text-slate-600">{dispute.provider || dispute.carrierStatement || '-'}</td>
                      <td className="px-6 py-3 text-right font-mono text-slate-700">
                        {dispute.expectedAmount !== undefined ? `$${dispute.expectedAmount.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-slate-700">
                        {dispute.actualAmount !== undefined ? `$${dispute.actualAmount.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-6 py-3 text-right font-mono font-bold text-red-600">
                        {dispute.difference !== undefined ? `$${dispute.difference.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-6 py-3 text-slate-500 text-xs">{dispute.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Vendor Statement Discrepancy Items by Type */}
      {Object.entries(groupedByType).map(([type, items]) => {
        // Convert string type back to DiscrepancyType enum for icon function
        // The type string matches the enum value, so we can safely cast
        const discrepancyType = type as DiscrepancyType;
        return (
          <div key={`vendor-${type}`} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              {getDiscrepancyIcon(discrepancyType)}
              <h3 className="font-bold text-slate-800">{type} ({items.length})</h3>
              <span className="text-xs text-amber-600 ml-auto bg-amber-100 px-2 py-1 rounded">Vendor Statement</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Date</th>
                    <th className="px-6 py-3 font-semibold">Client</th>
                    <th className="px-6 py-3 font-semibold">Service</th>
                    <th className="px-6 py-3 font-semibold text-right">Amount Received</th>
                    <th className="px-6 py-3 font-semibold text-right">Commission</th>
                    <th className="px-6 py-3 font-semibold">Salesperson</th>
                    <th className="px-6 py-3 font-semibold w-1/3">Explanation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3 text-slate-600 whitespace-nowrap">{item.date}</td>
                      <td className="px-6 py-3 font-medium text-slate-800">{item.clientName}</td>
                      <td className="px-6 py-3 text-slate-600">{item.serviceDescription}</td>
                      <td className="px-6 py-3 text-right font-mono text-slate-700">${item.amountReceived.toFixed(2)}</td>
                      <td className="px-6 py-3 text-right font-bold text-indigo-600">${item.commissionAmount.toFixed(2)}</td>
                      <td className="px-6 py-3 text-slate-600">{item.salesperson || 'Unassigned'}</td>
                      <td className="px-6 py-3 text-slate-500 text-xs">{item.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Disputes;
