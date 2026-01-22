import React, { useState, useRef } from 'react';
import { MasterRecord, AnalysisResult, ProcessedItem, DiscrepancyType, CarrierStatementProcessingResult } from '../types';
import { analyzeStatement } from '../services/geminiService';
import { processCarrierStatement } from '../services/carrierStatementPipeline';
import { detectCarrier } from '../services/carrierStatementProcessor';
import { detectCarrierAndMonth } from '../services/monthDetection';
import { storeCarrierStatement, getAllProcessingMonths } from '../services/statementStorage';
import { UploadCloud, FileText, AlertTriangle, CheckCircle, Loader2, DollarSign, XCircle, FileJson, Calendar } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import * as XLSX from 'xlsx';

interface DashboardProps {
  masterData: MasterRecord[];
  analysisResult: AnalysisResult | null;
  setAnalysisResult: (res: AnalysisResult | null) => void;
  carrierStatementResult: CarrierStatementProcessingResult | null;
  setCarrierStatementResult: (res: CarrierStatementProcessingResult | null) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ 
  masterData, 
  analysisResult, 
  setAnalysisResult,
  carrierStatementResult,
  setCarrierStatementResult
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processingType, setProcessingType] = useState<'vendor' | 'carrier' | null>(null);
  const [detectionResult, setDetectionResult] = useState<ReturnType<typeof detectCarrierAndMonth> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setErrorMsg(null);
    setAnalysisResult(null);
    setCarrierStatementResult(null);
    setProcessingType(null);

    try {
      if (masterData.length === 0) {
        throw new Error("Master Data is empty. Please add services in the Master Data tab before processing.");
      }

      // Detect if this is a carrier statement (XLSX file)
      const isCarrierStatement = file.name.toLowerCase().match(/\.(xlsx|xls)$/) && 
                                  (file.name.toLowerCase().includes('carrier') || 
                                   file.name.toLowerCase().includes('statement') ||
                                   detectCarrier(file.name) !== 'Unknown');

      if (isCarrierStatement) {
        setProcessingType('carrier');
        setDetectionResult(null);
        try {
          // Detect carrier and processing month
          const detection = detectCarrierAndMonth(file.name);
          setDetectionResult(detection);
          
          if (!detection.carrier) {
            throw new Error(`Could not detect carrier type from filename: ${file.name}`);
          }
          
          if (!detection.processingMonth) {
            throw new Error(`Could not detect statement month from filename: ${file.name}. Please ensure filename contains month information (e.g., "2025-10" or "October 2025").`);
          }
          
          // Process carrier statement
          const result = await processCarrierStatement(file, masterData);
          
          // Store statement in storage
          const statement = {
            id: `stmt-${Date.now()}-${Math.random()}`,
            filename: file.name,
            carrier: detection.carrier,
            statementMonth: detection.statementMonth!,
            processingMonth: detection.processingMonth,
            uploadedAt: new Date(),
            rows: result.carrierStatementRows,
            matchedRows: result.matchedRows,
            sellerStatements: result.sellerStatements,
            disputes: result.disputes,
          };
          
          storeCarrierStatement(statement);
          
          // Set result for display
          setCarrierStatementResult(result);
          
          // Log results for debugging
          if (result.carrierStatementRows.length === 0) {
            console.error('WARNING: No rows extracted from carrier statement!');
            console.error('File name:', file.name);
            console.error('File size:', file.size);
            console.error('File type:', file.type);
            setErrorMsg('No data extracted from carrier statement. Please check the browser console (F12) for detailed error messages. The file may be in an unexpected format.');
          } else {
            // Show success message with processing month info
            console.log(`Carrier statement processed successfully:`);
            console.log(`- Carrier: ${detection.carrier}`);
            console.log(`- Statement Month: ${detection.statementMonth?.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
            console.log(`- Processing Month: ${detection.processingMonthLabel}`);
            console.log(`- Rows extracted: ${result.carrierStatementRows.length}`);
            console.log(`- Matched rows: ${result.matchedRows.length}`);
          }
        } catch (error: any) {
          console.error('Error processing carrier statement:', error);
          setErrorMsg(error.message || 'Failed to process carrier statement. Please check the browser console (F12) for details.');
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      // Otherwise, process as vendor statement
      setProcessingType('vendor');
      let dataToSend: string = "";
      let isBinary = false;
      let mimeType = file.type;

      // Handle text/csv, excel, or json formats explicitly using client libraries to ensure best results
      if (file.name.toLowerCase().endsWith('.csv')) {
         dataToSend = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = reject;
            reader.readAsText(file);
         });
         isBinary = false;
         mimeType = 'text/csv';
      } 
      else if (file.name.toLowerCase().match(/\.(xlsx|xls)$/)) {
         const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
         });
         
         const workbook = XLSX.read(arrayBuffer, { type: 'array' });
         const firstSheetName = workbook.SheetNames[0];
         const worksheet = workbook.Sheets[firstSheetName];
         // Convert to CSV for consistent AI processing
         dataToSend = XLSX.utils.sheet_to_csv(worksheet);
         isBinary = false;
         mimeType = 'text/csv'; 
      }
      else if (file.name.toLowerCase().endsWith('.json')) {
        const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = reject;
            reader.readAsText(file);
        });
        // Validate JSON
        try {
            JSON.parse(text);
        } catch (e) {
            throw new Error("Invalid JSON file format.");
        }
        dataToSend = text;
        isBinary = false;
        mimeType = 'application/json';
      }
      else {
        // Fallback for PDF/Images
        dataToSend = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        isBinary = true;
      }

      const result = await analyzeStatement(dataToSend, mimeType, masterData, isBinary);
      setAnalysisResult(result);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to process statement");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  // Stats calculation
  const totalRevenue = analysisResult?.processedItems.reduce((acc, item) => acc + item.amountReceived, 0) || 0;
  const totalCommission = analysisResult?.processedItems.reduce((acc, item) => acc + item.commissionAmount, 0) || 0;
  const discrepancyCount = analysisResult?.processedItems.filter(i => i.discrepancyType !== DiscrepancyType.NONE).length || 0;
  const missingCount = analysisResult?.missingFromStatement.length || 0;

  const chartData = analysisResult ? [
    { name: 'Matched', value: analysisResult.processedItems.filter(i => i.discrepancyType === DiscrepancyType.NONE).length, color: '#22c55e' },
    { name: 'Issues', value: discrepancyCount, color: '#eab308' },
    { name: 'Missing', value: missingCount, color: '#ef4444' },
  ] : [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Upload Statement</h2>
        <p className="text-slate-500 mt-1">Upload monthly commission statements for analysis and reconciliation.</p>
      </div>

      {/* Upload Area */}
      <div 
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
        } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input 
          ref={fileInputRef}
          type="file" 
          className="hidden" 
          onChange={handleFileChange}
          accept=".csv,.pdf,.png,.jpg,.jpeg,.xlsx,.xls,.json" 
        />
        
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center py-6">
            <Loader2 className="animate-spin text-indigo-600 mb-4" size={48} />
            <p className="text-lg font-medium text-slate-700">
              {processingType === 'carrier' ? 'Processing Carrier Statement...' : 'Analyzing Statement...'}
            </p>
            <p className="text-sm text-slate-500 mt-2">
              {processingType === 'carrier' 
                ? 'Extracting data, matching records, detecting disputes, and generating seller statements.'
                : 'Gemini is extracting data and matching records.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <div className="bg-indigo-100 p-4 rounded-full mb-4">
              <UploadCloud className="text-indigo-600" size={32} />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">Click to upload or drag and drop</h3>
            <p className="text-slate-500 mt-2 text-sm max-w-sm">
              Supports PDF, CSV, Excel, JSON, or Images. AI will extract line items automatically.
              <br />
              <span className="text-xs text-indigo-600 mt-1 block">
                Carrier statements (XLSX) will be processed with full automation pipeline.
              </span>
            </p>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertTriangle size={20} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Carrier Statement Results Section */}
      {carrierStatementResult && (
        <div className="animate-fade-in space-y-8">
          {/* Processing Month Info */}
          {detectionResult?.processingMonthLabel && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3">
              <Calendar className="text-indigo-600 flex-shrink-0" size={20} />
              <div>
                <p className="text-sm font-medium text-indigo-900">
                  Processing Month: <strong>{detectionResult.processingMonthLabel}</strong>
                </p>
                {detectionResult.carrier && (
                  <p className="text-xs text-indigo-700">
                    Carrier: {detectionResult.carrier} | Statement Month: {detectionResult.statementMonth?.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </p>
                )}
              </div>
            </div>
          )}
          
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Rows Extracted</p>
              <div className="text-2xl font-bold text-slate-800">
                {carrierStatementResult.carrierStatementRows.length}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Matched Rows</p>
              <div className="text-2xl font-bold text-indigo-600">
                {carrierStatementResult.matchedRows.length}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Disputes Found</p>
              <div className={`text-2xl font-bold ${carrierStatementResult.disputes.length > 0 ? 'text-amber-500' : 'text-green-600'}`}>
                {carrierStatementResult.disputes.length}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Total Commission</p>
              <div className="text-2xl font-bold text-indigo-600 flex items-center">
                <DollarSign size={20} className="text-indigo-400 mr-1" />
                {carrierStatementResult.matchedRows.reduce((sum, r) => sum + (r.commissionAmount || 0), 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <FileText size={20} className="text-indigo-600" />
              Processing Summary
            </h3>
            <pre className="text-slate-600 leading-relaxed text-sm whitespace-pre-line font-mono text-xs">
              {carrierStatementResult.summary}
            </pre>
          </div>

          {/* Seller Statements Preview */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800">Seller Statements Generated</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {carrierStatementResult.sellerStatements.map((stmt) => (
                  <div key={stmt.roleGroup} className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <h4 className="font-semibold text-slate-800 mb-2">{stmt.roleGroup}</h4>
                    <p className="text-sm text-slate-600">Items: {stmt.items.length}</p>
                    <p className="text-sm text-slate-600">Seller Comp: ${stmt.totalSellerComp.toFixed(2)}</p>
                    <p className="text-sm text-slate-600">OTG Comp: ${stmt.totalOtgComp.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <p className="text-sm text-indigo-800">
              <strong>Next Steps:</strong> View detailed disputes in the Disputes tab and seller statements in the Commissions tab.
            </p>
          </div>
        </div>
      )}

      {/* Vendor Statement Results Section */}
      {analysisResult && (
        <div className="animate-fade-in space-y-8">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Total Revenue Found</p>
              <div className="text-2xl font-bold text-slate-800 flex items-center">
                <DollarSign size={20} className="text-slate-400 mr-1" />
                {totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 2})}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Total Commission</p>
              <div className="text-2xl font-bold text-indigo-600 flex items-center">
                <DollarSign size={20} className="text-indigo-400 mr-1" />
                {totalCommission.toLocaleString(undefined, {minimumFractionDigits: 2})}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Discrepancies</p>
              <div className={`text-2xl font-bold flex items-center gap-2 ${discrepancyCount > 0 ? 'text-amber-500' : 'text-green-600'}`}>
                {discrepancyCount} <span className="text-sm font-normal text-slate-400">items</span>
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Missing Payments</p>
              <div className={`text-2xl font-bold flex items-center gap-2 ${missingCount > 0 ? 'text-red-500' : 'text-green-600'}`}>
                {missingCount} <span className="text-sm font-normal text-slate-400">services</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* AI Summary */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <FileText size={20} className="text-indigo-600" />
                AI Analysis Summary
              </h3>
              <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-line">
                {analysisResult.summary}
              </p>
            </div>

            {/* Chart */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
              <h3 className="text-sm font-semibold text-slate-500 w-full mb-2">Match Status Distribution</h3>
              <div className="w-full h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Missing Items Alert */}
          {analysisResult.missingFromStatement.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
               <div className="px-6 py-4 border-b border-red-100 flex items-center gap-2">
                  <XCircle className="text-red-600" size={20} />
                  <h3 className="font-bold text-red-800">Missing Payments Identified</h3>
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
                      {analysisResult.missingFromStatement.map(item => (
                        <tr key={item.id} className="hover:bg-red-50">
                          <td className="px-6 py-3 text-slate-700">{item.clientName}</td>
                          <td className="px-6 py-3 text-slate-600">{item.serviceType}</td>
                          <td className="px-6 py-3">{item.salesperson}</td>
                          <td className="px-6 py-3 text-right font-mono text-slate-600">${item.expectedAmount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
            </div>
          )}

           {/* Detailed Transaction Table */}
           <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
             <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="font-bold text-slate-800">Processed Transactions</h3>
                <span className="text-xs font-medium bg-white border border-slate-200 px-2 py-1 rounded text-slate-500">
                  {analysisResult.processedItems.length} Records
                </span>
             </div>
             <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 font-semibold">Date</th>
                      <th className="px-6 py-3 font-semibold">Client (Vendor Stmt)</th>
                      <th className="px-6 py-3 font-semibold">Status</th>
                      <th className="px-6 py-3 font-semibold text-right">Amount</th>
                      <th className="px-6 py-3 font-semibold text-right">Commission</th>
                      <th className="px-6 py-3 font-semibold w-1/3">Notes/Explanation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analysisResult.processedItems.map((item) => {
                      let badgeColor = "bg-slate-100 text-slate-600";
                      if (item.discrepancyType === DiscrepancyType.NONE) badgeColor = "bg-green-100 text-green-700 border border-green-200";
                      else if (item.discrepancyType === DiscrepancyType.UNKNOWN_SERVICE) badgeColor = "bg-gray-100 text-gray-700 border border-gray-200";
                      else badgeColor = "bg-amber-100 text-amber-700 border border-amber-200";

                      return (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3 text-slate-600 whitespace-nowrap">{item.date}</td>
                          <td className="px-6 py-3 font-medium text-slate-800">{item.clientName}</td>
                          <td className="px-6 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${badgeColor}`}>
                              {item.discrepancyType}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right font-mono text-slate-700">${item.amountReceived.toFixed(2)}</td>
                          <td className="px-6 py-3 text-right font-bold text-indigo-600">${item.commissionAmount.toFixed(2)}</td>
                          <td className="px-6 py-3 text-slate-500 text-xs">{item.explanation}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
             </div>
           </div>

        </div>
      )}
    </div>
  );
};

export default Dashboard;