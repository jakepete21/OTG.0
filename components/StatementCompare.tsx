import React, { useState, useMemo, useEffect } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { parseUploadedStatements, parseRawDataWithRoleGroup, compareStatements, ComparisonResult, ParsedStatements } from '../services/statementComparisonService';
import { useSellerStatements } from '../services/firebaseHooks';
import { useProcessingMonths } from '../services/firebaseHooks';
import { SellerStatement } from '../types';
import { formatCurrency } from '../services/numberFormat';

const StatementCompare: React.FC = () => {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedStatements, setParsedStatements] = useState<ParsedStatements | null>(null);
  const [selectedProcessingMonth, setSelectedProcessingMonth] = useState<string>('');
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRoleGroups, setExpandedRoleGroups] = useState<Set<string>>(new Set());
  const [showMatchedItems, setShowMatchedItems] = useState<boolean>(false);
  const [unparsedData, setUnparsedData] = useState<{ headers: string[]; rows: any[] } | null>(null);
  const [selectedRoleGroupForCsv, setSelectedRoleGroupForCsv] = useState<string>('');

  // Get processing months and seller statements
  const processingMonths = useProcessingMonths();
  const firebaseStatements = useSellerStatements(selectedProcessingMonth || null);

  // Convert Firebase statements to SellerStatement[] format
  const sellerStatements: SellerStatement[] = useMemo(() => {
    return firebaseStatements.map(stmt => ({
      roleGroup: stmt.roleGroup,
      items: stmt.items,
      totalOtgComp: stmt.totalOtgComp,
      totalSellerComp: stmt.totalSellerComp,
    }));
  }, [firebaseStatements]);

  // Auto-compare when seller statements load (if file and month are already selected)
  useEffect(() => {
    if (parsedStatements && selectedProcessingMonth && sellerStatements.length > 0) {
      (async () => {
        const result = await compareStatements(parsedStatements, sellerStatements, selectedProcessingMonth);
        setComparisonResult(result);
      })();
    }
  }, [parsedStatements, selectedProcessingMonth, sellerStatements]);

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsProcessing(true);
    setUploadedFile(file);
    setParsedStatements(null);
    setComparisonResult(null);
    setUnparsedData(null);
    setSelectedRoleGroupForCsv('');

    try {
      const result = await parseUploadedStatements(file);
      
      if (result.needsManualRoleGroup) {
        // Need manual role group selection
        setUnparsedData(result.needsManualRoleGroup);
        setError('No role group detected. Please select a role group for this CSV file.');
      } else {
        // Data was parsed successfully
        const hasData = Object.keys(result.parsed).length > 0 && 
          Object.values(result.parsed).some(items => items.length > 0);
        
        if (hasData) {
          setParsedStatements(result.parsed);
          setError(null);
          // Auto-compare will happen via useEffect when sellerStatements are loaded
        } else {
          setError('File appears to be empty or no valid data found.');
        }
      }
    } catch (err: any) {
      setError(`Failed to parse file: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle manual role group assignment for CSV
  const handleAssignRoleGroup = async () => {
    if (!unparsedData || !selectedRoleGroupForCsv) {
      setError('Please select a role group');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const parsed = await parseRawDataWithRoleGroup(
        unparsedData.headers,
        unparsedData.rows,
        selectedRoleGroupForCsv
      );

      const hasData = Object.values(parsed).some(items => items.length > 0);
      if (!hasData) {
        setError('No valid rows found. Please check your CSV columns match the expected format.');
        return;
      }

      setParsedStatements(parsed);
      setUnparsedData(null);
      setSelectedRoleGroupForCsv('');
      setError(null);
    } catch (err: any) {
      setError(`Failed to parse data: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle processing month selection
  const handleMonthSelect = (monthKey: string) => {
    setSelectedProcessingMonth(monthKey);
    setComparisonResult(null);
    // Auto-compare will happen via useEffect when sellerStatements are loaded
  };

  // Trigger comparison manually
  const handleCompare = async () => {
    if (!parsedStatements || !selectedProcessingMonth) {
      setError('Please upload a file and select a processing month');
      return;
    }

    if (sellerStatements.length === 0) {
      setError('No seller statements found for selected month');
      return;
    }

    setError(null);
    setIsProcessing(true);
    try {
      const result = await compareStatements(parsedStatements, sellerStatements, selectedProcessingMonth);
      setComparisonResult(result);
    } catch (error: any) {
      setError(`Comparison failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Toggle role group expansion
  const toggleRoleGroup = (roleGroup: string) => {
    const newExpanded = new Set(expandedRoleGroups);
    if (newExpanded.has(roleGroup)) {
      newExpanded.delete(roleGroup);
    } else {
      newExpanded.add(roleGroup);
    }
    setExpandedRoleGroups(newExpanded);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Statement Compare</h1>
        <p className="text-slate-600 mt-1">
          Upload seller statement CSV/XLSX and compare against Firebase seller statements
        </p>
      </div>

      {/* File Upload Section */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Upload Statement File</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
            <Upload size={18} />
            <span>Choose File</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isProcessing}
            />
          </label>
          {uploadedFile && (
            <div className="flex items-center gap-2 text-slate-600">
              <FileText size={18} />
              <span>{uploadedFile.name}</span>
            </div>
          )}
          {isProcessing && (
            <div className="text-slate-500">Processing...</div>
          )}
        </div>
        {parsedStatements && (
          <div className="mt-4 text-sm text-slate-600">
            Parsed {Object.keys(parsedStatements).length} role group(s): {Object.keys(parsedStatements).join(', ')}
          </div>
        )}
      </div>

      {/* Manual Role Group Selection (for files without role group detection) */}
      {unparsedData && (
        <div className="bg-white rounded-lg border border-amber-200 p-6">
          <h2 className="text-lg font-semibold text-amber-900 mb-4">
            Select Role Group for File
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            No role group was detected from your file. Please select which role group this file belongs to.
            <br />
            Found {unparsedData.rows.length} rows with columns: {unparsedData.headers.slice(0, 5).join(', ')}{unparsedData.headers.length > 5 ? '...' : ''}
            <br />
            <span className="text-xs text-slate-500 mt-2 block">
              Tip: For XLSX files, name your tabs after role groups (e.g., "RD1/2", "RD3/4"). 
              For CSV files, add a "Role Group" column with values like "RD1/2", "RD3/4", etc.
            </span>
          </p>
          <div className="flex items-center gap-4">
            <select
              value={selectedRoleGroupForCsv}
              onChange={(e) => setSelectedRoleGroupForCsv(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">Select role group...</option>
              <option value="RD1/2">RD1/2</option>
              <option value="RD3/4">RD3/4</option>
              <option value="RM1/2">RM1/2</option>
              <option value="RM3/4">RM3/4</option>
              <option value="OVR/RD5">OVR/RD5</option>
              <option value="OTG">OTG</option>
            </select>
            <button
              onClick={handleAssignRoleGroup}
              disabled={!selectedRoleGroupForCsv}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              Assign Role Group
            </button>
          </div>
        </div>
      )}

      {/* Processing Month Selector */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Select Processing Month</h2>
        <select
          value={selectedProcessingMonth}
          onChange={(e) => handleMonthSelect(e.target.value)}
          className="w-full md:w-64 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="">Select a month...</option>
          {processingMonths.map((month) => (
            <option key={month.monthKey} value={month.monthKey}>
              {month.monthLabel} ({month.status})
            </option>
          ))}
        </select>
        {selectedProcessingMonth && sellerStatements.length === 0 && (
          <div className="mt-2 text-sm text-amber-600">
            No seller statements found for this month
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Comparison Results */}
      {comparisonResult && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-sm text-slate-600">Total Compared</div>
              <div className="text-2xl font-bold text-slate-700 mt-1">
                {comparisonResult.summary.totalCompared}
              </div>
              <div className="text-xs text-slate-500 mt-1">Items on both statements</div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-sm text-slate-600">Matched (No Differences)</div>
              <div className="text-2xl font-bold text-green-600 mt-1">
                {comparisonResult.summary.totalMatched}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-sm text-slate-600">Differences Found</div>
              <div className="text-2xl font-bold text-red-600 mt-1">
                {comparisonResult.summary.totalDifferences}
              </div>
            </div>
          </div>

          {/* Show Matched Items Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showMatched"
              checked={showMatchedItems}
              onChange={(e) => setShowMatchedItems(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
            />
            <label htmlFor="showMatched" className="text-sm text-slate-600 cursor-pointer">
              Show matched items (no differences)
            </label>
          </div>

          {/* Role Group Comparisons */}
          {comparisonResult.roleGroups.map((rg) => {
            const isExpanded = expandedRoleGroups.has(rg.roleGroup);
            const hasIssues = rg.differences.length > 0;
            const totalCompared = rg.matched.length + rg.differences.length;

            return (
              <div key={rg.roleGroup} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                {/* Role Group Header */}
                <button
                  onClick={() => toggleRoleGroup(rg.roleGroup)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {hasIssues ? (
                      <XCircle size={20} className="text-red-500" />
                    ) : (
                      <CheckCircle size={20} className="text-green-500" />
                    )}
                    <span className="font-semibold text-slate-900">{rg.roleGroup}</span>
                    <span className="text-sm text-slate-500">
                      ({totalCompared} compared: {rg.matched.length} matched, {rg.differences.length} differences)
                    </span>
                  </div>
                  {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>

                {/* Totals Summary */}
                <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-slate-600">CSV OTG Comp</div>
                    <div className="font-semibold">{formatCurrency(rg.csvTotal.otgComp)}</div>
                  </div>
                  <div>
                    <div className="text-slate-600">Firebase OTG Comp</div>
                    <div className="font-semibold">{formatCurrency(rg.firebaseTotal.otgComp)}</div>
                  </div>
                  <div>
                    <div className="text-slate-600">CSV Seller Comp</div>
                    <div className="font-semibold">{formatCurrency(rg.csvTotal.sellerComp)}</div>
                  </div>
                  <div>
                    <div className="text-slate-600">Firebase Seller Comp</div>
                    <div className="font-semibold">{formatCurrency(rg.firebaseTotal.sellerComp)}</div>
                  </div>
                  {(rg.difference.otgComp !== 0 || rg.difference.sellerComp !== 0) && (
                    <div className="col-span-2 md:col-span-4 mt-2 pt-2 border-t border-slate-300">
                      <div className="text-red-600 font-semibold">
                        Difference: OTG {formatCurrency(rg.difference.otgComp)}, Seller {formatCurrency(rg.difference.sellerComp)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-6 py-4 space-y-4">
                    {/* Matched Items */}
                    {showMatchedItems && rg.matched.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-green-700 mb-2">
                          Matched Items ({rg.matched.length})
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                              <tr>
                                <th className="px-3 py-2 text-left">Billing Item</th>
                                <th className="px-3 py-2 text-left">Account Name</th>
                                <th className="px-3 py-2 text-right">OTG Comp</th>
                                <th className="px-3 py-2 text-right">Seller Comp</th>
                                <th className="px-3 py-2 text-left">State</th>
                                <th className="px-3 py-2 text-left">Provider</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rg.matched.map((match, idx) => (
                                <tr key={idx} className="border-t border-slate-100">
                                  <td className="px-3 py-2">{match.csv.otgCompBillingItem}</td>
                                  <td className="px-3 py-2">{match.csv.accountName}</td>
                                  <td className="px-3 py-2 text-right">{formatCurrency(match.csv.otgComp)}</td>
                                  <td className="px-3 py-2 text-right">{formatCurrency(match.csv.sellerComp)}</td>
                                  <td className="px-3 py-2">{match.csv.state}</td>
                                  <td className="px-3 py-2">{match.csv.provider}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Differences */}
                    {rg.differences.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-red-700 mb-2">
                          Differences ({rg.differences.length})
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-red-50">
                              <tr>
                                <th className="px-3 py-2 text-left">Billing Item</th>
                                <th className="px-3 py-2 text-left">Account Name</th>
                                <th className="px-3 py-2 text-right">Field</th>
                                <th className="px-3 py-2 text-right">CSV Value</th>
                                <th className="px-3 py-2 text-right">Firebase Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rg.differences.map((diff, idx) => (
                                <React.Fragment key={idx}>
                                  {diff.differences.map((d, dIdx) => (
                                    <tr key={`${idx}-${dIdx}`} className="border-t border-red-100 bg-red-50">
                                      <td className="px-3 py-2">{diff.csv.otgCompBillingItem}</td>
                                      <td className="px-3 py-2">{diff.csv.accountName}</td>
                                      <td className="px-3 py-2 font-semibold text-red-700">{d.field}</td>
                                      <td className="px-3 py-2 text-right">
                                        {typeof d.csvValue === 'number' ? formatCurrency(d.csvValue) : String(d.csvValue)}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        {typeof d.firebaseValue === 'number' ? formatCurrency(d.firebaseValue) : String(d.firebaseValue)}
                                      </td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StatementCompare;
