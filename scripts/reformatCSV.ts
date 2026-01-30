import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env.local file
function loadEnv() {
  const envPath = path.join(__dirname, '../.env.local');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });
  return env;
}

const env = loadEnv();
process.env.GEMINI_API_KEY = env.GEMINI_API_KEY || env.API_KEY;

const CSV_FILE_PATH = path.join(__dirname, '../OTG.0 Comp Key AFTER 07_2025 - NEW Comp Key - 20260115_160812.csv');

// Expected column order from MasterDataList.tsx
const EXPECTED_COLUMN_ORDER = [
  'ST',
  'Account **CARRIER**',
  'Carrier Comp Type OTG PDNG OTG ADD OTG - Zayo = zMAP NEW = On comp statement PDNG in Monday',
  'Carrier Relationship',
  'Service Provider',
  'Status / Type',
  'Opportunity "Promo Year" **KEEP ORIGINAL OPP**',
  'Promo Year Revenue / OG SF Opp zMAP = anything new to OTG **KEEP ORIGINAL OPP**',
  'Install Date OR OTG payable Date',
  'OTG Comp Billing item',
  'Cust. ACTIVE BAN',
  'Historic BAN - non-ZNS',
  'Item Desc. from current Carrier Statement',
  'PAYING Monthly Comp % to OTG from current Carrier Statement',
  'Quantity',
  'Price',
  'Monthly Unit Price Quantity x Price QRC/SEMI//YRC x 4, 6, or 12',
  'EXPECTED/Mo. OTG Comp % - column R Comp Key',
  'Monthly Comp to OTG per EXPECTED Comp %',
  'One-Time Unit Price / SPIFF',
  'One-Time Comp % to OTG',
  'One-Time Comp Expected to OTG',
  'Cust. Billed Type',
  'COMP 1',
  'COMP 2',
  'COMP 3',
  'COMP 4',
  'before 07/2025 COMP 1',
  'before 07/2025 COMP 2',
  'before 07/2025 COMP 3',
  'before 07/2025 COMP 4',
  'NOTES RED Highlight = Differs from before comp key',
  'MISSING OTG COMP',
  'SVC Change Date',
  'Prev. Unit Price',
  'OTG Compensable Product NAME',
  'MISSING MONDAY',
  'Sig Date',
  'Term',
  'Location Name',
  'Service Address',
  'Order #',
  'Circuit ID',
  'Unique Order Details SOC / SC',
  'TED',
  'Renewal Details',
  'Monday Product Comments - EXCLUDE SPLIT NOTES/VALUES',
  'Monday Item ID',
  'COMP CALC Mo. OTG RCVD Funds>>',
  'OTG PD since July Seller Statemen June Deposit',
  'July Seller Statement - June Deposit',
  'Aug Seller Stmt - July Deposit',
  'Sept Seller Stmt - Aug Deposit',
  'Oct Seller Stmt - Sept Deposit',
  'Nov Seller Stmt - Oct Deposit',
  'Dec Seller Stmt - Nov Deposit',
  'Jan Seller Stmt - Dec Deposit',
  'Feb Seller Stmt - Jan Deposit',
  'Mar Seller Stmt - Feb Deposit',
  'Apr Seller Stmt - Mar Deposit',
  'May Seller Stmt - Apr Deposit',
  'June Seller Stmt - May Deposit'
];

// Helper to normalize header names (matches MasterDataList normalization)
function normalizeHeader(header: string): string {
  return header.trim().replace(/^"|"$/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// Helper to match headers (case-insensitive, handles variations)
function headersMatch(header1: string, header2: string): boolean {
  const norm1 = normalizeHeader(header1).toLowerCase();
  const norm2 = normalizeHeader(header2).toLowerCase();
  return norm1 === norm2;
}

async function analyzeCSVStructure(headers: string[], sampleRows: any[]): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or API_KEY not found in environment variables');
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
I have a CSV file with multi-line headers that need to be reformatted. The headers are currently split across multiple lines and need to be consolidated into single-line headers.

Current Headers (${headers.length} columns, may be split across lines):
${headers.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Sample Data (first 3 rows):
${JSON.stringify(sampleRows.slice(0, 3), null, 2)}

Expected Column Order (62 columns):
${EXPECTED_COLUMN_ORDER.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Please analyze the current headers and map them to the expected column order. Return a JSON array of the current header names in the correct order, matching them to the expected columns. If a column doesn't exist in the current CSV, use null for that position.

Return format: ["header1", "header2", null, "header3", ...]
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    const result = JSON.parse(response.text);
    return result;
  } catch (error: any) {
    console.error('Gemini analysis error:', error);
    // Fallback: try to match headers manually
    return matchHeadersManually(headers);
  }
}

function matchHeadersManually(currentHeaders: string[]): string[] {
  const normalizedCurrent = currentHeaders.map(h => normalizeHeader(h).toLowerCase());
  const normalizedExpected = EXPECTED_COLUMN_ORDER.map(h => normalizeHeader(h).toLowerCase());
  
  const mapping: (string | null)[] = [];
  
  for (const expected of normalizedExpected) {
    // Try to find matching header
    const matchIndex = normalizedCurrent.findIndex(current => {
      // Exact match
      if (current === expected) return true;
      // Contains key words
      const expectedWords = expected.split(/\s+/).filter(w => w.length > 2);
      const currentWords = current.split(/\s+/).filter(w => w.length > 2);
      const matchingWords = expectedWords.filter(ew => 
        currentWords.some(cw => cw.includes(ew) || ew.includes(cw))
      );
      return matchingWords.length >= Math.min(2, expectedWords.length);
    });
    
    if (matchIndex >= 0) {
      mapping.push(currentHeaders[matchIndex]);
    } else {
      mapping.push(null);
    }
  }
  
  return mapping;
}

async function reformatCSV() {
  console.log('Reading CSV file...');
  
  // Read CSV file
  const fileBuffer = fs.readFileSync(CSV_FILE_PATH);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  
  // Convert to JSON - XLSX handles multi-line headers by combining them
  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    defval: '',
    raw: false
  });

  if (rawData.length === 0) {
    throw new Error('CSV file is empty');
  }

  console.log(`Found ${rawData.length} rows`);
  
  // Get headers from first row
  const firstRow = rawData[0] as any;
  const currentHeaders = Object.keys(firstRow);
  console.log(`Found ${currentHeaders.length} columns`);
  
  // Normalize headers
  const normalizedHeaders = currentHeaders.map(h => normalizeHeader(h));
  console.log('Normalized headers:', normalizedHeaders.slice(0, 5), '...');
  
  // Analyze with Gemini to determine correct order
  console.log('Analyzing CSV structure with Gemini...');
  const headerMapping = await analyzeCSVStructure(normalizedHeaders, rawData.slice(0, 10));
  
  // Create mapping from current headers to expected order
  const headerMap = new Map<string, string>();
  normalizedHeaders.forEach((h, idx) => {
    headerMap.set(h, h); // Default: keep original
  });
  
  // Reorder data based on expected column order
  console.log('Reordering columns...');
  const reorderedData = rawData.map((row: any) => {
    const newRow: any = {};
    
    EXPECTED_COLUMN_ORDER.forEach((expectedHeader, idx) => {
      const normalizedExpected = normalizeHeader(expectedHeader).toLowerCase();
      
      // Find matching current header
      const matchingHeader = normalizedHeaders.find(h => 
        headersMatch(h, expectedHeader)
      );
      
      if (matchingHeader) {
        // Find original header key
        const originalKey = currentHeaders.find(k => 
          normalizeHeader(k).toLowerCase() === matchingHeader.toLowerCase()
        );
        
        if (originalKey) {
          newRow[expectedHeader] = row[originalKey] || '';
        } else {
          newRow[expectedHeader] = '';
        }
      } else {
        // Column not found, set empty
        newRow[expectedHeader] = '';
      }
    });
    
    return newRow;
  });
  
  // Write reformatted CSV
  console.log('Writing reformatted CSV...');
  const newWorkbook = XLSX.utils.book_new();
  const newWorksheet = XLSX.utils.json_to_sheet(reorderedData);
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
  
  // Write to file
  const outputPath = CSV_FILE_PATH.replace('.csv', '_REFORMATTED.csv');
  XLSX.writeFile(newWorkbook, outputPath, { bookType: 'csv' });
  
  console.log(`✅ Reformatted CSV written to: ${outputPath}`);
  console.log(`   Columns: ${EXPECTED_COLUMN_ORDER.length}`);
  console.log(`   Rows: ${reorderedData.length}`);
  
  // Also create a backup of original
  const backupPath = CSV_FILE_PATH.replace('.csv', '_BACKUP.csv');
  fs.copyFileSync(CSV_FILE_PATH, backupPath);
  console.log(`📦 Backup created: ${backupPath}`);
  
  // Replace original if user wants
  console.log('\n⚠️  Original file preserved. To replace original, rename:');
  console.log(`   mv "${outputPath}" "${CSV_FILE_PATH}"`);
}

// Run the script
reformatCSV().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
