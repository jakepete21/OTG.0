import { MasterRecord, CarrierStatementProcessingResult } from "../types";
import { extractCarrierStatementData } from "./carrierStatementProcessor";
import { matchCarrierStatements } from "./matchingService";
import { detectAllDisputes } from "./disputeDetection";
import { generateSellerStatements } from "./sellerStatements";
import { MatchedRow } from "../types";

/**
 * Main pipeline: Process carrier statement file through full workflow
 */
export const processCarrierStatement = async (
  file: File,
  masterData: MasterRecord[],
  previousMonthData?: MatchedRow[]
): Promise<CarrierStatementProcessingResult> => {
  console.log(`Processing carrier statement: ${file.name}`);
  console.log(`Master data records: ${masterData.length}`);
  
  // Step 1: Extract data from carrier statement (pass masterData for state lookup)
  const carrierStatementRows = await extractCarrierStatementData(file, masterData);
  console.log(`Extracted ${carrierStatementRows.length} carrier statement rows`);
  
  if (carrierStatementRows.length === 0) {
    console.error('No rows extracted! Check console for extraction errors.');
  }

  // Step 2: Match against master data
  const matchedRows = matchCarrierStatements(carrierStatementRows, masterData);

  // Step 3: Detect disputes
  const disputes = detectAllDisputes(
    carrierStatementRows,
    matchedRows,
    masterData,
    previousMonthData
  );

  // Step 4: Generate seller statements
  const sellerStatements = generateSellerStatements(matchedRows);

  // Step 5: Generate summary
  const summary = generateSummary(
    carrierStatementRows,
    matchedRows,
    disputes,
    sellerStatements
  );

  return {
    carrierStatementRows,
    matchedRows,
    disputes,
    sellerStatements,
    summary,
  };
};

/**
 * Generates a summary of the processing results
 */
const generateSummary = (
  carrierRows: any[],
  matchedRows: any[],
  disputes: any[],
  sellerStatements: any[]
): string => {
  const totalRows = carrierRows.length;
  const matchedCount = matchedRows.length;
  const unmatchedCount = totalRows - matchedCount;
  const disputeCount = disputes.length;
  
  const disputeByType = disputes.reduce((acc, d) => {
    acc[d.type] = (acc[d.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalCommission = matchedRows.reduce((sum, r) => sum + (r.commissionAmount || 0), 0);
  const totalSellerComp = sellerStatements.reduce((sum, s) => sum + (s.totalSellerComp || 0), 0);

  return `Carrier Statement Processing Complete

Summary:
- Total rows extracted: ${totalRows}
- Matched rows: ${matchedCount}
- Unmatched rows: ${unmatchedCount}
- Total disputes: ${disputeCount}
  ${Object.entries(disputeByType).map(([type, count]) => `  - ${type}: ${count}`).join('\n')}

Commissions:
- Total OTG Commission: $${totalCommission.toFixed(2)}
- Total Seller Commission: $${totalSellerComp.toFixed(2)}

Seller Statements Generated:
${sellerStatements.map(s => `  - ${s.roleGroup}: ${s.items.length} items, $${s.totalSellerComp.toFixed(2)}`).join('\n')}
`;
};
