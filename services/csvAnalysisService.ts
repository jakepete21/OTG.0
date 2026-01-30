import { GoogleGenAI, Type, Schema } from "@google/genai";

// Helper to clean Markdown code blocks from JSON strings
const cleanJsonString = (text: string): string => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "");
  cleaned = cleaned.replace(/```\s*/g, "");
  return cleaned.trim();
};

// Schema for CSV Analysis Response
const csvAnalysisSchema: Schema = {
  type: Type.OBJECT,
  description: "Analysis of master data CSV file including column importance, data quality issues, and cleaning suggestions",
  properties: {
    essentialColumns: {
      type: Type.ARRAY,
      description: "Columns that are critical for commission matching and calculations",
      items: {
        type: Type.OBJECT,
        properties: {
          columnName: { type: Type.STRING, description: "Exact column name from CSV" },
          reason: { type: Type.STRING, description: "Why this column is essential" },
          mapsTo: { 
            type: Type.STRING, 
            description: "Maps to MasterRecord field (e.g., 'clientName', 'otgCompBillingItem', 'custom')",
            nullable: true 
          }
        },
        required: ["columnName", "reason"]
      }
    },
    optionalColumns: {
      type: Type.ARRAY,
      description: "Columns that are nice-to-have but not essential",
      items: {
        type: Type.OBJECT,
        properties: {
          columnName: { type: Type.STRING, description: "Exact column name from CSV" },
          reason: { type: Type.STRING, description: "Why this column is optional" }
        },
        required: ["columnName", "reason"]
      }
    },
    dataQualityIssues: {
      type: Type.ARRAY,
      description: "Data quality problems found in the CSV",
      items: {
        type: Type.OBJECT,
        properties: {
          issue: { type: Type.STRING, description: "Description of the issue" },
          severity: { 
            type: Type.STRING, 
            enum: ["critical", "warning", "info"],
            description: "Severity level of the issue"
          },
          affectedColumns: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Column names affected by this issue"
          },
          affectedRows: {
            type: Type.NUMBER,
            description: "Approximate number of rows affected (0 if unknown)",
            nullable: true
          },
          recommendation: { 
            type: Type.STRING, 
            description: "How to fix this issue",
            nullable: true 
          }
        },
        required: ["issue", "severity"]
      }
    },
    columnMapping: {
      type: Type.OBJECT,
      description: "Mapping of CSV columns to MasterRecord fields",
      properties: {
        clientName: { type: Type.STRING, nullable: true, description: "CSV column for Account **CARRIER**" },
        serviceType: { type: Type.STRING, nullable: true, description: "CSV column for Service Provider" },
        salesperson: { type: Type.STRING, nullable: true, description: "CSV column for COMP 1 (primary salesperson)" },
        expectedAmount: { type: Type.STRING, nullable: true, description: "CSV column for Monthly Unit Price" },
        splitPercentage: { type: Type.STRING, nullable: true, description: "CSV column for EXPECTED/Mo. OTG Comp %" },
        otgCompBillingItem: { type: Type.STRING, nullable: true, description: "CSV column for OTG Comp Billing item" },
        state: { type: Type.STRING, nullable: true, description: "CSV column for ST (State)" }
      }
    },
    cleaningSuggestions: {
      type: Type.ARRAY,
      description: "Specific cleaning operations to perform on the data",
      items: {
        type: Type.OBJECT,
        properties: {
          operation: { 
            type: Type.STRING, 
            enum: ["remove_duplicates", "normalize_values", "fix_data_types", "remove_empty_rows", "standardize_format", "merge_columns"],
            description: "Type of cleaning operation"
          },
          description: { type: Type.STRING, description: "What this operation does" },
          columns: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Columns affected by this operation"
          },
          priority: {
            type: Type.STRING,
            enum: ["high", "medium", "low"],
            description: "Priority of this cleaning operation"
          }
        },
        required: ["operation", "description", "priority"]
      }
    },
    duplicateDetection: {
      type: Type.OBJECT,
      description: "Information about duplicate records",
      properties: {
        method: {
          type: Type.STRING,
          description: "How to identify duplicates (e.g., 'Account **CARRIER** + OTG Comp Billing item')"
        },
        estimatedDuplicates: {
          type: Type.NUMBER,
          description: "Estimated number of duplicate records",
          nullable: true
        },
        recommendation: {
          type: Type.STRING,
          description: "How to handle duplicates",
          nullable: true
        }
      },
      required: ["method"]
    },
    dataNormalization: {
      type: Type.ARRAY,
      description: "Values that need standardization",
      items: {
        type: Type.OBJECT,
        properties: {
          column: { type: Type.STRING, description: "Column name" },
          currentValues: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Sample of current values that need normalization"
          },
          standardFormat: { type: Type.STRING, description: "Desired standard format" },
          examples: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                from: { type: Type.STRING, description: "Current value" },
                to: { type: Type.STRING, description: "Normalized value" }
              }
            }
          }
        },
        required: ["column", "currentValues", "standardFormat"]
      }
    },
    summary: {
      type: Type.STRING,
      description: "Overall summary of the CSV analysis"
    }
  },
  required: ["essentialColumns", "optionalColumns", "dataQualityIssues", "columnMapping", "cleaningSuggestions", "duplicateDetection", "summary"]
};

export interface CSVAnalysis {
  essentialColumns: Array<{
    columnName: string;
    reason: string;
    mapsTo?: string | null;
  }>;
  optionalColumns: Array<{
    columnName: string;
    reason: string;
  }>;
  dataQualityIssues: Array<{
    issue: string;
    severity: "critical" | "warning" | "info";
    affectedColumns?: string[];
    affectedRows?: number | null;
    recommendation?: string | null;
  }>;
  columnMapping: {
    clientName?: string | null;
    serviceType?: string | null;
    salesperson?: string | null;
    expectedAmount?: string | null;
    splitPercentage?: string | null;
    otgCompBillingItem?: string | null;
    state?: string | null;
  };
  cleaningSuggestions: Array<{
    operation: "remove_duplicates" | "normalize_values" | "fix_data_types" | "remove_empty_rows" | "standardize_format" | "merge_columns";
    description: string;
    columns?: string[];
    priority: "high" | "medium" | "low";
  }>;
  duplicateDetection: {
    method: string;
    estimatedDuplicates?: number | null;
    recommendation?: string | null;
  };
  dataNormalization: Array<{
    column: string;
    currentValues: string[];
    standardFormat: string;
    examples?: Array<{ from: string; to: string }>;
  }>;
  summary: string;
}

/**
 * Analyzes a master data CSV file using Gemini AI to understand its structure,
 * identify essential columns, detect data quality issues, and suggest cleaning operations.
 * 
 * @param csvContent - The full CSV content as a string
 * @param headers - Array of CSV header names
 * @param sampleRows - Array of sample data rows (first 10-20 rows recommended)
 * @returns CSVAnalysis object with analysis results
 */
export const analyzeMasterDataCSV = async (
  csvContent: string,
  headers: string[],
  sampleRows: any[]
): Promise<CSVAnalysis> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please set API_KEY in environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
You are an expert Data Analyst specializing in commission reconciliation systems.
Your task is to analyze a master data CSV file and provide comprehensive insights about its structure, data quality, and cleaning needs.

Key Context:
- This CSV contains master service records used for commission matching
- Account grouping uses: "Account **CARRIER**" + "OTG Comp Billing item" as unique identifier
- Essential fields for matching: Account **CARRIER**, OTG Comp Billing item, COMP 1-4, Monthly Unit Price, EXPECTED/Mo. OTG Comp %
- The system matches carrier statements against this master data using exact match on "OTG Comp Billing item"

Your analysis should:
1. Identify which columns are ESSENTIAL vs OPTIONAL for commission matching
2. Detect data quality issues (missing values, inconsistencies, format problems)
3. Suggest column mappings to MasterRecord structure
4. Recommend cleaning operations (remove duplicates, normalize values, fix data types)
5. Identify duplicate records and how to detect them
6. Suggest data normalization for inconsistent values

Be thorough and specific in your analysis.
`;

  // Prepare sample data for analysis (limit to avoid token limits)
  const sampleDataJson = JSON.stringify(sampleRows.slice(0, 20), null, 2);
  const headersList = headers.join(", ");

  const prompt = `
Analyze this master data CSV file for a commission reconciliation system.

CSV Headers (${headers.length} columns):
${headersList}

Sample Data (first ${Math.min(sampleRows.length, 20)} rows):
${sampleDataJson}

Total Rows in CSV: ${sampleRows.length > 20 ? "More than 20 (showing first 20)" : sampleRows.length}

Please provide a comprehensive analysis including:
1. Essential columns (critical for matching and calculations)
2. Optional columns (nice-to-have but not essential)
3. Data quality issues (missing values, inconsistencies, errors)
4. Column mapping to MasterRecord structure
5. Cleaning suggestions (operations to perform)
6. Duplicate detection strategy
7. Data normalization needs

Focus especially on:
- Account **CARRIER** (client name)
- OTG Comp Billing item (matching key)
- COMP 1-4 (role splits)
- Monthly Unit Price (expected amount)
- EXPECTED/Mo. OTG Comp % (split percentage)
- ST (State)
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
        responseSchema: csvAnalysisSchema,
        temperature: 0.1 // Low temperature for consistent analysis
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(cleanJsonString(resultText));
    return parsed as CSVAnalysis;

  } catch (error: any) {
    console.error("CSV Analysis Error:", error);
    throw new Error(`Failed to analyze CSV: ${error.message}`);
  }
};
