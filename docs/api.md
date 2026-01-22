# API Documentation

## Current State: Client-Side Services

Currently, all "API" calls are client-side service functions. No backend exists.

## Service Layer

### `services/geminiService.ts`

#### `getColumnMapping(sampleData: string): Promise<Record<string, string>>`
Maps file headers to internal field names.

**Input**: CSV/JSON sample (first few rows)
**Output**: Mapping object like `{ clientName: "Account **CARRIER**", salesperson: "COMP 1", ... }`
**Used by**: Master data import flow

#### `parseMasterDataUnstructured(fileBase64: string, mimeType: string): Promise<Omit<MasterRecord, 'id'>[]>`
Extracts master records from unstructured files (PDF/Images).

**Input**: Base64-encoded file, MIME type
**Output**: Array of master records (without IDs)
**Used by**: Master data import for PDF/Image files

#### `analyzeStatement(data: string, mimeType: string, masterData: MasterRecord[], isBinary: boolean): Promise<AnalysisResult>`
Main analysis function. Matches statement against master data.

**Input**:
- `data`: File content (CSV string or base64)
- `mimeType`: File MIME type
- `masterData`: Array of master records
- `isBinary`: Whether data is base64

**Output**: `AnalysisResult` with processed items, missing records, and summary

**AI Prompt**: See `docs/spec.md` for system instructions

**Used by**: Dashboard statement processing

### `services/defaultMasterData.ts`

#### `loadDefaultMasterData(): Promise<any[]>`
Loads the default OTG.0 Comp Key CSV file as raw data for import.

**Input**: None (reads from `/public/OTG.0 Comp Key AFTER 07_2025 - NEW Comp Key - 20260115_160812.csv`)

**Output**: Raw data array that can be passed to `MasterDataList.processImportData()`

**Features**:
- Handles multi-line CSV headers
- Normalizes column names (trims whitespace, handles newlines)
- Filters out empty rows
- Uses XLSX library for robust CSV parsing

**Used by**: MasterDataList "Load Default Data" button

**Error Handling**: Throws descriptive errors for network failures, empty files, or invalid CSV format

### `services/monthDetection.ts`

#### `detectCarrierFromFilename(filename: string): CarrierType | null`
Detects carrier type from filename.

**Input**: Filename string
**Output**: Carrier type ('GoTo', 'Lumen', 'MetTel', 'TBO', 'Zayo', 'Allstream') or null
**Used by**: Carrier statement upload flow

#### `detectStatementMonth(filename: string, content?: string): Date | null`
Detects statement month from filename/content.

**Input**: Filename string, optional content string
**Output**: Date object representing statement month or null
**Used by**: Month detection flow

#### `calculateProcessingMonth(statementMonth: Date, carrier: CarrierType): Date`
Calculates processing month from statement month using carrier offset.

**Carrier Offsets**:
- GoTo: +1 month
- Lumen: +3 months
- MetTel: +2 months
- TBO: +1 month
- Zayo: +2 months
- Allstream: +2 months

**Input**: Statement month Date, carrier type
**Output**: Processing month Date
**Used by**: Month calculation flow

#### `detectCarrierAndMonth(filename: string, content?: string): DetectionResult`
Detects both carrier and processing month from filename/content.

**Output**: Object with carrier, statementMonth, processingMonth, processingMonthKey, processingMonthLabel
**Used by**: Dashboard upload flow

### `services/carrierStatementProcessor.ts`

#### `detectCarrier(filename: string): string`
Detects carrier type from filename (deprecated - use `detectCarrierFromFilename` from monthDetection).

**Input**: Filename string
**Output**: Carrier name ('Zayo', 'Lumen', 'GoTo', 'TBO', 'MetTel', 'Allstream', or 'Unknown')
**Used by**: Legacy code

#### `extractCarrierStatementData(file: File, masterData?: MasterRecord[]): Promise<CarrierStatementRow[]>`
Extracts carrier statement data from XLSX file using carrier-specific extractors.

**Input**: File object (XLSX), optional MasterRecord[] for state lookup
**Output**: Array of carrier statement rows
**Used by**: Carrier statement processing pipeline

**Features**:
- Uses carrier-specific extractors (Zayo, GoTo, Lumen, MetTel, TBO, Allstream)
- Falls back to AI extraction if carrier-specific extractor fails
- Handles multiple sheets (especially for GoTo)
- Normalizes amounts and data
- Preserves OTG Comp Billing item exactly (case-sensitive matching key)
- Looks up State from Master Data when missing

### `services/carrierExtractors/`

Carrier-specific extractors implementing exact logic from Google Apps Script automation:

#### `zayoExtractor.ts`
- Extracts from "Collection of Commissions" tab
- Implements ENA rule (if Svc Name blank, use BAN, add * to account name, set Provider="ENA")
- Looks up State from Master Data

#### `gotoExtractor.ts`
- Processes multiple tabs: Data (required), Equipment, One-Time, Canceled, Assist, CAD, 2G Energy
- Applies commission adjustment for CN-568463-1409 (subtract 118.29)
- Groups Equipment tab by billing item
- Looks up State from Master Data

#### `lumenExtractor.ts`
- Uses fixed column positions (P, U, Z, AB)
- Skips repeated headers
- Account Number = Billing Item
- Looks up State from Master Data

#### `mettelExtractor.ts`
- Uses fixed column positions (C, D, N, P)
- Simple extraction, no special rules
- Looks up State from Master Data

#### `tboExtractor.ts`
- Header-based column detection
- Aggregates by Customer Business Name + Supplier Account
- Looks up State from Master Data

#### `allstreamExtractor.ts`
- Processes "OneTel H R" tab (fixed columns)
- Processes "OneTel H" tab (section-based parsing)
- Account name cleaning (removes parentheses, month suffixes)
- Looks up State from Master Data

### `services/stateLookup.ts`

#### `getStateForBillingItem(billingItem: string, masterData: MasterRecord[]): string`
Looks up State from Master Data using OTG Comp Billing item.

**Input**: Billing item string, MasterRecord array
**Output**: State abbreviation (2-letter code) or empty string
**Used by**: Carrier extractors, matching service

**Features**:
- Caches lookup results for performance
- Normalizes billing item for matching
- Returns empty string if not found

### `services/statementStorage.ts`

#### `storeCarrierStatement(statement: CarrierStatement): ProcessingMonthData`
Stores or updates a carrier statement organized by processing month.

**Input**: CarrierStatement object
**Output**: ProcessingMonthData for the processing month
**Used by**: Dashboard upload flow

**Features**:
- Organizes statements by processing month
- Allows replacing/updating if same carrier/month uploaded again
- Tracks which carriers are present/missing per processing month
- Updates status (complete/partial/empty)

#### `getAllProcessingMonths(): ProcessingMonthData[]`
Gets all processing months with carrier status.

**Output**: Array of ProcessingMonthData sorted by month key
**Used by**: ProcessingMonths component

#### `getMissingCarriers(monthKey: string): CarrierType[]`
Gets missing carriers for a processing month.

**Input**: Month key string (format: "YYYY-MM")
**Output**: Array of missing carrier types
**Used by**: UI components for status display

#### `getCombinedMatchedRows(monthKey: string): MatchedRow[]`
Combines all matched rows from all carriers for a processing month.

**Input**: Month key string
**Output**: Array of matched rows from all carriers
**Used by**: Reports component for partial processing

### `services/matchingService.ts`

#### `matchCarrierStatements(carrierRows: CarrierStatementRow[], masterData: MasterRecord[]): MatchedRow[]`
Matches carrier statement rows against master data using "OTG Comp Billing item" as the key.

**Input**:
- `carrierRows`: Extracted carrier statement rows
- `masterData`: Master records

**Output**: Array of matched rows with role splits calculated

**Features**:
- Exact matching on normalized "OTG Comp Billing item"
- Looks up State from Master Data if missing in statement
- Calculates role splits using percentage map (RD1=20%, RD2=10%, etc.)
- Handles special roles (RD2-05, RD4-05, RM1-15)
- HA* roles go to OTG
- Uses cents math to prevent rounding drift
- Rule: Commission ≤ 3 cents → all goes to OTG
- Provider override: * account on Zayo → ENA

### `services/disputeDetection.ts`

#### `detectAllDisputes(...): Dispute[]`
Runs all dispute detection functions.

**Dispute Types**:
1. **New Accounts**: Items in statement NOT in Master Data
2. **Zeros**: Commission rounds to $0.00 (tolerance: < $0.005)
3. **Chargebacks**: Negative commission amounts
4. **Canceled/Missing**: Items in Master Data NOT in statement
5. **Changed Rates**: Compare current vs previous month (if history exists)
6. **Months Held**: Zayo-specific logic (requires Zayo data structure)

**Input**:
- `carrierRows`: All carrier statement rows
- `matchedRows`: Matched rows only
- `masterData`: Master records
- `previousMonthData`: Optional previous month matched rows

**Output**: Array of disputes

### `services/sellerStatements.ts`

#### `generateSellerStatements(matchedRows: MatchedRow[]): SellerStatement[]`
Generates seller statements grouped by role groups.

**Role Groups**:
- RD1/2 (RD1 + RD2)
- RD3/4 (RD3 + RD4)
- RM1/2 (RM1 + RM2)
- RM3/4 (RM3 + RM4)
- OVR/RD5 (OVR + RD5)
- OTG (OTG)

**Input**: Matched rows with role splits
**Output**: Array of seller statements

**Features**:
- Groups by "OTG Comp Billing item"
- Aggregates OTG Comp $ (total commission) and Seller Comp $ (role splits)
- Preserves star accounts (*) separately
- Sorts by Provider → Account Name → Billing Item

### `services/carrierStatementPipeline.ts`

#### `processCarrierStatement(file: File, masterData: MasterRecord[], previousMonthData?: MatchedRow[]): Promise<CarrierStatementProcessingResult>`
Main pipeline function that orchestrates the full carrier statement processing workflow.

**Input**:
- `file`: Carrier statement XLSX file
- `masterData`: Master records
- `previousMonthData`: Optional previous month data for changed rate detection

**Output**: Complete processing result with:
- Extracted rows
- Matched rows
- Disputes
- Seller statements
- Summary

**Workflow**:
1. Extract data from carrier statement (AI)
2. Match against master data
3. Detect disputes
4. Generate seller statements
5. Generate summary

**Used by**: Dashboard component

## Future Backend API (If Migrating to Next.js + Supabase)

### Route Handlers (Recommended Pattern)

#### `POST /api/master-data`
Create/update master records

**Auth**: Required (Supabase session)
**Body**: `MasterRecord[]`
**Response**: `{ success: boolean, records: MasterRecord[] }`

#### `GET /api/master-data`
Get master records for current org

**Auth**: Required
**Query**: `?org_id=...`
**Response**: `{ records: MasterRecord[] }`

#### `POST /api/analyses`
Create new analysis run

**Auth**: Required
**Body**: `{ statementFile: File, masterData: MasterRecord[] }`
**Response**: `{ analysisId: string, result: AnalysisResult }`

#### `GET /api/analyses/:id`
Get analysis result

**Auth**: Required
**Response**: `AnalysisResult`

#### `GET /api/analyses`
List analyses for current org

**Auth**: Required
**Query**: `?org_id=...&limit=...&offset=...`
**Response**: `{ analyses: Analysis[], total: number }`

### Server Actions Alternative (If Using Next.js App Router)

```typescript
// app/actions/masterData.ts
'use server'

export async function createMasterRecord(data: MasterRecord) {
  // Server-side validation
  // Supabase insert
  // RLS enforced automatically
}

export async function getMasterRecords(orgId: string) {
  // Supabase select with RLS
}
```

## Environment Variables

### Current
- `GEMINI_API_KEY` (or `API_KEY`): Google Gemini API key
  - **⚠️ SECURITY ISSUE**: Currently exposed in client code

### Future (Backend)
- `GEMINI_API_KEY`: Should be in server-side env only
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key (client-side OK)
- `SUPABASE_SERVICE_ROLE_KEY`: Server-side only

## Error Handling

Current: Basic try/catch with user-facing error messages
Future: Structured error responses, logging, retry logic

## Rate Limiting

Current: None
Future: Implement rate limiting for Gemini API calls (server-side)
