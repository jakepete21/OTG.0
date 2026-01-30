import React, { useState, useRef } from 'react';
import { MasterRecord, AnalysisResult, ProcessedItem, DiscrepancyType, CarrierStatementProcessingResult } from '../types';
import { analyzeStatement } from '../services/geminiService';
import { processCarrierStatement } from '../services/carrierStatementPipeline';
import { detectCarrier } from '../services/carrierStatementProcessor';
import { detectCarrierAndMonth, getMonthKey } from '../services/monthDetection';
import { useUploadCarrierStatement, useStoreMatches, useRegenerateSellerStatements } from '../services/firebaseHooks';
import { generateSellerStatements } from '../services/sellerStatements';
import FilePreviewModalWrapper from './FilePreviewModalWrapper';
import { UploadCloud, FileText, AlertTriangle, CheckCircle, Loader2, DollarSign, XCircle, FileJson, Calendar, Eye, X, CheckCircle2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import * as XLSX from 'xlsx';
import { formatCurrency, formatNumber } from '../services/numberFormat';

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
  const [duplicateWarning, setDuplicateWarning] = useState<{ exists: boolean; filename?: string } | null>(null);
  const [previewFile, setPreviewFile] = useState<{ fileName: string; storageId: string } | null>(null);
  const [batchUploadResults, setBatchUploadResults] = useState<Array<{
    fileName: string;
    status: 'success' | 'error' | 'duplicate' | 'processing';
    message?: string;
    detection?: ReturnType<typeof detectCarrierAndMonth>;
  }>>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [storeProgress, setStoreProgress] = useState<{ current: number; total: number } | null>(null);
  const [regenerateProgress, setRegenerateProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Firebase hooks
  const uploadCarrierStatement = useUploadCarrierStatement();
  const storeMatches = useStoreMatches();
  const regenerateSellerStatements = useRegenerateSellerStatements();
  
  /**
   * Regenerate seller statements from all matches for a processing month
   */
  const regenerateSellerStatementsForMonth = async (processingMonth: string) => {
    try {
      console.log(`[regenerateSellerStatementsForMonth] Starting regeneration for month: ${processingMonth}`);
      
      // Add a small delay to ensure all previous mutations are committed
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Call function to regenerate seller statements
      const result = await regenerateSellerStatements(processingMonth);
      
      console.log(`[regenerateSellerStatementsForMonth] Regeneration complete`);
      console.log(`[regenerateSellerStatementsForMonth] Total matches processed: ${result.matchedRowsCount}`);
      console.log(`[regenerateSellerStatementsForMonth] Seller statement groups: ${result.sellerStatementGroups}`);
      
      if (result.matchedRowsCount === 0) {
        console.warn(`[regenerateSellerStatementsForMonth] No matched rows found for ${processingMonth}`);
      }
    } catch (error: any) {
      console.error(`[regenerateSellerStatementsForMonth] Error:`, error);
      throw error;
    }
  };
  

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  /**
   * Process multiple files in batch
   */
  const processBatchFiles = async (files: File[]) => {
    if (masterData.length === 0) {
      setErrorMsg("Comp Key is empty. Please load Comp Key before processing.");
      return;
    }

    setIsBatchProcessing(true);
    setBatchUploadResults([]);
    setErrorMsg(null);
    setCarrierStatementResult(null);
    setAnalysisResult(null);

    const results: Array<{
      fileName: string;
      status: 'success' | 'error' | 'duplicate' | 'processing';
      message?: string;
      detection?: ReturnType<typeof detectCarrierAndMonth>;
    }> = [];

    // Filter to only carrier statements (XLSX files)
    const carrierStatements = files.filter(file => 
      file.name.toLowerCase().match(/\.(xlsx|xls)$/) && 
      (file.name.toLowerCase().includes('carrier') || 
       file.name.toLowerCase().includes('statement') ||
       detectCarrier(file.name) !== 'Unknown')
    );

    if (carrierStatements.length === 0) {
      setErrorMsg("No carrier statement files found. Please upload XLSX files with carrier names in the filename.");
      setIsBatchProcessing(false);
      return;
    }

    // Track which processing months had files uploaded
    const processingMonthsToRegenerate = new Set<string>();
    
    // Process each file
    for (let i = 0; i < carrierStatements.length; i++) {
      const file = carrierStatements[i];
      
      // Update status to processing
      results.push({
        fileName: file.name,
        status: 'processing',
      });
      setBatchUploadResults([...results]);

      try {
        // Detect carrier and processing month
        const detection = detectCarrierAndMonth(file.name);
        
        if (!detection.carrier) {
          results[i] = {
            fileName: file.name,
            status: 'error',
            message: `Could not detect carrier type from filename`,
            detection,
          };
          setBatchUploadResults([...results]);
          continue;
        }
        
        if (!detection.processingMonth) {
          results[i] = {
            fileName: file.name,
            status: 'error',
            message: `Could not detect statement month from filename`,
            detection,
          };
          setBatchUploadResults([...results]);
          continue;
        }

        const processingMonthKey = getMonthKey(detection.processingMonth);

        // Process the file (without regenerating seller statements yet)
        await processSingleCarrierFile(file, detection, results, i);
        
        // Track this processing month for regeneration
        processingMonthsToRegenerate.add(processingMonthKey);
        
      } catch (error: any) {
        results[i] = {
          fileName: file.name,
          status: 'error',
          message: error.message || 'Failed to process file',
        };
        setBatchUploadResults([...results]);
      }
    }

    // Regenerate seller statements for each processing month that had files uploaded
    // This ensures all carriers are combined
    console.log(`[processBatchFiles] Regenerating seller statements for ${processingMonthsToRegenerate.size} processing month(s)`);
    setRegenerateProgress('Regenerating seller statements...');
    for (const processingMonth of processingMonthsToRegenerate) {
      console.log(`[processBatchFiles] Regenerating for month: ${processingMonth}`);
      await regenerateSellerStatementsForMonth(processingMonth);
    }
    setRegenerateProgress(null);

    setIsBatchProcessing(false);
    
    // Show summary
    const successCount = results.filter(r => r.status === 'success').length;
    const duplicateCount = results.filter(r => r.status === 'duplicate').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    if (successCount > 0 || duplicateCount > 0 || errorCount > 0) {
      setErrorMsg(
        `Batch upload complete: ${successCount} successful, ${duplicateCount} duplicates skipped, ${errorCount} errors`
      );
    }
  };

  /**
   * Check if a carrier statement already exists (duplicate check)
   */
  const checkForDuplicate = async (
    carrier: string,
    processingMonth: string
  ): Promise<{ exists: boolean; statementId?: string }> => {
    const { collection, query, where, getDocs } = await import('firebase/firestore');
    const { db } = await import('../services/firebaseClient');
    
    const statementsRef = collection(db, 'carrierStatements');
    const duplicateQuery = query(
      statementsRef,
      where('carrier', '==', carrier),
      where('processingMonth', '==', processingMonth)
    );
    const duplicateSnapshot = await getDocs(duplicateQuery);
    const existing = duplicateSnapshot.docs[0];
    
    return {
      exists: !!existing,
      statementId: existing?.id,
    };
  };

  /**
   * Process a single carrier file
   */
  const processSingleCarrierFile = async (
    file: File,
    detection: ReturnType<typeof detectCarrierAndMonth>,
    results: Array<{
      fileName: string;
      status: 'success' | 'error' | 'duplicate' | 'processing';
      message?: string;
      detection?: ReturnType<typeof detectCarrierAndMonth>;
    }>,
    index: number
  ) => {
    const processingMonthKey = getMonthKey(detection.processingMonth!);
    const statementMonthKey = getMonthKey(detection.statementMonth!);

    try {
      // Check for duplicate BEFORE processing
      const duplicateCheck = await checkForDuplicate(detection.carrier!, processingMonthKey);
      
      if (duplicateCheck.exists) {
        // Duplicate detected - skip entirely (no processing, no file upload, no deletion)
        console.log(`[processSingleCarrierFile] Duplicate detected for ${detection.carrier} - ${processingMonthKey}, skipping entirely`);
        
        results[index] = {
          fileName: file.name,
          status: 'duplicate',
          message: `Duplicate detected - already processed, skipping`,
          detection,
        };
        setBatchUploadResults([...results]);
        return;
      }
      
      // No duplicate - process the file
      const result = await processCarrierStatement(file, masterData);
      
      // Upload file and metadata to Firebase (handles file upload internally)
      const uploadStatementResult = await uploadCarrierStatement(file, {
        filename: file.name,
        carrier: detection.carrier!,
        statementMonth: statementMonthKey,
        processingMonth: processingMonthKey,
      });

      // Process statement: store matches and regenerate seller statements from ALL carriers
      if (uploadStatementResult.statementId) {
        // Store matched rows (storeMatches handles batching internally)
        console.log(`[processSingleCarrierFile] Storing ${result.matchedRows.length} matched rows for ${detection.carrier}`);
        const totalBatches = Math.ceil(result.matchedRows.length / 450);
        setStoreProgress({ current: 0, total: totalBatches });
        await storeMatches(
          processingMonthKey,
          uploadStatementResult.statementId,
          result.matchedRows,
          (current, total) => {
            setStoreProgress({ current, total });
          }
        );
        setStoreProgress(null);
        
        // Note: Seller statement regeneration happens after ALL files in batch are processed
        // This ensures all carriers are combined. See processBatchFiles for the regeneration call.
        
        results[index] = {
          fileName: file.name,
          status: 'success',
          message: `Successfully uploaded and processed`,
          detection,
        };
        setBatchUploadResults([...results]);
        return;
      }

      results[index] = {
        fileName: file.name,
        status: 'success',
        message: `Successfully processed: ${result.carrierStatementRows.length} rows extracted, ${result.matchedRows.length} matched`,
        detection,
      };
      setBatchUploadResults([...results]);

    } catch (error: any) {
      results[index] = {
        fileName: file.name,
        status: 'error',
        message: error.message || 'Failed to process file',
        detection,
      };
      setBatchUploadResults([...results]);
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
        throw new Error("Comp Key is empty. Please load Comp Key before processing.");
      }

      // Detect if this is a carrier statement (XLSX file)
      const isCarrierStatement = file.name.toLowerCase().match(/\.(xlsx|xls)$/) && 
                                  (file.name.toLowerCase().includes('carrier') || 
                                   file.name.toLowerCase().includes('statement') ||
                                   detectCarrier(file.name) !== 'Unknown');

      if (isCarrierStatement) {
        setProcessingType('carrier');
        setDetectionResult(null);
        setDuplicateWarning(null);
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
          
          const processingMonthKey = getMonthKey(detection.processingMonth);
          const statementMonthKey = getMonthKey(detection.statementMonth!);
          
          // Check for duplicate BEFORE processing
          const duplicateCheck = await checkForDuplicate(detection.carrier, processingMonthKey);
          
          if (duplicateCheck.exists) {
            // Duplicate detected - skip entirely (no processing, no file upload, no deletion)
            console.log(`[processFile] Duplicate detected for ${detection.carrier} - ${processingMonthKey}, skipping entirely`);
            
            // Show duplicate warning
            setDuplicateWarning({
              exists: true,
              filename: file.name,
            });
            
            // Set error message
            setErrorMsg(`Duplicate detected: A statement for ${detection.carrier} (${detection.processingMonthLabel}) already exists. Skipping upload.`);
            
            setIsProcessing(false);
            return;
          }
          
          // No duplicate - process the file
          const result = await processCarrierStatement(file, masterData);
          
          // Upload file and metadata to Firebase (handles file upload internally)
          const uploadResult = await uploadCarrierStatement(file, {
            filename: file.name,
            carrier: detection.carrier,
            statementMonth: statementMonthKey,
            processingMonth: processingMonthKey,
          });
          
          // Store file info for preview (use fileUrl from Firebase)
          setPreviewFile({
            fileName: file.name,
            storageId: uploadResult.fileUrl,
          });
          
          // Process statement: store matches and regenerate seller statements from ALL carriers
          if (uploadResult.statementId) {
            // Store matched rows (storeMatches handles batching internally)
            console.log(`[processFile] Storing ${result.matchedRows.length} matched rows for ${detection.carrier}`);
            setStoreProgress({ current: 0, total: Math.ceil(result.matchedRows.length / 450) });
            await storeMatches(
              processingMonthKey,
              uploadResult.statementId,
              result.matchedRows,
              (current, total) => {
                setStoreProgress({ current, total });
              }
            );
            setStoreProgress(null);
            
            // Regenerate seller statements from ALL matches for this processing month
            setRegenerateProgress('Regenerating seller statements...');
            // Add a small delay to ensure all matches are stored before regenerating
            await new Promise(resolve => setTimeout(resolve, 500));
            await regenerateSellerStatementsForMonth(processingMonthKey);
            setRegenerateProgress(null);
          }
          
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
            console.log(`- Stored in Firebase: ${uploadResult.statementId}`);
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 1) {
        processFile(files[0]);
      } else {
        processBatchFiles(files);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      if (files.length === 1) {
        processFile(files[0]);
      } else {
        processBatchFiles(files);
      }
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
        } ${(isProcessing || isBatchProcessing) ? 'opacity-50 pointer-events-none' : ''}`}
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
          multiple
        />
        
        {(isProcessing || isBatchProcessing) ? (
          <div className="flex flex-col items-center justify-center py-6">
            <Loader2 className="animate-spin text-indigo-600 mb-4" size={48} />
            <p className="text-lg font-medium text-slate-700">
              {isBatchProcessing 
                ? `Processing ${batchUploadResults.length} file${batchUploadResults.length !== 1 ? 's' : ''}...`
                : processingType === 'carrier' 
                  ? 'Processing Carrier Statement...' 
                  : 'Analyzing Statement...'}
            </p>
            <p className="text-sm text-slate-500 mt-2">
              {isBatchProcessing
                ? 'Checking for duplicates, extracting data, and processing each file.'
                : processingType === 'carrier' 
                  ? 'Extracting data, matching records, detecting disputes, and generating seller statements.'
                  : 'Gemini is extracting data and matching records.'}
            </p>
            
            {/* Progress Indicators */}
            {storeProgress && (
              <div className="mt-4 w-full max-w-md">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Storing matches</span>
                  <span className="text-sm text-slate-500">{storeProgress.current}/{storeProgress.total} batches</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                  <div 
                    className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${(storeProgress.current / storeProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            
            {regenerateProgress && (
              <div className="mt-4 flex items-center gap-2">
                <Loader2 className="animate-spin text-indigo-600" size={16} />
                <span className="text-sm text-slate-600">{regenerateProgress}</span>
              </div>
            )}
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
                <br />
                You can upload multiple files at once - duplicates will be automatically detected and skipped.
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

      {duplicateWarning && duplicateWarning.exists && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertTriangle size={20} />
          <div>
            <p className="font-medium">Duplicate Statement Detected</p>
            <p className="text-sm">
              A statement for this carrier and processing month already exists ({duplicateWarning.filename}). 
              The existing statement has been replaced with the new upload.
            </p>
          </div>
        </div>
      )}

      {/* Batch Upload Results */}
      {batchUploadResults.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h3 className="font-bold text-slate-800">
              Batch Upload Results ({batchUploadResults.length} files)
            </h3>
            {isBatchProcessing && (
              <p className="text-sm text-slate-500 mt-1">Processing files...</p>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {batchUploadResults.map((result, idx) => (
              <div
                key={idx}
                className={`px-6 py-4 flex items-start gap-3 ${
                  result.status === 'success' ? 'bg-green-50/50' :
                  result.status === 'duplicate' ? 'bg-amber-50/50' :
                  result.status === 'error' ? 'bg-red-50/50' :
                  'bg-slate-50/50'
                }`}
              >
                {result.status === 'processing' && (
                  <Loader2 className="animate-spin text-indigo-600 flex-shrink-0 mt-0.5" size={18} />
                )}
                {result.status === 'success' && (
                  <CheckCircle2 className="text-green-600 flex-shrink-0 mt-0.5" size={18} />
                )}
                {result.status === 'duplicate' && (
                  <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
                )}
                {result.status === 'error' && (
                  <X className="text-red-600 flex-shrink-0 mt-0.5" size={18} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm">{result.fileName}</p>
                  {result.detection && (
                    <p className="text-xs text-slate-500 mt-1">
                      Carrier: {result.detection.carrier || 'Unknown'} | 
                      Processing Month: {result.detection.processingMonthLabel || 'Unknown'}
                    </p>
                  )}
                  {result.message && (
                    <p className={`text-xs mt-1 ${
                      result.status === 'success' ? 'text-green-700' :
                      result.status === 'duplicate' ? 'text-amber-700' :
                      'text-red-700'
                    }`}>
                      {result.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Carrier Statement Results Section */}
      {carrierStatementResult && (
        <div className="animate-fade-in space-y-8">
          {/* Processing Month Info */}
          {detectionResult?.processingMonthLabel && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
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
              {previewFile && (
                <button
                  onClick={() => setPreviewFile(previewFile)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-300 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  <Eye size={16} />
                  View File
                </button>
              )}
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
                {formatCurrency(carrierStatementResult.matchedRows.reduce((sum, r) => sum + (r.commissionAmount || 0), 0))}
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
                    <p className="text-sm text-slate-600">Seller Comp: {formatCurrency(stmt.totalSellerComp)}</p>
                    <p className="text-sm text-slate-600">OTG Comp: {formatCurrency(stmt.totalOtgComp)}</p>
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
                {formatCurrency(totalRevenue)}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-1">Total Commission</p>
              <div className="text-2xl font-bold text-indigo-600 flex items-center">
                <DollarSign size={20} className="text-indigo-400 mr-1" />
                {formatCurrency(totalCommission)}
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
                          <td className="px-6 py-3 text-right font-mono text-slate-600">{formatCurrency(item.expectedAmount)}</td>
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
                          <td className="px-6 py-3 text-right font-mono text-slate-700">{formatCurrency(item.amountReceived)}</td>
                          <td className="px-6 py-3 text-right font-bold text-indigo-600">{formatCurrency(item.commissionAmount)}</td>
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

export default Dashboard;