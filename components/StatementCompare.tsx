import React, { useState, useMemo } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, XCircle, Download } from 'lucide-react';
import { useSellerStatements, useProcessingMonths } from '../services/firebaseHooks';
import { parseCsvToSellerStatements, compareStatements, StatementComparison } from '../services/statementComparisonService';
import { formatCurrency } from '../services/numberFormat';
import * as XLSX from 'xlsx';

interface StatementCompareProps {
  // No props needed - component is self-contained
}

const StatementCompare: React.FC<StatementCompareProps> = () => {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [csvStatements, setCsvStatements] = useState<any[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [comparison, setComparison] = useState<StatementComparison | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const processingMonths = useProcessingMonths();
  const firebaseStatementsDocs = useSellerStatements(selectedMonth);
  
  // Convert Firebase docs to SellerStatement format
  const firebaseStatements = useMemo(() => {
    return firebaseStatementsDocs.map(doc => ({
      roleGroup: doc.roleGroup,
      items: doc.items || [],
      totalOtgComp: doc.totalOtgComp || 0,
      totalSellerComp: doc.totalSellerComp || 0,
    }));
  }, [firebaseStatementsDocs]);
  
  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setUploadedFile(file);
    
    try {
      const parsed = await parseCsvToSellerStatements(file);
      setCsvStatements(parsed);
    } catch (err: any) {
      setError(`Failed to parse file: ${err.message}`);
      setIsProcessing(false);
    }
  };
  
  const handleCompare = () => {
    if (!selectedMonth) {
      setError('Please select a processing month');
      return;
    }
    
    if (csvStatements.length === 0) {
      setError('Please upload a CSV file first');
      return;
    }
    
    try {
      const result = compareStatements(csvStatements, firebaseStatements, selectedMonth);
      setComparison(result);
      setError(null);
    } catch (err: any) {
      setError(`Comparison failed: ${err.message}`);
    }
  };
  
  const handleExportComparison = () => {
    if (!comparison) return;
    
    const workbook = XLSX.utils.book_new();
    
    comparison.roleGroups.forEach(group => {
      const rows: any[][] = [
        ['Role Group', group.roleGroup],
        ['CSV Total OTG Comp', group.csvTotalOtgComp],
        ['CSV Total Seller Comp', group.csvTotalSellerComp],
        ['Firebase Total OTG Comp', group.firebaseTotalOtgComp],
        ['Firebase Total Seller Comp', group.firebaseTotalSellerComp],
        ['OTG Comp Difference', group.otgCompDiff],
        ['Seller Comp Difference', group.sellerCompDiff],
        [],
        ['Account Name', 'OTG Comp Billing Item', 'CSV OTG Comp', 'CSV Seller Comp', 'Firebase OTG Comp', 'Firebase Seller Comp', 'OTG Comp Diff', 'Seller Comp Diff', 'Status'],
      ];
      
      group.items.forEach(item => {
        rows.push([
          item.accountName,
          item.otgCompBillingItem,
          item.csvOtgComp,
          item.csvSellerComp,
          item.firebaseOtgComp,
          item.firebaseSellerComp,
          item.otgCompDiff,
          item.sellerCompDiff,
          item.status,
        ]);
      });
      
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, group.roleGroup);
    });
    
    // Summary sheet
    const summaryRows: any[][] = [
      ['Processing Month', comparison.processingMonth],
      [],
      ['Overall CSV Total OTG Comp', comparison.overallCsvTotalOtgComp],
      ['Overall CSV Total Seller Comp', comparison.overallCsvTotalSellerComp],
      ['Overall Firebase Total OTG Comp', comparison.overallFirebaseTotalOtgComp],
      ['Overall Firebase Total Seller Comp', comparison.overallFirebaseTotalSellerComp],
      ['Overall OTG Comp Difference', comparison.overallOtgCompDiff],
      ['Overall Seller Comp Difference', comparison.overallSellerCompDiff],
    ];
    
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    
    XLSX.writeFile(workbook, `statement-comparison-${comparison.processingMonth}.xlsx`);
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Statement Compare</h2>
        <p className="text-slate-500 mt-1">Compare uploaded CSV/XLSX seller statements with Firebase seller statements</p>
      </div>
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <AlertCircle className="text-red-600" size={20} />
          <span className="text-red-800">{error}</span>
        </div>
      )}
      
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Upload CSV/XLSX File
          </label>
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleFileUpload(file);
                  setIsProcessing(false);
                }
              }}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer flex flex-col items-center gap-2"
            >
              <Upload className="text-slate-400" size={32} />
              <span className="text-sm text-slate-600">
                {uploadedFile ? uploadedFile.name : 'Click to upload CSV/XLSX file'}
              </span>
            </label>
          </div>
          {csvStatements.length > 0 && (
            <p className="text-sm text-green-600 mt-2">
              ✓ Parsed {csvStatements.length} role group(s) from CSV
            </p>
          )}
        </div>
        
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Select Processing Month
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select a month...</option>
            {processingMonths.map(month => (
              <option key={month.monthKey} value={month.monthKey}>
                {month.monthLabel}
              </option>
            ))}
          </select>
        </div>
        
        <button
          onClick={handleCompare}
          disabled={!selectedMonth || csvStatements.length === 0 || isProcessing}
          className="w-full px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <FileText size={18} />
          {isProcessing ? 'Processing...' : 'Compare Statements'}
        </button>
      </div>
      
      {comparison && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Comparison Summary</h3>
              <button
                onClick={handleExportComparison}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 flex items-center gap-2"
              >
                <Download size={16} />
                Export Comparison
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="text-sm text-slate-600">CSV Total OTG Comp</div>
                <div className="text-xl font-bold text-slate-800">{formatCurrency(comparison.overallCsvTotalOtgComp)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="text-sm text-slate-600">Firebase Total OTG Comp</div>
                <div className="text-xl font-bold text-slate-800">{formatCurrency(comparison.overallFirebaseTotalOtgComp)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="text-sm text-slate-600">CSV Total Seller Comp</div>
                <div className="text-xl font-bold text-slate-800">{formatCurrency(comparison.overallCsvTotalSellerComp)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="text-sm text-slate-600">Firebase Total Seller Comp</div>
                <div className="text-xl font-bold text-slate-800">{formatCurrency(comparison.overallFirebaseTotalSellerComp)}</div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className={`rounded-lg p-4 ${comparison.overallOtgCompDiff === 0 ? 'bg-green-50' : 'bg-amber-50'}`}>
                <div className="text-sm text-slate-600">OTG Comp Difference</div>
                <div className={`text-xl font-bold ${comparison.overallOtgCompDiff === 0 ? 'text-green-700' : 'text-amber-700'}`}>
                  {formatCurrency(comparison.overallOtgCompDiff)}
                </div>
              </div>
              <div className={`rounded-lg p-4 ${comparison.overallSellerCompDiff === 0 ? 'bg-green-50' : 'bg-amber-50'}`}>
                <div className="text-sm text-slate-600">Seller Comp Difference</div>
                <div className={`text-xl font-bold ${comparison.overallSellerCompDiff === 0 ? 'text-green-700' : 'text-amber-700'}`}>
                  {formatCurrency(comparison.overallSellerCompDiff)}
                </div>
              </div>
            </div>
          </div>
          
          {comparison.roleGroups.map(group => (
            <div key={group.roleGroup} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200">
                <h4 className="font-bold text-slate-800">{group.roleGroup}</h4>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-green-600">✓ Matches: {group.matchCount}</span>
                  <span className="text-blue-600">CSV Only: {group.csvOnlyCount}</span>
                  <span className="text-purple-600">Firebase Only: {group.firebaseOnlyCount}</span>
                  <span className="text-amber-600">Differences: {group.differenceCount}</span>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-slate-700">Account Name</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-slate-700">Billing Item</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-slate-700">CSV OTG Comp</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-slate-700">CSV Seller Comp</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-slate-700">Firebase OTG Comp</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-slate-700">Firebase Seller Comp</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-slate-700">OTG Diff</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-slate-700">Seller Diff</th>
                      <th className="px-4 py-2 text-center text-sm font-medium text-slate-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {group.items.map((item, idx) => (
                      <tr key={idx} className={item.status === 'match' ? 'bg-green-50' : item.status === 'difference' ? 'bg-amber-50' : ''}>
                        <td className="px-4 py-2 text-sm text-slate-800">{item.accountName}</td>
                        <td className="px-4 py-2 text-sm text-slate-600">{item.otgCompBillingItem}</td>
                        <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(item.csvOtgComp)}</td>
                        <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(item.csvSellerComp)}</td>
                        <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(item.firebaseOtgComp)}</td>
                        <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(item.firebaseSellerComp)}</td>
                        <td className={`px-4 py-2 text-sm text-right font-medium ${item.otgCompDiff === 0 ? 'text-green-600' : 'text-amber-600'}`}>
                          {formatCurrency(item.otgCompDiff)}
                        </td>
                        <td className={`px-4 py-2 text-sm text-right font-medium ${item.sellerCompDiff === 0 ? 'text-green-600' : 'text-amber-600'}`}>
                          {formatCurrency(item.sellerCompDiff)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {item.status === 'match' && <CheckCircle className="text-green-600 inline" size={16} />}
                          {item.status === 'difference' && <AlertCircle className="text-amber-600 inline" size={16} />}
                          {item.status === 'csv_only' && <XCircle className="text-blue-600 inline" size={16} />}
                          {item.status === 'firebase_only' && <XCircle className="text-purple-600 inline" size={16} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold">
                    <tr>
                      <td colSpan={2} className="px-4 py-2 text-sm text-slate-800">Totals</td>
                      <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(group.csvTotalOtgComp)}</td>
                      <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(group.csvTotalSellerComp)}</td>
                      <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(group.firebaseTotalOtgComp)}</td>
                      <td className="px-4 py-2 text-sm text-right text-slate-800">{formatCurrency(group.firebaseTotalSellerComp)}</td>
                      <td className={`px-4 py-2 text-sm text-right ${group.otgCompDiff === 0 ? 'text-green-600' : 'text-amber-600'}`}>
                        {formatCurrency(group.otgCompDiff)}
                      </td>
                      <td className={`px-4 py-2 text-sm text-right ${group.sellerCompDiff === 0 ? 'text-green-600' : 'text-amber-600'}`}>
                        {formatCurrency(group.sellerCompDiff)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StatementCompare;
