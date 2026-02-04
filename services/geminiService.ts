import { GoogleGenAI, Type, Schema } from "@google/genai";
import { MasterRecord, AnalysisResult } from "../types";

// Helper to clean Markdown code blocks from JSON strings
const cleanJsonString = (text: string): string => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "");
  cleaned = cleaned.replace(/```\s*/g, "");
  return cleaned.trim();
};

// Schema for Column Mapping
const mappingSchema: Schema = {
  type: Type.OBJECT,
  description: "Mapping of internal field names to the keys/headers found in the provided data sample.",
  properties: {
    clientName: { type: Type.STRING, description: "The header/key for Client Name (e.g. 'Customer', 'Client', 'Name')" },
    serviceType: { type: Type.STRING, description: "The header/key for Service (e.g. 'Product', 'Item', 'Service')" },
    salesperson: { type: Type.STRING, description: "The header/key for Salesperson (e.g. 'Rep', 'Agent', 'Sales')" },
    expectedAmount: { type: Type.STRING, description: "The header/key for Revenue/Amount (e.g. 'Price', 'MRR', 'Value')" },
    splitPercentage: { type: Type.STRING, description: "The header/key for Commission Split (e.g. 'Split', 'Comm %')" }
  },
  required: ["clientName", "serviceType", "salesperson", "expectedAmount", "splitPercentage"]
};

// Schema for Seller Statement Column Detection
const sellerStatementColumnSchema: Schema = {
  type: Type.OBJECT,
  description: "Column mapping for seller statement sheets (RD1/2, RD3/4, etc.)",
  properties: {
    accountName: {
      type: Type.STRING,
      description: "Column name or index (0-based) for Account Name/Client Name/Customer Name"
    },
    otgCompBillingItem: {
      type: Type.STRING,
      description: "Column name or index (0-based) for OTG Comp Billing Item/Service Number/Billing Item"
    },
    otgComp: {
      type: Type.STRING,
      description: "Column name or index (0-based) for OTG Comp/Commission Amount/OTG Commission"
    },
    sellerComp: {
      type: Type.STRING,
      description: "Column name or index (0-based) for Seller Comp/Seller Commission/Role Comp"
    },
    state: {
      type: Type.STRING,
      nullable: true,
      description: "Column name or index (0-based) for State/ST/State Code (optional)"
    }
  },
  required: ["accountName", "otgCompBillingItem", "otgComp", "sellerComp"]
};

// Schema for Commission Analysis
const analysisSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    processedItems: {
      type: Type.ARRAY,
      description: "List of all line items found in the vendor statement, matched against master data.",
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "Date of transaction (YYYY-MM-DD)" },
          vendor: { type: Type.STRING, description: "Vendor name" },
          clientName: { type: Type.STRING, description: "Client name on statement" },
          serviceDescription: { type: Type.STRING, description: "Description of service" },
          amountReceived: { type: Type.NUMBER, description: "Amount paid by vendor" },
          matchedMasterId: { type: Type.STRING, description: "ID of the matching Master Record, or null if no match", nullable: true },
          salesperson: { type: Type.STRING, description: "Salesperson name from Master Record (if matched)", nullable: true },
          commissionAmount: { type: Type.NUMBER, description: "Calculated commission based on split rules" },
          discrepancyType: { 
            type: Type.STRING, 
            enum: ['Matched', 'Missing Payment', 'Amount Mismatch', 'Unknown Service', 'Duplicate'],
            description: "Status of the match"
          },
          explanation: { type: Type.STRING, description: "Reason for the status or discrepancy" },
        },
        required: ["date", "vendor", "clientName", "amountReceived", "commissionAmount", "discrepancyType", "explanation"]
      }
    },
    missingFromStatementIds: {
      type: Type.ARRAY,
      description: "List of IDs from the Master Data that were NOT found in the statement.",
      items: { type: Type.STRING }
    },
    summary: {
      type: Type.STRING,
      description: "A brief executive summary of the analysis."
    }
  },
  required: ["processedItems", "missingFromStatementIds", "summary"]
};

/**
 * Detects seller statement columns using AI analysis
 * Analyzes sheet headers and sample rows to identify which columns map to required fields
 * 
 * @param headers - Array of column header names from the sheet
 * @param sampleRows - Array of sample data rows (first 5-10 rows recommended)
 * @returns Column mapping object with column names/indices
 */
export const detectSellerStatementColumns = async (
  headers: string[],
  sampleRows: any[][]
): Promise<{
  accountName: string;
  otgCompBillingItem: string;
  otgComp: string;
  sellerComp: string;
  state?: string | null;
}> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
You are a Column Detection Assistant for seller statement sheets.
Your task is to analyze the headers and sample rows from a seller statement sheet (like RD1/2, RD3/4, RM1/2, etc.)
and identify which columns correspond to the required fields.

CRITICAL: Look at the actual DATA VALUES in the sample rows to understand what each column contains, not just the header names.

Required fields to detect:
1. **accountName**: Account Name, Client Name, Customer Name, Account, Customer, Client, Company Name
   - Look for columns containing company/account names (text values)
   
2. **otgCompBillingItem**: OTG Comp Billing Item, Billing Item, Service Number, Billing Item Number, Service ID, Item Number, Billing Item #
   - Look for columns containing service/billing item identifiers (alphanumeric codes)
   
3. **otgComp**: OTG Comp, Commission Amount, OTG Commission, Total Commission, Commission, OTG Comp $, Commission Amount $
   - Look for columns containing commission amounts (numeric values, usually currency)
   - This is the TOTAL commission amount
   
4. **sellerComp**: Seller Comp, Seller Commission, Role Comp, Comp, Seller Amount, Seller Comp $, Role Commission
   - Look for columns containing seller/role commission amounts (numeric values, usually currency)
   - This is the portion of commission that goes to the seller/role
   - May be labeled as "RD1", "RD2", "RM1", etc. or "Seller Comp" or "Role Comp"
   
5. **state** (optional): State, ST, State Code, State Abbreviation
   - Look for 2-letter state codes or full state names

IMPORTANT:
- Return the EXACT column name as it appears in the headers array (case-sensitive match)
- If exact match fails, return the column index as a string (e.g., "0", "1", "2")
- Analyze the sample data values to confirm column meanings
- For sellerComp, look for columns that contain commission splits or role-specific amounts
- If sellerComp column is not clearly labeled, look for columns that contain smaller amounts than otgComp (seller comp is usually a portion of otg comp)
`;

  // Prepare sample data (limit to first 10 rows to avoid token limits)
  const limitedSampleRows = sampleRows.slice(0, 10);
  const headersList = headers.map((h, idx) => `[${idx}] ${h || '(empty)'}`).join(", ");
  const sampleDataJson = JSON.stringify(limitedSampleRows, null, 2);

  const prompt = `
Analyze this seller statement sheet to detect column mappings.

Sheet Headers (${headers.length} columns):
${headersList}

Sample Data Rows (first ${limitedSampleRows.length} rows):
${sampleDataJson}

Please identify which columns map to:
- accountName: Account Name/Client Name/Customer Name
- otgCompBillingItem: OTG Comp Billing Item/Service Number/Billing Item
- otgComp: OTG Comp/Commission Amount/OTG Commission
- sellerComp: Seller Comp/Seller Commission/Role Comp
- state (optional): State/ST/State Code

Return column names (exact match from headers) or indices (0-based numbers as strings).
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
        responseSchema: sellerStatementColumnSchema,
        temperature: 0.1 // Low temperature for consistent detection
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(cleanJsonString(resultText));
    return parsed;

  } catch (error: any) {
    console.error("Seller Statement Column Detection Error:", error);
    throw new Error(`Failed to detect columns: ${error.message}`);
  }
};

/**
 * Gets the column mapping from a small sample of data.
 * This avoids sending large files to the LLM.
 */
export const getColumnMapping = async (sampleData: string): Promise<Record<string, string>> => {
  if (!process.env.API_KEY) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
    You are a Data Mapping Assistant.
    Analyze the provided JSON sample (representing rows from a spreadsheet).
    Identify which keys or headers correspond to the required internal fields:
    - clientName
    - serviceType
    - salesperson
    - expectedAmount
    - splitPercentage
    
    Return a JSON object where the key is the internal field name and the value is the header name from the sample.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [{ text: `Here is the data sample:\n${sampleData}` }]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: mappingSchema,
        temperature: 0.1
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("No response from AI");
    
    return JSON.parse(cleanJsonString(resultText));

  } catch (error) {
    console.error("Gemini Mapping Error:", error);
    throw new Error("Failed to map data columns.");
  }
};

/**
 * Fallback: Parses Master Data from a file (PDF/Image) where local parsing isn't possible.
 * Should only be used for unstructured files.
 */
export const parseMasterDataUnstructured = async (
  fileBase64: string,
  mimeType: string
): Promise<Omit<MasterRecord, 'id'>[]> => {
  if (!process.env.API_KEY) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Use a looser schema for direct extraction
  const directExtractSchema: Schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          clientName: { type: Type.STRING },
          serviceType: { type: Type.STRING },
          salesperson: { type: Type.STRING },
          expectedAmount: { type: Type.NUMBER },
          splitPercentage: { type: Type.NUMBER }
        }
      }
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { text: "Extract master records from this document." },
          { inlineData: { mimeType, data: fileBase64 } }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: directExtractSchema
      }
    });
    
    return JSON.parse(cleanJsonString(response.text || "[]"));
  } catch (error) {
    throw new Error("Failed to parse unstructured file.");
  }
};

/**
 * Analyzes the Vendor Statement.
 */
export const analyzeStatement = async (
  data: string,
  mimeType: string,
  masterData: MasterRecord[],
  isBinary: boolean = true
): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
    You are an expert Commission Auditor AI. 
    Your goal is to reconcile a Vendor Statement against an internal Master Service List (JSON provided).
    
    Rules:
    1. Extract every transaction line item from the Vendor Statement data.
    2. Fuzzy match each transaction to the Master Service List based on Client Name and Service Type.
    3. Calculate Commission: If matched, Commission = AmountReceived * MasterRecord.SplitPercentage. If not matched, Commission = 0.
    4. Identify Discrepancies:
       - 'Matched': Amounts match (within $0.05 tolerance).
       - 'Amount Mismatch': Matched client/service, but AmountReceived != MasterRecord.ExpectedAmount.
       - 'Unknown Service': Item in statement but not in Master List.
       - 'Duplicate': Same transaction appears twice.
    5. Identify Missing Payments: Check which Active Master Records are NOT present in the statement.
    
    Return a strict JSON object following the defined schema.
  `;

  const masterDataString = JSON.stringify(masterData, null, 2);

  const prompt = `
    Here is the Master Service List (Internal Records):
    ${masterDataString}

    Please analyze the attached Vendor Statement data.
  `;

  let contentPart;
  if (isBinary) {
    contentPart = { inlineData: { mimeType, data } };
  } else {
    // If text is too long, we might still hit limits here, but 
    // usually vendor statements are smaller than master DBs or handled differently.
    // For now we keep this as is, but robust production apps might chunk this too.
    contentPart = { text: `Here is the statement content:\n${data.slice(0, 100000)}` }; // Safety slice
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { text: prompt },
          contentPart
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
        temperature: 0.1 
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("No response from AI");

    const parsed = JSON.parse(cleanJsonString(resultText));
    
    // Post-process to re-hydrate the full Master Records for the "missing" list based on IDs returned
    const missingRecords = masterData.filter(r => 
      parsed.missingFromStatementIds.includes(r.id)
    );

    // Assign IDs to processed items for React keys
    const processedItemsWithIds = parsed.processedItems.map((item: any, idx: number) => ({
      ...item,
      id: `proc-${idx}-${Date.now()}`
    }));

    return {
      processedItems: processedItemsWithIds,
      missingFromStatement: missingRecords,
      summary: parsed.summary
    };

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw new Error("Failed to analyze the statement. Ensure the file is readable and try again.");
  }
};