# Backlog - Vertical Slices

## What Are Vertical Slices?

Each ticket represents a complete feature that includes:
- UI components/pages
- Data access layer (services/API)
- Database changes (if applicable)
- Business logic
- Basic testing/validation

## Ticket Template

```
Ticket: [Feature Name]
Goal: [What user can do]
DB: [Table changes, if any]
RLS: [Access pattern, if applicable]
UI: [Page/component description]
Acceptance:
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
```

## Current Status

### ✅ Completed Slices
- Master data management (CRUD, import, export)
- Statement processing (upload, AI analysis, display)
- Commission reports (grouped by salesperson)
- PDF Export for Reports (2024-01-15) - Added jsPDF integration, formatted PDF export with tables and totals
- Rebrand from CommiSure to OTG.0 (2024-01-15) - Updated all branding to OTG.0 throughout app
- Restructure UI Navigation for Monthly Automation Workflow (2024-01-15) - Updated navigation to Master Data, Upload Statement, Disputes, Commissions
- Import OTG.0 Comp Key CSV as Master Data (2025-01-15) - Added "Load Default Data" button to import OTG.0 Comp Key CSV file, handles multi-line headers and complex column mappings
- Implement Monday.com-Style Board/Sheet Layout for Master Data (2025-01-15) - Redesigned Master Data with Monday.com-style grid layout, auto-loads CSV data on mount, sticky headers, smooth scrolling
- Reorder Master Data Columns to Match CSV Header Order (2025-01-15) - Reordered all 62 columns to match exact CSV header sequence
- Build Carrier Statement Processing & Dispute Detection Automation (2025-01-15) - Attempted full automation integration (needs to be broken down further)

### 🔄 In Progress
- None

### 📋 Backlog

#### Ticket: Carrier Statement Upload & Processing with Master Data Matching
**Goal**: Upload carrier statements (XLSX), automatically detect processing month, extract data using carrier-specific logic, match against Master Data, and generate partial seller statements

**Reference**: See carrier-specific processing docs:
- `docs/ZAYO_STATEMENT_PROCESSING.md`
- `docs/GOTO_STATEMENT_PROCESSING.md`
- `docs/LUMEN_STATEMENT_PROCESSING.md`
- `docs/METTEL_STATEMENT_PROCESSING.md`
- `docs/TBO_STATEMENT_PROCESSING.md`
- `docs/ALLSTREAM_STATEMENT_PROCESSING.md`

**Key Requirements**:

1. **Carrier Statement Upload**:
   - Upload XLSX file via "Upload Statement" tab
   - Auto-detect carrier type from filename/content (GoTo, Lumen, MetTel, TBO, Zayo, Allstream)
   - Auto-detect statement month from filename/content
   - Calculate processing month using carrier offset:
     - GoTo: +1 month
     - Lumen: +3 months
     - MetTel: +2 months
     - TBO: +1 month
     - Zayo: +2 months
     - Allstream: +2 months
   - Example: Upload October Zayo → Processes for December

2. **Statement Storage**:
   - Store statements organized by processing month (e.g., "December 2025")
   - Allow replacing/updating if same carrier/month uploaded again
   - Track which carriers are present/missing per processing month
   - Store file metadata (filename, upload date, carrier, statement month, processing month)

3. **Data Extraction**:
   - Use carrier-specific extraction logic (see reference docs)
   - Extract rows using carrier-specific column mappings
   - Apply carrier-specific rules (e.g., Zayo ENA rule, GoTo commission adjustment)
   - Normalize to standard format: State, Account Name, Account Number, OTG Comp Billing item, Invoice Total, Commission Amount, Provider, Bill Description, Bill/Invoice Period, Type

4. **Matching Against Master Data**:
   - Match extracted rows against Master Data using exact match on "OTG Comp Billing item"
   - Lookup State from Master Data if missing in statement
   - Calculate role splits (RD1, RD2, RM1, etc.) from Master Data COMP 1-4 columns
   - Use role percentage map (RD1=20%, RD2=10%, etc.)
   - Create "Matches" dataset (rows that matched Master Data)

5. **Partial Processing**:
   - Process seller statements with available carriers only
   - Show partial totals (only for uploaded carriers)
   - Display status indicators for each carrier (Uploaded/Missing)
   - Allow processing even if not all 6 carriers uploaded

6. **Auto-Processing**:
   - Automatically process when statement is uploaded
   - Extract data, match against Master Data, update seller statements
   - Show processing status/progress

7. **Status Indicators**:
   - Display carrier status per processing month:
     - ✅ Uploaded (with date)
     - ❌ Missing
   - Show in UI which carriers are needed for complete processing

**DB**: None (for now - uses existing state management, but consider future DB storage)

**RLS**: None

**UI Changes**:

1. **Upload Statement Tab**:
   - File upload (XLSX)
   - Auto-detection display (carrier type, statement month, processing month)
   - Processing status/progress
   - Results summary (rows extracted, matched, disputes found)

2. **Processing Month View**:
   - Show all processing months (e.g., "December 2025", "January 2026")
   - For each month, show carrier status indicators
   - List uploaded statements with metadata
   - "Process Month" button (auto-processes on upload, but can re-process)

3. **Seller Statements (Commissions Tab)**:
   - Show partial seller statements (RD1/2, RM1/2, etc.)
   - Indicate which carriers contributed to totals
   - Show missing carrier warnings
   - Display totals with note: "Partial - Missing: GoTo, Lumen, MetTel"

**Files to Create/Update**:
- `services/carrierStatementProcessor.ts` - Main processing orchestrator
- `services/carrierExtractors/` - Carrier-specific extractors:
  - `zayoExtractor.ts`
  - `gotoExtractor.ts`
  - `lumenExtractor.ts`
  - `mettelExtractor.ts`
  - `tboExtractor.ts`
  - `allstreamExtractor.ts`
- `services/matchingService.ts` - Match against Master Data, calculate role splits
- `services/sellerStatements.ts` - Generate seller statements from Matches
- `services/monthDetection.ts` - Auto-detect processing month from statement
- `components/UploadStatement.tsx` - Upload UI with auto-detection
- `components/ProcessingMonths.tsx` - View processing months and carrier status
- `components/Commissions.tsx` - Update to show partial statements
- Update `App.tsx` - Add new components/routing

**Data Structures**:

```typescript
interface CarrierStatement {
  id: string;
  filename: string;
  carrier: 'GoTo' | 'Lumen' | 'MetTel' | 'TBO' | 'Zayo' | 'Allstream';
  statementMonth: Date; // Month of statement (e.g., October 2025)
  processingMonth: Date; // Month being processed (e.g., December 2025)
  uploadedAt: Date;
  fileData: ArrayBuffer; // Store file for re-processing if needed
}

interface ProcessingMonth {
  month: Date; // e.g., December 2025
  carriers: {
    GoTo?: CarrierStatement;
    Lumen?: CarrierStatement;
    MetTel?: CarrierStatement;
    TBO?: CarrierStatement;
    Zayo?: CarrierStatement;
    Allstream?: CarrierStatement;
  };
  status: 'complete' | 'partial' | 'empty';
  lastProcessedAt?: Date;
}

interface ExtractedRow {
  state: string;
  accountName: string;
  accountNumber: string;
  otgCompBillingItem: string;
  invoiceTotal: number;
  commissionAmount: number;
  provider: string;
  billDescription?: string;
  billPeriod?: string;
  type?: string; // For GoTo/Allstream
}

interface MatchedRow extends ExtractedRow {
  expectedCompPercent?: number;
  roleSplits: {
    RD1?: number;
    RD2?: number;
    RD3?: number;
    RD4?: number;
    RM1?: number;
    RM2?: number;
    RM3?: number;
    RM4?: number;
    OVR?: number;
    RD5?: number;
    OTG?: number;
  };
}
```

**Carrier-Specific Logic** (from reference docs):

- **Zayo**: ENA rule (if Svc Name blank, use BAN, add * to account name, set Provider="ENA")
- **GoTo**: Multiple tabs, commission adjustment for CN-568463-1409, Equipment grouping
- **Lumen**: Fixed columns, skip repeated headers
- **MetTel**: Fixed columns, simple extraction
- **TBO**: Header detection, aggregation by name+account
- **Allstream**: Two tabs, section-based parsing, account tracking

**Acceptance**:
- [ ] Can upload carrier statement (XLSX) file
- [ ] Auto-detects carrier type from filename/content
- [ ] Auto-detects statement month from filename/content
- [ ] Calculates processing month using carrier offset
- [ ] Stores statement with metadata
- [ ] Extracts data using carrier-specific logic
- [ ] Matches rows against Master Data using exact match on "OTG Comp Billing item"
- [ ] Calculates role splits from Master Data COMP columns
- [ ] Processes seller statements with partial data
- [ ] Shows carrier status indicators (Uploaded/Missing)
- [ ] Auto-processes when statement uploaded
- [ ] Shows partial totals with missing carrier warnings
- [ ] Allows replacing statement if same carrier/month uploaded again
- [ ] Handles all 6 carriers correctly (Zayo, GoTo, Lumen, MetTel, TBO, Allstream)
- [ ] State lookup from Master Data works correctly
- [ ] Processing is fast and shows progress

**Dependencies**: None (can use existing Gemini service for carrier/month detection if needed)

**Notes**:
- Start with one carrier (Zayo) to establish pattern, then add others
- Use exact matching initially (can enhance with fuzzy matching later)
- Store statements in memory/state for now (can add DB persistence later)
- Reference carrier-specific docs for extraction logic details

---

#### Ticket: Build Carrier Statement Processing & Dispute Detection Automation
**Goal**: Replicate Google Apps Script automation in the app - upload carrier statements (XLSX), automatically process against master data, detect disputes, and generate seller statements

**Reference**: See `docs/GOOGLE_AUTOMATION.md` for detailed explanation of current Google automation workflow

**Current Google Automation Flow**:
1. Upload carrier statements (XLSX) to Google Drive
2. Run `runCarrierStatementPipeline()` - extracts data, creates combined spreadsheet
3. Match against Comp Key - creates "Matches" tab
4. Build seller statements - groups by roles (RD1/2, RM1/2, etc.)
5. Run dispute detection - 6 different dispute types
6. Output to Disputes spreadsheet

**Desired App Flow**:
1. Upload carrier statement (XLSX) via "Upload Statement" tab
2. AI extracts data from statement (using Gemini, similar to current statement processing)
3. Match against Master Data automatically
4. Generate disputes automatically (all 6 types)
5. Generate seller statements automatically
6. Store results in app (no Google Sheets needed)
7. Display in Disputes and Commissions tabs

**DB**: None (for now - uses existing state management)

**RLS**: None

**Key Features to Implement**:

1. **Carrier Statement Upload & Processing**:
   - Upload XLSX file (carrier statement)
   - Detect carrier type (GoTo, Lumen, MetTel, TBO, Zayo, Allstream) from filename/content
   - Extract data using AI (Gemini) - similar to current `analyzeStatement()` but for statements
   - Normalize data structure (State, Account Name, Account Number, OTG Comp Billing item, Invoice Total, Commission Amount, etc.)
   - Handle different carrier formats automatically

2. **Matching Against Master Data**:
   - Match extracted rows against Master Data using "OTG Comp Billing item"
   - Use fuzzy matching (AI-enhanced) for better accuracy
   - Calculate role splits (RD1, RD2, RM1, etc.) based on COMP 1-4 columns in Master Data
   - Use role percentage map (RD1=20%, RD2=10%, etc.)
   - Create "Matches" dataset (similar to Matches tab)

3. **Seller Statement Generation**:
   - Group Matches by "OTG Comp Billing item"
   - Aggregate by role groups:
     - RD1/2 (RD1 + RD2)
     - RD3/4 (RD3 + RD4)
     - RM1/2 (RM1 + RM2)
     - RM3/4 (RM3 + RM4)
     - OVR/RD5 (OVR + RD5)
     - OTG (OTG)
   - Calculate OTG Comp $ (total commission) and Seller Comp $ (role splits)
   - Display in Commissions tab

4. **Dispute Detection** (6 types):
   - **New Accounts All**: Items in statement NOT in Master Data
   - **Zeros**: Commission = $0.00 (with tolerance)
   - **Chargebacks**: Commission < 0 (negative)
   - **Canceled/Missing**: Items in Master Data NOT in statement
   - **Changed Rates**: Compare current vs previous month (if history exists)
   - **Months Held**: Zayo-specific logic (if applicable)

5. **AI Enhancements**:
   - Use Gemini for intelligent data extraction from statements
   - Fuzzy matching for "OTG Comp Billing item" (handle typos, variations)
   - Learn matching patterns over time
   - Suggest resolutions for disputes
   - Auto-classify accounts (ZMap, Non-MRC, etc.)

**UI Changes**:

1. **Upload Statement Tab**:
   - File upload (XLSX)
   - Carrier type detection/selection
   - Processing status
   - Results summary (rows processed, matched, disputes found)

2. **Disputes Tab**:
   - Show all detected disputes
   - Group by dispute type (tabs or sections)
   - Filter by date, carrier, account
   - Each dispute shows: Account info, Expected vs Actual, Explanation

3. **Commissions Tab**:
   - Show seller statements (RD1/2, RM1/2, etc.)
   - Group by role group
   - Show totals and line items
   - Export to PDF/Excel

**Files to Create/Update**:
- `services/carrierStatementProcessor.ts` - Main processing logic
- `services/matchingService.ts` - Matching against master data
- `services/disputeDetection.ts` - All 6 dispute detection functions
- `services/sellerStatements.ts` - Generate seller statements
- `components/UploadStatement.tsx` - Upload and processing UI
- `components/Disputes.tsx` - Disputes display (new component)
- `components/Commissions.tsx` - Seller statements display (update existing)
- Update `App.tsx` - Add new tabs/routing

**Data Structures**:

```typescript
interface CarrierStatementRow {
  state: string;
  accountName: string;
  accountNumber: string;
  otgCompBillingItem: string;
  invoiceTotal: number;
  commissionAmount: number;
  provider: string;
  billDescription?: string;
  billPeriod?: string;
}

interface MatchedRow extends CarrierStatementRow {
  expectedCompPercent?: number;
  roleSplits: {
    RD1?: number;
    RD2?: number;
    RD3?: number;
    RD4?: number;
    RM1?: number;
    RM2?: number;
    RM3?: number;
    RM4?: number;
    OVR?: number;
    RD5?: number;
    OTG?: number;
  };
}

interface Dispute {
  type: 'new_account' | 'zero' | 'chargeback' | 'canceled' | 'changed_rate' | 'months_held';
  accountName: string;
  otgCompBillingItem: string;
  expectedAmount?: number;
  actualAmount?: number;
  difference?: number;
  explanation: string;
  dateDetected: Date;
}
```

**Acceptance**:
- [ ] Can upload carrier statement (XLSX) file
- [ ] AI extracts data correctly from statement
- [ ] Matches rows against Master Data using "OTG Comp Billing item"
- [ ] Calculates role splits correctly (RD1=20%, etc.)
- [ ] Generates seller statements (RD1/2, RM1/2, etc.)
- [ ] Detects all 6 dispute types
- [ ] Disputes display in Disputes tab
- [ ] Seller statements display in Commissions tab
- [ ] Fuzzy matching works for similar billing items
- [ ] Handles different carrier formats (GoTo, Lumen, Zayo, etc.)
- [ ] Processing is fast and shows progress
- [ ] Results persist (can view later)

**Dependencies**: None (can use existing Gemini service)

**Notes**:
- Start with basic matching (exact match), then enhance with fuzzy matching
- Can implement dispute types incrementally (start with New Accounts, Zeros, Chargebacks)
- Seller statements can use existing Reports component structure
- See `docs/GOOGLE_AUTOMATION.md` for detailed logic from Google scripts

---

#### Ticket: Convert Master Data to Account-Level View with Expandable Details
**Goal**: Change Master Data from line-item table view to account-level card view with expandable line item details

**Current State**:
- Shows all line items in a flat table/grid
- Each row represents one line item

**Desired State**:
- Group line items by account
- Show account summary cards/tiles
- Click account card to expand and see all line items for that account
- Expandable view shows in a popup/modal (not a new page)

**Account Grouping Logic**:
- Group by combination of:
  - "Account **CARRIER**" (name)
  - "OTG Comp Billing item"
- If both fields match, they belong to the same account
- Create unique account identifier from these two fields

**UI Design**:
1. **Account Cards View**:
   - Grid/card layout showing account summaries
   - Each card displays:
     - Account **CARRIER** name
     - OTG Comp Billing item
     - Basic account info (e.g., Service Provider, Status, Total Monthly Comp, Line Item Count)
     - Key metrics/summary data
   - Cards are clickable to expand

2. **Expandable Details Modal/Popup**:
   - Opens when clicking an account card
   - Shows all line items for that account
   - Displays all columns/data for each line item
   - Modal overlay (doesn't navigate to new page)
   - Can close modal to return to account cards view
   - Consider: Can edit/delete line items from within modal

**Account Summary Fields** (to show on card):
- Account **CARRIER** name
- OTG Comp Billing item
- Service Provider (if consistent across line items)
- Status / Type (if consistent)
- Total Monthly Comp to OTG (sum of all line items)
- Number of line items
- COMP 1 (primary salesperson)
- Other key aggregated metrics

**DB**: None

**RLS**: None

**Files to Update**:
- `components/MasterDataList.tsx` - Complete redesign:
  - Add account grouping logic
  - Create account card component
  - Create expandable modal/popup component
  - Update data processing to group by account
- Consider creating separate components:
  - `AccountCard.tsx` - Individual account card
  - `AccountDetailsModal.tsx` - Expandable line items view

**Acceptance**:
- [ ] Data is grouped by account (Account **CARRIER** + OTG Comp Billing item)
- [ ] Account cards display basic account information
- [ ] Clicking account card opens modal/popup (not new page)
- [ ] Modal shows all line items for that account
- [ ] All line item data/columns visible in modal
- [ ] Can close modal and return to account cards view
- [ ] Account grouping logic correctly identifies unique accounts
- [ ] Account summary metrics are accurate (totals, counts, etc.)
- [ ] UI is clean and intuitive
- [ ] Performance is good even with many accounts/line items

**Dependencies**: None

---

#### ✅ Ticket: Import OTG.0 Comp Key CSV as Master Data (Completed 2025-01-15)
**Goal**: Import the provided CSV file (`OTG.0 Comp Key AFTER 07_2025 - NEW Comp Key - 20260115_160812.csv`) as the initial Master Data set

**File Location**: `/public/OTG.0 Comp Key AFTER 07_2025 - NEW Comp Key - 20260115_160812.csv`

**CSV Structure**:
- Headers include: "Account **CARRIER**", "Service Provider", "Carrier Comp Type", and other fields
- Contains commission/compensation data for OTG
- Multiple rows of master service records
- Multi-line headers (handled by XLSX library)

**Implementation**:
- Created `services/defaultMasterData.ts` to load and parse the CSV file
- Added "Load Default Data" button to `MasterDataList` component
- Enhanced column mapping logic to handle:
  - "Account **CARRIER**" → `clientName`
  - "Service Provider" → `serviceType`
  - "COMP 1" → `salesperson`
  - "Monthly Unit Price" → `expectedAmount`
  - "EXPECTED/Mo. OTG Comp %" → `splitPercentage`
- Handles multi-line headers, empty rows, and edge cases
- Shows loading state and error messages

**Files Updated**:
- `services/defaultMasterData.ts` - New service to load default CSV
- `components/MasterDataList.tsx` - Added "Load Default Data" button and handler
- Enhanced column mapping logic for OTG.0 Comp Key CSV format

**Acceptance**:
- [x] CSV file can be imported successfully
- [x] All rows from CSV are imported as master records
- [x] Column mapping works correctly (Account **CARRIER** → clientName, etc.)
- [x] Imported data displays correctly in Master Data tab
- [x] No data loss during import
- [x] Import can be triggered easily (button)

## Notes

- Each ticket should be implementable in 1-3 days
- Keep tickets focused (one feature per ticket)
- Update `docs/spec.md` when completing tickets
- Mark tickets complete with date and notes
