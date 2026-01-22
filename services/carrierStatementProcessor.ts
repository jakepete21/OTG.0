import { GoogleGenAI, Type, Schema } from "@google/genai";
import { CarrierStatementRow } from "../types";
import { MasterRecord } from "../types";
import * as XLSX from 'xlsx';
import { CarrierType, detectCarrierFromFilename } from "./monthDetection";
import { extractZayoData } from "./carrierExtractors/zayoExtractor";
import { extractGoToData } from "./carrierExtractors/gotoExtractor";
import { extractLumenData } from "./carrierExtractors/lumenExtractor";
import { extractMetTelData } from "./carrierExtractors/mettelExtractor";
import { extractTBOData } from "./carrierExtractors/tboExtractor";
import { extractAllstreamData } from "./carrierExtractors/allstreamExtractor";
import { getStateForBillingItem } from "./stateLookup";

// Helper to clean Markdown code blocks from JSON strings
const cleanJsonString = (text: string): string => {
  if (!text) return "[]";
  let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "");
  cleaned = cleaned.replace(/```\s*/g, "");
  return cleaned.trim();
};

// Schema for carrier statement extraction
const carrierStatementSchema: Schema = {
  type: Type.ARRAY,
  description: "Extracted carrier statement rows",
  items: {
    type: Type.OBJECT,
    properties: {
      state: { type: Type.STRING, description: "State abbreviation (e.g., 'CA', 'NY')", nullable: true },
      accountName: { type: Type.STRING, description: "Account name or customer name" },
      accountNumber: { type: Type.STRING, description: "Account number or BAN", nullable: true },
      otgCompBillingItem: { type: Type.STRING, description: "OTG Comp Billing item (service identifier)" },
      invoiceTotal: { type: Type.NUMBER, description: "Invoice total amount" },
      commissionAmount: { type: Type.NUMBER, description: "Commission amount" },
      provider: { type: Type.STRING, description: "Service provider name", nullable: true },
      billDescription: { type: Type.STRING, description: "Bill description", nullable: true },
      billPeriod: { type: Type.STRING, description: "Bill/Invoice period", nullable: true },
    },
    required: ["accountName", "otgCompBillingItem", "invoiceTotal", "commissionAmount"]
  }
};

/**
 * Detects carrier type from filename or content
 * @deprecated Use detectCarrierFromFilename from monthDetection instead
 */
export const detectCarrier = (filename: string): string => {
  const carrier = detectCarrierFromFilename(filename);
  return carrier || 'Unknown';
};

/**
 * Extracts carrier statement data from XLSX file using carrier-specific extractors
 * Falls back to AI extraction if carrier-specific extractor not available
 */
export const extractCarrierStatementData = async (
  file: File,
  masterData?: MasterRecord[]
): Promise<CarrierStatementRow[]> => {
  const carrier = detectCarrierFromFilename(file.name);
  
  if (!carrier) {
    throw new Error(`Could not detect carrier type from filename: ${file.name}`);
  }
  
  // Read file as array buffer
  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

  // Parse workbook
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  
  console.log(`Processing ${carrier} statement: ${file.name}`);
  console.log(`Workbook parsed: ${workbook.SheetNames.length} sheets found`);
  
  let rows: CarrierStatementRow[] = [];
  
  // Create state lookup function
  const stateLookupFn = (billingItem: string): string => {
    if (masterData && masterData.length > 0) {
      return getStateForBillingItem(billingItem, masterData);
    }
    return '';
  };
  
  try {
    // Use carrier-specific extractor
    switch (carrier) {
      case 'Zayo':
        rows = await extractZayoData(workbook, stateLookupFn);
        break;
      case 'GoTo':
        rows = await extractGoToData(workbook);
        // Lookup states from master data
        if (masterData && masterData.length > 0) {
          rows = rows.map(row => ({
            ...row,
            state: row.state || stateLookupFn(row.otgCompBillingItem),
          }));
        }
        break;
      case 'Lumen':
        rows = await extractLumenData(workbook);
        // Lookup states from master data
        if (masterData && masterData.length > 0) {
          rows = rows.map(row => ({
            ...row,
            state: row.state || stateLookupFn(row.otgCompBillingItem),
          }));
        }
        break;
      case 'MetTel':
        rows = await extractMetTelData(workbook);
        // Lookup states from master data
        if (masterData && masterData.length > 0) {
          rows = rows.map(row => ({
            ...row,
            state: row.state || stateLookupFn(row.otgCompBillingItem),
          }));
        }
        break;
      case 'TBO':
        rows = await extractTBOData(workbook);
        // Lookup states from master data
        if (masterData && masterData.length > 0) {
          rows = rows.map(row => ({
            ...row,
            state: row.state || stateLookupFn(row.otgCompBillingItem),
          }));
        }
        break;
      case 'Allstream':
        rows = await extractAllstreamData(workbook);
        // Lookup states from master data
        if (masterData && masterData.length > 0) {
          rows = rows.map(row => ({
            ...row,
            state: row.state || stateLookupFn(row.otgCompBillingItem),
          }));
        }
        break;
      default:
        throw new Error(`No extractor available for carrier: ${carrier}`);
    }
    
    console.log(`Extracted ${rows.length} rows using ${carrier} extractor`);
    
  } catch (error) {
    console.error(`Error using carrier-specific extractor for ${carrier}:`, error);
    // Fallback to AI extraction if carrier-specific extractor fails
    console.log(`Falling back to AI extraction...`);
    rows = await extractWithAI(workbook, carrier);
  }
  
  // Filter out rows without required fields
  const validRows = rows.filter(row => {
    const isValid = row.accountName && 
                    row.otgCompBillingItem && 
                    typeof row.invoiceTotal === 'number' &&
                    typeof row.commissionAmount === 'number';
    
    if (!isValid) {
      console.warn('Filtered out invalid row:', {
        accountName: row.accountName,
        otgCompBillingItem: row.otgCompBillingItem,
        invoiceTotal: row.invoiceTotal,
        commissionAmount: row.commissionAmount,
      });
    }
    
    return isValid;
  });

  console.log(`Total valid rows: ${validRows.length}`);

  return validRows;
};

/**
 * Fallback AI extraction (used when carrier-specific extractor fails)
 */
const extractWithAI = async (
  workbook: XLSX.WorkBook,
  carrier: string
): Promise<CarrierStatementRow[]> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing for AI fallback extraction.");
  }

  const allRows: CarrierStatementRow[] = [];
  const sheetsToProcess = carrier === 'GoTo' 
    ? workbook.SheetNames 
    : [workbook.SheetNames[0]];

  for (const sheetName of sheetsToProcess) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    let dataToSend: string;
    let extractionMethod = 'json';
    
    try {
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
      
      if (Array.isArray(jsonData) && jsonData.length > 0) {
        const sample = jsonData.slice(0, 100);
        dataToSend = JSON.stringify(sample, null, 2);
      } else {
        const csvData = XLSX.utils.sheet_to_csv(worksheet);
        if (csvData && csvData.length > 0) {
          dataToSend = csvData.length > 50000 
            ? csvData.slice(0, 50000) + '\n... (truncated)'
            : csvData;
          extractionMethod = 'csv';
        } else {
          continue;
        }
      }
    } catch (error) {
      console.error(`Error preparing data from sheet ${sheetName}:`, error);
      continue;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const systemInstruction = `
      You are an expert data extraction AI for carrier commission statements.
      Extract all commission rows from the carrier statement data.
      
      Key fields to extract:
      - State: State abbreviation (CA, NY, etc.) - may be missing
      - Account Name: Customer/account name
      - Account Number: Account number or BAN - may be missing
      - OTG Comp Billing item: Service identifier/billing item code (CRITICAL - must match exactly)
      - Invoice Total: Total invoice amount (convert to number, remove $ and commas)
      - Commission Amount: Commission amount paid (convert to number, remove $ and commas)
      - Provider: Service provider name (may be in header or separate column)
      - Bill Description: Description of the service/bill
      - Bill Period: Billing period (may be in header or per row)
      
      Rules:
      1. Extract EVERY row that has commission data - do not skip any rows
      2. Skip ONLY header rows, footer totals, and completely empty rows
      3. Normalize amounts: remove $, commas, convert to numbers (e.g., "$1,234.56" -> 1234.56)
      4. Preserve OTG Comp Billing item EXACTLY as shown (this is a critical matching key)
      5. If a field is missing, use empty string or null
      6. Return ALL valid commission rows, not just a sample
      7. If carrier is "${carrier}", adapt to carrier-specific column names/patterns
    `;

    try {
      const promptText = extractionMethod === 'json'
        ? `Extract carrier statement rows from this ${carrier} statement (JSON format). Extract ALL rows with commission data.\n\nData:\n${dataToSend}`
        : `Extract carrier statement rows from this ${carrier} statement (CSV format). Extract ALL rows with commission data.\n\nCSV Data:\n${dataToSend}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { text: promptText }
          ]
        },
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: carrierStatementSchema,
          temperature: 0.1
        }
      });

      const resultText = response.text;
      if (!resultText) continue;

      let parsed: any[];
      try {
        const cleaned = cleanJsonString(resultText);
        parsed = JSON.parse(cleaned);
        
        if (!Array.isArray(parsed)) {
          continue;
        }
      } catch (parseError) {
        console.error(`Error parsing AI response for sheet ${sheetName}:`, parseError);
        continue;
      }
      
      const rowsWithCarrier = parsed.map((row: any) => ({
        ...row,
        carrierStatement: carrier,
        state: row.state || '',
        accountNumber: row.accountNumber || '',
        provider: row.provider || '',
        billDescription: row.billDescription || '',
        billPeriod: row.billPeriod || '',
      }));

      allRows.push(...rowsWithCarrier);

    } catch (error) {
      console.error(`Error extracting from sheet ${sheetName}:`, error);
    }
  }

  return allRows;
};
