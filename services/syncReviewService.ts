import { GoogleGenAI, Type, Schema } from "@google/genai";
import { MasterRecord } from "../types";

interface DiffItem {
  type: 'added' | 'modified' | 'deleted' | 'unchanged';
  record: MasterRecord;
  sheetRecord?: MasterRecord;
  changes?: Record<string, { old: any; new: any }>;
}

interface DiscrepancyItem {
  recordId: string;
  type: 'added' | 'modified' | 'deleted';
  accountCarrier: string;
  billingItem: string;
  description: string;
  details: string;
  severity: 'high' | 'medium' | 'low';
}

interface ComparisonReport {
  summary: string;
  discrepancies: DiscrepancyItem[];
  dataQualityIssues: string[];
  statistics: {
    totalDiscrepancies: number;
    added: number;
    modified: number;
    deleted: number;
    dataQualityIssues: number;
  };
}

interface SyncDecision {
  recordId: string;
  shouldSync: boolean;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

interface AISyncAnalysis {
  summary: string;
  decisions: SyncDecision[];
  warnings: string[];
  statistics: {
    totalAnalyzed: number;
    willSync: number;
    willSkip: number;
    needsReview: number;
  };
}

interface CleanedRecord {
  record: MasterRecord;
  cleaned: boolean;
  issues: string[];
  changes: Record<string, { old: any; new: any }>;
}

interface DataCleaningResult {
  cleanedRecords: MasterRecord[];
  summary: string;
  issues: string[];
  statistics: {
    totalRecords: number;
    cleaned: number;
    skipped: number;
    issuesFound: number;
  };
}

const comparisonSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: "Executive summary comparing database vs Google Sheet - describe the overall differences and patterns"
    },
    discrepancies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          recordId: { 
            type: Type.STRING, 
            description: "Identifier using format: accountCarrier|||billingItem" 
          },
          type: {
            type: Type.STRING,
            enum: ['added', 'modified', 'deleted'],
            description: "Type of discrepancy"
          },
          accountCarrier: { type: Type.STRING, description: "Account **CARRIER** value" },
          billingItem: { type: Type.STRING, description: "OTG Comp Billing item value" },
          description: { 
            type: Type.STRING, 
            description: "Brief description of what's different (e.g., 'New account in sheet', 'COMP 1 changed from X to Y', 'Missing from sheet')" 
          },
          details: { 
            type: Type.STRING, 
            description: "Detailed explanation of the discrepancy, including specific field changes for modified items" 
          },
          severity: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
            description: "Severity: 'high' = critical fields changed (COMP, amounts, percentages), 'medium' = important fields changed, 'low' = minor fields changed"
          }
        },
        required: ["recordId", "type", "accountCarrier", "billingItem", "description", "details", "severity"]
      }
    },
    dataQualityIssues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of data quality issues found in either database or sheet (missing required fields, invalid values, etc.)"
    },
    statistics: {
      type: Type.OBJECT,
      properties: {
        totalDiscrepancies: { type: Type.NUMBER, description: "Total number of discrepancies" },
        added: { type: Type.NUMBER, description: "Number of added items" },
        modified: { type: Type.NUMBER, description: "Number of modified items" },
        deleted: { type: Type.NUMBER, description: "Number of deleted items" },
        dataQualityIssues: { type: Type.NUMBER, description: "Number of data quality issues" }
      },
      required: ["totalDiscrepancies", "added", "modified", "deleted", "dataQualityIssues"]
    }
  },
  required: ["summary", "discrepancies", "dataQualityIssues", "statistics"]
};

const syncDecisionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: "Brief summary of AI analysis and sync decisions"
    },
    decisions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          recordId: { 
            type: Type.STRING, 
            description: "Identifier using format: accountCarrier|||billingItem" 
          },
          shouldSync: {
            type: Type.BOOLEAN,
            description: "True if this record should be synced, false if it should be skipped"
          },
          reason: {
            type: Type.STRING,
            description: "Clear explanation for the decision"
          },
          confidence: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
            description: "Confidence in the decision"
          }
        },
        required: ["recordId", "shouldSync", "reason", "confidence"]
      }
    },
    warnings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Warnings about data quality issues or potential problems"
    },
    statistics: {
      type: Type.OBJECT,
      properties: {
        totalAnalyzed: { type: Type.NUMBER },
        willSync: { type: Type.NUMBER },
        willSkip: { type: Type.NUMBER },
        needsReview: { type: Type.NUMBER }
      },
      required: ["totalAnalyzed", "willSync", "willSkip", "needsReview"]
    }
  },
  required: ["summary", "decisions", "warnings", "statistics"]
};

const dataCleaningSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    cleanedRecords: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        description: "Cleaned record with all fields preserved"
      }
    },
    summary: {
      type: Type.STRING,
      description: "Summary of cleaning process"
    },
    issues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Data quality issues found and fixed"
    },
    statistics: {
      type: Type.OBJECT,
      properties: {
        totalRecords: { type: Type.NUMBER },
        cleaned: { type: Type.NUMBER },
        skipped: { type: Type.NUMBER },
        issuesFound: { type: Type.NUMBER }
      },
      required: ["totalRecords", "cleaned", "skipped", "issuesFound"]
    }
  },
  required: ["cleanedRecords", "summary", "issues", "statistics"]
};

/**
 * AI validates sheet data when loading - just validates, doesn't modify
 * Ensures we're pulling everything exactly as it appears in the sheet
 */
export const cleanSheetData = async (
  records: MasterRecord[]
): Promise<DataCleaningResult> => {
  if (records.length === 0) {
    return {
      cleanedRecords: [],
      summary: "No records to validate",
      issues: [],
      statistics: {
        totalRecords: 0,
        cleaned: 0,
        skipped: 0,
        issuesFound: 0
      }
    };
  }

  // Don't modify data - just validate we have everything
  // Only trim whitespace from string values (preserves data integrity)
  const validatedRecords: MasterRecord[] = records.map(record => {
    const validated: any = {};
    
    // Preserve all fields exactly as they are, only trim strings
    Object.keys(record).forEach(key => {
      const value = record[key];
      if (typeof value === 'string') {
        validated[key] = value.trim();
      } else {
        validated[key] = value; // Preserve numbers, null, etc. exactly as-is
      }
    });
    
    return validated as MasterRecord;
  });

  // AI validation for reporting (optional, doesn't block if it fails)
  let aiSummary = `Validated ${records.length} records from sheet - all data preserved exactly as-is`;
  let aiIssues: string[] = [];
  let validationCount = 0;

  if (process.env.API_KEY && records.length > 0) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sampleRecords = records.slice(0, 20);
      
      // Get all column names
      const allColumns = new Set<string>();
      records.forEach(record => {
        Object.keys(record).forEach(key => {
          if (key !== 'id') allColumns.add(key);
        });
      });
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [{
            text: `Validate that we've extracted all data correctly from the Google Sheet. Check:\n1. All columns are present\n2. Required fields (Account **CARRIER**, OTG Comp Billing item) are present\n3. Data looks complete\n\nSample records (${sampleRecords.length}):\n${JSON.stringify(sampleRecords.slice(0, 3), null, 2)}\n\nTotal records: ${records.length}\nTotal columns: ${allColumns.size}\nColumns: ${Array.from(allColumns).slice(0, 20).join(', ')}...`
          }]
        },
        config: {
          systemInstruction: "You are a data validation assistant. Verify that all data from the Google Sheet has been extracted correctly. Report if anything seems missing or incomplete. DO NOT suggest changes to the data - just validate completeness.",
          temperature: 0.1
        }
      });

      const aiText = response.text || '';
      if (aiText) {
        aiSummary = `AI Validation: ${aiText.substring(0, 300)}`;
        validationCount = records.length;
        
        // Only report critical issues (missing required fields)
        if (aiText.toLowerCase().includes('missing') && aiText.toLowerCase().includes('required')) {
          aiIssues.push('AI detected some records may be missing required fields');
        }
      }
    } catch (error) {
      // AI validation failed, continue anyway
      console.warn('AI validation failed, continuing with data as-is:', error);
      aiSummary = `Loaded ${records.length} records from sheet (AI validation unavailable)`;
    }
  }

  return {
    cleanedRecords: validatedRecords, // Actually just validated, not cleaned
    summary: aiSummary,
    issues: aiIssues,
    statistics: {
      totalRecords: records.length,
      cleaned: validationCount, // Actually validation count
      skipped: 0,
      issuesFound: aiIssues.length
    }
  };
};

/**
 * AI analyzes differences and decides what to sync automatically
 */
export const analyzeAndDecideSync = async (
  diffs: DiffItem[],
  appDataCount: number,
  sheetDataCount: number
): Promise<AISyncAnalysis> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Prepare sample of differences for analysis (limit to avoid token limits)
  const sampleDiffs = diffs
    .filter(d => d.type !== 'unchanged')
    .slice(0, 150); // Analyze first 150 differences

  const diffSummary = {
    total: diffs.filter(d => d.type !== 'unchanged').length,
    added: diffs.filter(d => d.type === 'added').length,
    modified: diffs.filter(d => d.type === 'modified').length,
    deleted: diffs.filter(d => d.type === 'deleted').length,
    appRecords: appDataCount,
    sheetRecords: sheetDataCount,
  };

  // Prepare diff data for AI analysis
  const diffData = sampleDiffs.map(diff => {
    const recordToShow = diff.type === 'added' && diff.sheetRecord ? diff.sheetRecord : diff.record;
    const accountCarrier = recordToShow['Account **CARRIER**'] || recordToShow.clientName || '';
    const billingItem = recordToShow['OTG Comp Billing item'] || '';
    const recordId = `${accountCarrier}|||${billingItem}`;
    
    // Include key field values for context
    const keyFields: Record<string, any> = {};
    const importantFields = [
      'ST', 'Service Provider', 'Status / Type', 'COMP 1', 'COMP 2', 'COMP 3', 'COMP 4',
      'Monthly Unit Price Quantity x Price QRC/SEMI//YRC x 4, 6, or 12',
      'EXPECTED/Mo. OTG Comp % - column R Comp Key',
      'Monthly Comp to OTG per EXPECTED Comp %'
    ];
    
    importantFields.forEach(field => {
      if (recordToShow[field] !== undefined && recordToShow[field] !== null && recordToShow[field] !== '') {
        keyFields[field] = recordToShow[field];
      }
    });
    
    return {
      recordId,
      type: diff.type,
      accountCarrier,
      billingItem,
      keyFields,
      changes: diff.type === 'modified' ? Object.keys(diff.changes || {}).slice(0, 10) : [],
      changeCount: diff.type === 'modified' ? Object.keys(diff.changes || {}).length : 0,
      sampleChanges: diff.type === 'modified' && diff.changes 
        ? Object.entries(diff.changes).slice(0, 5).map(([field, change]) => ({
            field,
            oldValue: String(change.old || ''),
            newValue: String(change.new || '')
          }))
        : []
    };
  });

  const systemInstruction = `
    You are an expert Data Sync AI for a commission reconciliation system.
    
    Your task is to analyze differences between Firebase database and Google Sheet, and automatically decide what should be synced.
    The Google Sheet is the source of truth - your goal is to make the database match the sheet exactly.
    
    Context:
    - This is a Comp Key (compensation key) with 62 columns tracking commission data
    - Account is uniquely identified by: Account **CARRIER** + OTG Comp Billing item
    - Critical fields: Account **CARRIER**, OTG Comp Billing item, COMP 1-4, Monthly Unit Price, EXPECTED/Mo. OTG Comp %
    - Database has ${appDataCount} records, Sheet has ${sheetDataCount} records
    
    Sync Decision Rules:
    1. **Added items** (in Sheet but not Database):
       - SYNC if: Has required fields (Account **CARRIER** and OTG Comp Billing item), complete data, valid values
       - SKIP if: Missing required fields, appears to be test/dummy data, duplicate entries, invalid data
    
    2. **Modified items** (different values):
       - SYNC if: Sheet has more complete/accurate data, corrections, valid updates
       - SKIP if: Sheet data appears incorrect (negative amounts, percentages > 100%), data corruption, missing critical fields
    
    3. **Deleted items** (in Database but not Sheet):
       - SYNC (delete from database) if: Sheet is source of truth, item should be removed
       - SKIP if: Appears to be an error, critical data that shouldn't be deleted
    
    Data Quality Checks:
    - Missing required fields (Account **CARRIER**, OTG Comp Billing item)
    - Invalid data types or values (negative amounts, percentages > 100%)
    - Duplicate accounts
    - Incomplete records
    
    For each difference, decide: shouldSync (true/false) with clear reasoning.
    Be conservative - only skip if there's a clear data quality issue.
  `;

  const prompt = `
    Analyze these differences between Firebase database (${appDataCount} records) and Google Sheet (${sheetDataCount} records):
    
    Summary:
    - Total differences: ${diffSummary.total}
    - Added (in Sheet but not Database): ${diffSummary.added}
    - Modified (different values): ${diffSummary.modified}
    - Deleted (in Database but not Sheet): ${diffSummary.deleted}
    
    Differences to analyze (${diffData.length} items):
    ${JSON.stringify(diffData, null, 2)}
    
    For each difference, decide:
    1. shouldSync: true if it should be synced, false if it should be skipped
    2. reason: Clear explanation
    3. confidence: high/medium/low based on data quality
    
    Also identify any data quality warnings.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: syncDecisionSchema,
        temperature: 0.1 // Low temperature for consistent decisions
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("No response from AI");

    const cleaned = resultText.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return parsed as AISyncAnalysis;

  } catch (error) {
    console.error("Gemini Sync Analysis Error:", error);
    throw new Error("Failed to analyze sync decisions. Please try again.");
  }
};

/**
 * Generate AI comparison report of discrepancies between database and sheet
 */
export const generateSyncReview = async (
  diffs: DiffItem[],
  appDataCount: number,
  sheetDataCount: number
): Promise<ComparisonReport> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Prepare sample of differences for analysis (limit to avoid token limits)
  const sampleDiffs = diffs
    .filter(d => d.type !== 'unchanged')
    .slice(0, 100); // Analyze first 100 differences

  const diffSummary = {
    total: diffs.filter(d => d.type !== 'unchanged').length,
    added: diffs.filter(d => d.type === 'added').length,
    modified: diffs.filter(d => d.type === 'modified').length,
    deleted: diffs.filter(d => d.type === 'deleted').length,
    appRecords: appDataCount,
    sheetRecords: sheetDataCount,
  };

  // Prepare diff data for AI analysis
  const diffData = sampleDiffs.map(diff => {
    const recordToShow = diff.type === 'added' && diff.sheetRecord ? diff.sheetRecord : diff.record;
    const accountCarrier = recordToShow['Account **CARRIER**'] || recordToShow.clientName || '';
    const billingItem = recordToShow['OTG Comp Billing item'] || '';
    const recordId = `${accountCarrier}|||${billingItem}`;
    
    // Include key field values for context
    const keyFields: Record<string, any> = {};
    const importantFields = [
      'ST', 'Service Provider', 'Status / Type', 'COMP 1', 'COMP 2', 'COMP 3', 'COMP 4',
      'Monthly Unit Price Quantity x Price QRC/SEMI//YRC x 4, 6, or 12',
      'EXPECTED/Mo. OTG Comp % - column R Comp Key',
      'Monthly Comp to OTG per EXPECTED Comp %'
    ];
    
    importantFields.forEach(field => {
      if (recordToShow[field] !== undefined && recordToShow[field] !== null && recordToShow[field] !== '') {
        keyFields[field] = recordToShow[field];
      }
    });
    
    return {
      recordId,
      type: diff.type,
      accountCarrier,
      billingItem,
      keyFields,
      changes: diff.type === 'modified' ? Object.keys(diff.changes || {}).slice(0, 10) : [],
      changeCount: diff.type === 'modified' ? Object.keys(diff.changes || {}).length : 0,
      // Include sample of changes for modified items
      sampleChanges: diff.type === 'modified' && diff.changes 
        ? Object.entries(diff.changes).slice(0, 5).map(([field, change]) => ({
            field,
            oldValue: String(change.old || ''),
            newValue: String(change.new || '')
          }))
        : []
    };
  });

  const systemInstruction = `
    You are an expert Data Comparison AI for a commission reconciliation system.
    
    Your task is to analyze and report discrepancies between the Firebase database and Google Sheet data.
    DO NOT provide recommendations or suggestions - only factual comparisons and discrepancies.
    
    Context:
    - This is a Comp Key (compensation key) with 62 columns tracking commission data
    - Account is uniquely identified by: Account **CARRIER** + OTG Comp Billing item
    - Critical fields: Account **CARRIER**, OTG Comp Billing item, COMP 1-4, Monthly Unit Price, EXPECTED/Mo. OTG Comp %
    - Database has ${appDataCount} records, Sheet has ${sheetDataCount} records
    
    Your job is to:
    1. Identify and describe discrepancies factually
    2. Note data quality issues in either source
    3. Categorize discrepancies by type (added, modified, deleted)
    4. Assess severity based on which fields changed (critical fields = high severity)
    5. Provide clear, factual descriptions without recommendations
    
    For each discrepancy, describe:
    - What is different (specific field changes for modified items)
    - Where it exists (database vs sheet)
    - Severity based on field importance (COMP fields, amounts, percentages = high)
    
    Be objective and factual - no recommendations, just comparisons.
  `;

  const prompt = `
    Compare these discrepancies between Firebase database (${appDataCount} records) and Google Sheet (${sheetDataCount} records):
    
    Summary:
    - Total discrepancies: ${diffSummary.total}
    - Added (in Sheet but not Database): ${diffSummary.added}
    - Modified (different values between Database and Sheet): ${diffSummary.modified}
    - Deleted (in Database but not Sheet): ${diffSummary.deleted}
    
    Sample Discrepancies (${diffData.length} items):
    ${JSON.stringify(diffData, null, 2)}
    
    For each discrepancy, provide:
    1. Type (added/modified/deleted)
    2. Account name and billing item
    3. Clear description of what's different
    4. Detailed explanation including specific field changes for modified items
    5. Severity assessment (high = critical fields like COMP, amounts, percentages changed; medium = important fields; low = minor fields)
    
    Also identify any data quality issues in either the database or sheet (missing required fields, invalid values, etc.).
    
    Be factual and objective - describe what IS different, not what SHOULD be done.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: comparisonSchema,
        temperature: 0.1 // Lower temperature for factual reporting
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("No response from AI");

    const cleaned = resultText.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return parsed as ComparisonReport;

  } catch (error) {
    console.error("Gemini Sync Review Error:", error);
    throw new Error("Failed to generate AI review. Please try again.");
  }
};
