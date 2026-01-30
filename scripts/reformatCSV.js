// Simple Node.js script to reformat CSV using Gemini
// Run with: node scripts/reformatCSV.js

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '../.env.local');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });
  return env;
}

const env = loadEnv();
const API_KEY = env.GEMINI_API_KEY || env.API_KEY;

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

// Helper to normalize header names
function normalizeHeader(header) {
  return header.trim().replace(/^"|"$/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// Helper to match headers
function headersMatch(header1, header2) {
  const norm1 = normalizeHeader(header1).toLowerCase();
  const norm2 = normalizeHeader(header2).toLowerCase();
  return norm1 === norm2;
}

async function reformatCSV() {
  console.log('📖 Reading CSV file...');
  
  if (!fs.existsSync(CSV_FILE_PATH)) {
    throw new Error(`CSV file not found: ${CSV_FILE_PATH}`);
  }
  
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

  console.log(`✅ Found ${rawData.length} rows`);
  
  // Get headers from first row
  const firstRow = rawData[0];
  const currentHeaders = Object.keys(firstRow);
  console.log(`✅ Found ${currentHeaders.length} columns`);
  
  // Normalize headers
  const normalizedHeaders = currentHeaders.map(h => normalizeHeader(h));
  console.log('\n📋 Current headers (first 10):');
  normalizedHeaders.slice(0, 10).forEach((h, i) => console.log(`   ${i + 1}. ${h}`));
  
  // Use Gemini to help match headers
  if (API_KEY) {
    console.log('\n🤖 Using Gemini to analyze column mapping...');
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      const prompt = `
I need to map CSV headers to their correct order. Here are the current headers and the expected order.

Current Headers (${normalizedHeaders.length} columns):
${normalizedHeaders.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

Expected Column Order (${EXPECTED_COLUMN_ORDER.length} columns):
${EXPECTED_COLUMN_ORDER.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

Please analyze and return a JSON object mapping current header indices to expected header indices.
Format: { "currentIndex": expectedIndex, ... }
Example: { "0": 0, "1": 1, "2": null, ... }
If a current header doesn't match any expected header, use null.
`;

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

      const mapping = JSON.parse(response.text);
      console.log('✅ Gemini analysis complete');
      
      // Use mapping to reorder
      const reorderedData = rawData.map(row => {
        const newRow = {};
        EXPECTED_COLUMN_ORDER.forEach((expectedHeader, expectedIdx) => {
          // Find which current header maps to this expected header
          let value = '';
          for (const [currentIdxStr, mappedIdx] of Object.entries(mapping)) {
            const currentIdx = parseInt(currentIdxStr);
            if (mappedIdx === expectedIdx && currentHeaders[currentIdx]) {
              value = row[currentHeaders[currentIdx]] || '';
              break;
            }
          }
          newRow[expectedHeader] = value;
        });
        return newRow;
      });
      
      // Write reformatted CSV
      console.log('\n💾 Writing reformatted CSV...');
      const newWorkbook = XLSX.utils.book_new();
      const newWorksheet = XLSX.utils.json_to_sheet(reorderedData);
      XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
      
      const outputPath = CSV_FILE_PATH.replace('.csv', '_REFORMATTED.csv');
      XLSX.writeFile(newWorkbook, outputPath, { bookType: 'csv' });
      
      console.log(`✅ Reformatted CSV written to: ${path.basename(outputPath)}`);
      console.log(`   Columns: ${EXPECTED_COLUMN_ORDER.length}`);
      console.log(`   Rows: ${reorderedData.length}`);
      
      // Create backup
      const backupPath = CSV_FILE_PATH.replace('.csv', '_BACKUP.csv');
      fs.copyFileSync(CSV_FILE_PATH, backupPath);
      console.log(`📦 Backup created: ${path.basename(backupPath)}`);
      
      return;
    } catch (error) {
      console.warn('⚠️  Gemini analysis failed, using manual matching:', error.message);
    }
  }
  
  // Fallback: Manual matching
  console.log('\n🔧 Using manual header matching...');
  const reorderedData = rawData.map(row => {
    const newRow = {};
    EXPECTED_COLUMN_ORDER.forEach(expectedHeader => {
      // Find matching current header
      const matchingHeader = normalizedHeaders.find(h => 
        headersMatch(h, expectedHeader)
      );
      
      if (matchingHeader) {
        const originalKey = currentHeaders.find(k => 
          normalizeHeader(k).toLowerCase() === matchingHeader.toLowerCase()
        );
        newRow[expectedHeader] = row[originalKey] || '';
      } else {
        newRow[expectedHeader] = '';
      }
    });
    return newRow;
  });
  
  // Write reformatted CSV
  console.log('\n💾 Writing reformatted CSV...');
  const newWorkbook = XLSX.utils.book_new();
  const newWorksheet = XLSX.utils.json_to_sheet(reorderedData);
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
  
  const outputPath = CSV_FILE_PATH.replace('.csv', '_REFORMATTED.csv');
  XLSX.writeFile(newWorkbook, outputPath, { bookType: 'csv' });
  
  console.log(`✅ Reformatted CSV written to: ${path.basename(outputPath)}`);
  console.log(`   Columns: ${EXPECTED_COLUMN_ORDER.length}`);
  console.log(`   Rows: ${reorderedData.length}`);
  
  // Create backup
  const backupPath = CSV_FILE_PATH.replace('.csv', '_BACKUP.csv');
  fs.copyFileSync(CSV_FILE_PATH, backupPath);
  console.log(`📦 Backup created: ${path.basename(backupPath)}`);
  
  console.log('\n⚠️  To replace original file, run:');
  console.log(`   mv "${outputPath}" "${CSV_FILE_PATH}"`);
}

// Run the script
reformatCSV().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
