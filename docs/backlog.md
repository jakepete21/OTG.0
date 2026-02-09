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
- Carrier Statement Upload & Processing with Master Data Matching (2025-01-15) - Implemented carrier statement upload, auto-detection, extraction, matching, and partial processing (partially complete, needs backend integration)
- Fix Missing Convex Query Error in Dashboard (2026-01-26) - Removed unused `getMatchedRowsForRegeneration` query hook that was causing console errors
- Fix Convex Read Limit Error in regenerateSellerStatements Mutation (2026-01-26) - Implemented byte tracking and continuation pattern to handle large datasets without hitting 16MB read limit
- Rebuild and Simplify Convex Backend (2026-01-26) - Simplified backend to core functionality: upload, delete, process seller statements
- Migrate from Convex to Firebase Backend (2026-01-28) - Successfully migrated to Firebase Firestore + Cloud Storage, removed all Convex code
- Fix Firebase Setup and Verify Backend Works (2026-01-28) - Installed Firebase dependencies, verified configuration, tested upload/delete operations
- Add New Accounts and Line Items to Master Data 2 (2026-01-30) - Added "Add New Account" modal in MasterDataList2 and "Add Line Item" functionality in AccountDetailsModal, with validation for required fields
- Google Sheets Sync for Comp Key (2026-01-30) - Added Sync Test tab for syncing Google Sheet data to Firebase database, preserves all columns and column order, maintains account/line item structure
- Clean Up Master Data CSV and Import to Firebase (2026-01-28) - Added CSV analysis and cleaning services using Gemini, created Master Data 2 tab with all 62 columns, implemented CSV reformatting script
- Switch Statement Processing to Use Master Data 2 (2026-01-30) - Updated App.tsx and Dashboard.tsx to use masterData2, implemented Master Data 2 persistence in Firebase, added optimistic UI updates for deletions, optimized duplicate detection and seller statement updates
- Update Commissions Tab to Show Expandable Months Jan-Jun 2026 with Carrier Status (2026-01-30) - Restructured Commissions tab to show 6 months as expandable accordion sections, each showing carrier status and seller statements when expanded

### 🔄 In Progress

### ✅ Completed (features branch)
- Fix TypeScript Errors and Add Deposit Totals to Commissions Month Cards (2026-02-05)
- Seller statement filters and sort (2026-02-05): Column filters (text + Google Sheets-style dropdown with search, Select all/Deselect all, checkboxes); sortable columns (click header, asc/desc); filter dropdown in portal so it stays visible when table is empty; empty state "No rows match" with min-height.
- Tab persistence on reload (2026-02-05): Active tab (Comp Key, Commissions, etc.) stored in URL hash; reload keeps same tab; back/forward supported.
- Differences report (2026-02-05): At top of each month's seller statement UI, report why Deposit Total ≠ Commissionable to OTG (unmatched $ from lines not in comp key; rounding/split $). Show actual unmatched line items in a table (State, Account Name, OTG Comp Billing Item, Commission $). Unmatched rows stored on carrier statement and returned from matching pipeline.
- Zayo extract all Pay This Reporting Period = Yes rows (2026-02-05): Extract every row that counts toward deposit total; use placeholders for missing account/billing item so all lines appear in extraction and unmatched report; raw total = sum of extracted rows.

### 📋 Backlog

#### 🔧 Ticket: Fix TypeScript Errors and Add Deposit Totals to Commissions Month Cards
**Goal**: Fix two TypeScript errors in firebaseMutations.ts (ArrayBuffer/Uint8Array) and add a "Deposit Totals" section to each month card on the Commissions tab showing the sum of OTG Comp $ per carrier statement

**Part 1 – TypeScript errors**

**Error 1** (firebaseMutations.ts ~line 807):
- `Type 'ArrayBuffer' is missing the following properties from type 'Uint8Array<ArrayBufferLike>'`
- `fileBytes = await getBytes(storageRef)` – `getBytes()` returns `Promise<ArrayBuffer>`, but `fileBytes` is declared as `Uint8Array`
- **Fix**: Use `ArrayBuffer` for the result of `getBytes`, or assign `new Uint8Array(await getBytes(storageRef))`. Prefer using `ArrayBuffer` and then pass it to `Blob` so types align.

**Error 2** (firebaseMutations.ts ~line 826):
- `Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'`
- `new Blob([fileBytes])` – `Uint8Array` with `ArrayBufferLike` is not accepted as `BlobPart` in strict typing
- **Fix**: If keeping `fileBytes` as `ArrayBuffer`, use `new Blob([fileBytes])`. If keeping as `Uint8Array`, use `new Blob([fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength])` or ensure the type is a valid `BlobPart` (e.g. `ArrayBuffer`).

**Recommended approach**: Declare the variable as `ArrayBuffer`, assign `await getBytes(storageRef)`, and use `new Blob([fileBytes])` and `new File([blob], ...)`. No Uint8Array needed.

**Part 2 – Deposit Totals feature**

**Requirement**: On each month card (e.g. "February 2026") on the Commissions tab, add a **Deposit Totals** section that shows the sum of **OTG Comp $** for each carrier statement separately.

- **OTG Comp $** = total commission from that carrier’s statement (sum of `commissionAmount` from matches for that carrier statement).
- One total per carrier (GoTo, Lumen, MetTel, TBO, Zayo, Allstream) that has an uploaded statement for that month.
- Display format: e.g. "GoTo: $X,XXX.XX", "Lumen: $X,XXX.XX", etc., or a small table/list under "Deposit Totals".

**Data source**: Matches in Firestore. For the processing month, for each carrier statement ID in `monthData.carriers`, sum `matchedRow.commissionAmount` (or equivalent) for all matches where `carrierStatementId` equals that statement ID. Use existing `getMatchesForProcessingMonth(processingMonth)` (or per-statement if preferred), then aggregate by `carrierStatementId`. Map `carrierStatementId` back to carrier name using `monthData.carriers` (carrier → statementId; build statementId → carrier for lookup).

**UI placement**: In `components/Reports.tsx`, inside the month card (same area as "Carrier Status"), add a "Deposit Totals" block. Can sit below Carrier Status, same always-visible header area. Use existing `formatCurrency` and carrier labels (e.g. CARRIER_LABELS).

**Files to update**:
- `services/firebaseMutations.ts`: Fix types for `fileBytes` and `Blob`/`File` construction (lines ~800–827).
- `components/Reports.tsx`: Add Deposit Totals section to month card; optionally add a helper/hook that fetches matches for the month and returns `Record<carrier, totalOtgComp>` (or use existing `getMatchesForProcessingMonth` and aggregate in the component).
- Optionally `services/firebaseQueries.ts` or `services/firebaseHooks.ts`: Add `getDepositTotalsByCarrier(processingMonth)` or `useDepositTotals(processingMonth)` that returns `{ [carrier: string]: number }` for the month.

**Acceptance criteria**:
- [x] TypeScript errors 2740 and 2322 in firebaseMutations.ts are resolved; project builds with no type errors.
- [x] Each Commissions month card shows a "Deposit Totals" section.
- [x] For each carrier with an uploaded statement for that month, the section shows the sum of OTG Comp $ (commission) for that carrier’s statement.
- [x] Totals are formatted as currency and carrier names use the same labels as elsewhere (e.g. GoTo, Lumen, MetTel, TBO, Zayo, Allstream).
- [x] If a month has no carrier statements or no matches, Deposit Totals shows empty or $0.00 per carrier as appropriate.

---

#### ✅ Ticket: Investigate and Fix Doubled Firebase Values in Statement Compare (RD1/2) (COMPLETED 2026-02-04)
**Goal**: Investigate why Firebase seller statement values are exactly double the CSV values in Statement Compare, specifically for RD1/2, and fix the root cause

**Problem**: 
- Statement Compare shows Firebase values that are exactly double the CSV values for RD1/2
- All differences are due to Firebase values being doubled
- This suggests duplicate data storage or double-counting in seller statements
- User suspects seller statements are stored twice or matches are duplicated

**Root Cause** (to be investigated):
- Possible causes:
  1. Duplicate seller statements stored in Firebase (same roleGroup + processingMonth stored twice)
  2. Duplicate matches being stored (same match stored multiple times)
  3. Seller statement generation logic double-counting items
  4. Deduplication logic in Reports.tsx (lines 302-323) merging duplicates incorrectly
  5. Regeneration not properly deleting old seller statements before creating new ones

**Expected Behavior**:
- Firebase seller statement values should match CSV values (within tolerance)
- No duplicate seller statements in Firebase for same roleGroup + processingMonth
- No duplicate matches in Firebase
- Statement Compare should show accurate comparisons

**DB**: Investigate Firestore data for duplicates

**UI**: Statement Compare should show accurate values

**Files to Investigate**:
- `services/firebaseMutations.ts`:
  - `regenerateSellerStatements` (lines 579-824) - Check if seller statements are properly deleted before creating new ones
  - `storeMatches` (lines 262-320) - Check if matches could be duplicated
  - Seller statement storage logic (lines 803-821) - Check if duplicates could be created
  
- `components/Reports.tsx`:
  - Deduplication logic (lines 302-323) - Check if merging duplicates correctly
  - How seller statements are read from Firebase (lines 259-323)
  
- `services/firebaseQueries.ts`:
  - `getSellerStatements` (lines 81-96) - Check if query could return duplicates
  
- `services/sellerStatements.ts`:
  - `generateSellerStatements` (lines 134-207) - Check if generation logic could double-count
  - `summarizeGroup` (lines 24-129) - Check if aggregation logic could double-count

**Investigation Steps**:

1. **Check Firebase Data**:
   - Query seller statements for RD1/2 for the processing month
   - Check if there are multiple documents with same roleGroup + processingMonth
   - Check if items within a single document are duplicated
   - Query matches to see if there are duplicate matches

2. **Check Storage Logic**:
   - Review `regenerateSellerStatements` to see if deletion happens before creation
   - Check if seller statements are created with unique IDs or could overwrite
   - Verify deletion logic completes before new statements are created

3. **Check Generation Logic**:
   - Review `generateSellerStatements` to see if matched rows are processed multiple times
   - Check `summarizeGroup` to see if items are aggregated correctly
   - Verify no double-counting in aggregation

4. **Check Deduplication Logic**:
   - Review Reports.tsx deduplication (lines 302-323)
   - If duplicates exist, merging by adding items would double values
   - Should deduplicate by checking if items already exist, not just merging

5. **Add Diagnostic Logging**:
   - Log how many seller statement documents exist for RD1/2
   - Log how many matches exist for the processing month
   - Log totals before and after deduplication
   - Log item counts and values for specific billing items

**Fix Strategy** (after investigation):

1. **If duplicates in Firebase**:
   - Fix storage logic to prevent duplicates (use unique constraint or check before creating)
   - Clean up existing duplicates in Firebase
   - Ensure deletion completes before creation

2. **If duplicate matches**:
   - Fix `storeMatches` to prevent duplicate matches
   - Clean up duplicate matches in Firebase
   - Add unique constraint on match key (processingMonth + carrierStatementId + billingItem + accountName)

3. **If double-counting in generation**:
   - Fix aggregation logic in `summarizeGroup`
   - Ensure matched rows are only processed once

4. **If deduplication issue**:
   - Fix Reports.tsx deduplication to properly handle duplicates
   - Instead of merging by adding items, check if items already exist
   - Or prevent duplicates at storage level

**Acceptance Criteria**:
- [x] Root cause identified (duplicate storage, double-counting, or deduplication issue)
- [x] Fix implemented to prevent the issue
- [x] Existing duplicate data cleaned up (if applicable)
- [x] Statement Compare shows accurate values (Firebase matches CSV)
- [x] No duplicate seller statements in Firebase for same roleGroup + processingMonth
- [x] Diagnostic logging added to help identify future issues

**Completed Changes**:

1. **Root Cause Identified**:
   - Multiple seller statement documents with same `roleGroup` + `processingMonth` existed in Firebase
   - Reports.tsx deduplication logic merged duplicates by concatenating items and adding totals, causing double-counting
   - `addItemsToSellerStatements` and `regenerateSellerStatements` used random document IDs, allowing duplicates

2. **Fixes Implemented**:
   - **Reports.tsx**: Fixed deduplication logic to merge items by key (`billingItem|accountName`) instead of concatenating, preventing double-counting
   - **firebaseMutations.ts**: Updated `addItemsToSellerStatements` to use deterministic document IDs (`${processingMonth}_${roleGroup}`) to prevent duplicate documents
   - **firebaseMutations.ts**: Updated `regenerateSellerStatements` to use deterministic document IDs
   - Added duplicate detection and logging in `addItemsToSellerStatements` to catch duplicates early

3. **Cleanup Tools Created**:
   - `scripts/diagnoseDoubledValues.ts`: Diagnostic script to check Firebase for duplicate seller statements, duplicate matches, and double-counting issues
   - `scripts/cleanupDuplicateSellerStatements.ts`: Cleanup script to merge duplicate documents and migrate to deterministic IDs

4. **Prevention**:
   - Deterministic document IDs ensure only one document per `roleGroup` + `processingMonth` combination
   - Improved deduplication logic prevents double-counting when duplicates exist
   - Diagnostic logging helps identify issues early

**Files Updated**:
- `components/Reports.tsx` - Fixed deduplication logic to merge items by key
- `services/firebaseMutations.ts` - Added deterministic IDs and duplicate detection
- `scripts/diagnoseDoubledValues.ts` - New diagnostic script
- `scripts/cleanupDuplicateSellerStatements.ts` - New cleanup script

---

#### ✅ Ticket: OTG/Seller Comp Splits and Statement Compare Rounding (COMPLETED 2026-02)
**Goal**: Fix OTG and seller comp calculation for negative commissions and duplicate Comp Key rows; align Statement Compare UI with small rounding drift.

**Completed**:
- **matchingService**: OTG is always the remainder (skip OTG codes in percentage loop); negative commission forces OTG = remainder; HA5/HA6 add to OTG only (no double-count); when multiple Comp Key candidates for same billing item, prefer the one with splits listed (`hasValidSplits`).
- **sellerStatements**: OTG safeguard when commission is negative and OTG share positive (recompute OTG from remainder); round item otgComp/sellerComp to 2 decimals on output only (not during accumulation) so stored values match CSV.
- **Statement Compare (UI only)**: 10-cent tolerance—amounts and total difference within $0.10 are treated as matching; no change to seller statement generation.
- Removed debug logs from commissions tab and Statement Compare as requested; 525251 logging retained for Comp Key duplicate debugging.

**Files**: `services/matchingService.ts`, `services/sellerStatements.ts`, `services/statementComparisonService.ts`, `components/Reports.tsx`

---

#### 🔧 Ticket: Fix Zayo Carrier Statement Showing for Wrong Month and Remove Unnecessary Logs
**Goal**: Fix bug where Zayo carrier statement shows for January when it should only show for February, and remove all unnecessary console logs from Commissions tab

**Problem**: 
- Commissions tab shows Zayo carrier statement for January 2026
- Actual Zayo statement is only for February 2026 (correct)
- January should not show Zayo in carrier status
- Too many console.log statements cluttering the console

**Root Cause**:
- In `components/Reports.tsx`, lines 262-278 have logic that adds Zayo to merged carriers if seller statements have Zayo data
- The code finds ANY Zayo statement regardless of processingMonth: `allCarrierStatements.find(s => s.carrier === 'Zayo')`
- This causes February's Zayo statement to appear in January's carriers if January seller statements happen to have Zayo data (from previous incorrect regeneration or matches)
- Multiple console.log statements throughout Reports.tsx for debugging (lines 90-137, 370, 376, 378, 387, 390, 394, 419, 1159, 1161, 1163, 1165)
- Console logs also in `services/firebaseHooks.ts` (lines 56-78)

**Expected Behavior**:
- Zayo should only show for the month where its carrier statement's `processingMonth` matches that month
- January should not show Zayo if the Zayo statement's `processingMonth` is "2026-02"
- February should show Zayo if the Zayo statement's `processingMonth` is "2026-02"
- No unnecessary console.log statements in production code

**DB**: None (UI bug fix only)

**UI**: Fix carrier status display logic, remove console logs

**Files to Update**:
- `components/Reports.tsx`:
  - Fix `mergedCarriers` useMemo (lines 242-281) - Only include Zayo if its `processingMonth` matches `monthData.monthKey`
  - Remove all console.log statements (lines 90-137, 370, 376, 378, 387, 390, 394, 419, 1159, 1161, 1163, 1165)
  - Keep only essential error logging (console.error for actual errors)
  
- `services/firebaseHooks.ts`:
  - Remove diagnostic logging for Zayo statements (lines 55-78)
  - Keep only essential error logging

**Implementation Details**:

1. **Fix Zayo Carrier Logic** (`components/Reports.tsx`, lines 262-278):
   - Current: Finds ANY Zayo statement regardless of processingMonth
   - Fix: Only include Zayo if `zayoStatement.processingMonth === monthData.monthKey`
   - If seller statements have Zayo data but no matching Zayo statement, don't add it (let the fix button handle mismatches)

2. **Remove Console Logs**:
   - Remove diagnostic logging in `useEffect` (lines 90-137)
   - Remove duplicate detection logs (lines 370, 376, 378, 387, 390, 394, 419)
   - Remove Zayo fix button logs (lines 1159, 1161, 1163, 1165)
   - Remove Zayo diagnostic logging in `firebaseHooks.ts` (lines 55-78)
   - Keep `console.error` for actual errors (network failures, etc.)

3. **Preserve Error Handling**:
   - Keep `console.error` and `console.warn` for actual errors
   - Remove informational/debugging `console.log` statements

**Acceptance Criteria**:
- [ ] Zayo only shows for February 2026 (where the actual Zayo statement exists)
- [ ] Zayo does NOT show for January 2026
- [ ] All unnecessary console.log statements removed from Reports.tsx
- [ ] All unnecessary console.log statements removed from firebaseHooks.ts
- [ ] Essential error logging (console.error) preserved
- [ ] Carrier status display is accurate for all months

---

#### 🔧 Ticket: Fix Statement Compare to Use AI for Column Detection
**Goal**: Fix Statement Compare to properly parse uploaded XLSX files by using AI (Gemini) to detect which columns match required fields, instead of using hardcoded column name mappings

**Problem**: 
- Statement Compare is not working correctly
- Current implementation uses hardcoded column name mappings (e.g., 'account name', 'otg comp', 'seller comp')
- Uploaded XLSX files may have different column names that don't match the hardcoded mappings
- Need to use AI to intelligently detect which columns in each tab (RD1/2, RD3/4, etc.) correspond to required fields
- Similar to how CSV analysis service uses Gemini for column mapping

**Root Cause**:
- `parseCsvToSellerStatements` function in `services/statementComparisonService.ts` (lines 80-94) uses hardcoded column name lookups
- Code tries to find columns by exact string matches: `['account name', 'account', 'customer name', 'client name']`
- If uploaded XLSX has different column names (e.g., "Account", "Client", "OTG Commission", "Seller Commission"), it won't find them
- No AI-powered column detection like the CSV analysis service uses

**Expected Behavior**:
- Upload XLSX file with tabs like "RD1/2", "RD3/4", "RM1/2", "RM3/4", "OVR/RD5", "OTG"
- For each tab, use Gemini AI to analyze the headers and detect which columns map to:
  - Account Name (or Client Name, Customer Name, etc.)
  - OTG Comp Billing Item (or Service Number, Billing Item, etc.)
  - OTG Comp (or Commission Amount, OTG Commission, etc.)
  - Seller Comp (or Seller Commission, Role Comp, etc.)
  - State (optional)
- Parse each tab using the AI-detected column mappings
- Compare parsed data with Firebase seller statements accurately

**DB**: None (parsing logic fix only)

**UI**: Statement Compare tab should work correctly with any XLSX file format

**Files to Update**:
- `services/statementComparisonService.ts`:
  - Update `parseCsvToSellerStatements` function (lines 51-149)
  - Add AI-powered column detection using Gemini (similar to `getColumnMapping` in `geminiService.ts`)
  - For each tab (RD1/2, RD3/4, etc.), analyze headers and detect column mappings
  - Use detected mappings to parse rows instead of hardcoded column names
  - Handle cases where AI can't detect certain columns (fallback to manual detection or error)

- `services/geminiService.ts` (optional):
  - Add new function `detectSellerStatementColumns` if needed
  - Or extend existing `getColumnMapping` to handle seller statement columns

**Implementation Details**:

1. **AI Column Detection Function**:
   - Create function `detectSellerStatementColumns(sheetHeaders: string[], sampleRows: any[][]): Promise<ColumnMapping>`
   - Use Gemini AI with structured schema to detect:
     - `accountName`: Column for Account Name/Client Name/Customer Name
     - `otgCompBillingItem`: Column for OTG Comp Billing Item/Service Number/Billing Item
     - `otgComp`: Column for OTG Comp/Commission Amount/OTG Commission
     - `sellerComp`: Column for Seller Comp/Seller Commission/Role Comp
     - `state`: Column for State/ST/State Code (optional)
   - Return column indices or column names that match

2. **Update `parseCsvToSellerStatements`**:
   - For each tab (RD1/2, RD3/4, etc.):
     - Extract headers from first row
     - Extract sample rows (first 5-10 rows) for context
     - Call AI detection function to get column mappings
     - Use detected mappings to parse all rows
     - Handle parsing errors gracefully

3. **Error Handling**:
   - If AI fails to detect required columns, show clear error message
   - Allow fallback to manual column detection if needed
   - Log which columns were detected for debugging

4. **Performance**:
   - Cache column mappings per tab if same file is re-uploaded
   - Process tabs in parallel if possible
   - Show loading state while AI is analyzing columns

**Column Mapping Schema** (for Gemini):
```typescript
{
  accountName: string;        // Column name/index for Account Name
  otgCompBillingItem: string; // Column name/index for OTG Comp Billing Item
  otgComp: string;            // Column name/index for OTG Comp
  sellerComp: string;         // Column name/index for Seller Comp
  state?: string;            // Column name/index for State (optional)
}
```

**Acceptance Criteria**:
- [ ] Statement Compare correctly parses XLSX files with different column names
- [ ] AI detects columns intelligently (not just exact string matches)
- [ ] Works for all role group tabs (RD1/2, RD3/4, RM1/2, RM3/4, OVR/RD5, OTG)
- [ ] Handles missing columns gracefully (shows clear error)
- [ ] Comparison results are accurate after parsing
- [ ] Performance is acceptable (AI analysis doesn't take too long)

---

#### Ticket: Add New Accounts and Line Items to Master Data 2
**Goal**: Add functionality to create new accounts and add new line items to existing accounts in Master Data 2

**Problem**: 
- Currently can only edit/delete existing line items
- No way to add new accounts
- No way to add new line items to existing accounts
- Need to make the comp key more usable for adding new data

**Current State**:
- Master Data 2 shows accounts grouped by Account **CARRIER** + OTG Comp Billing item
- `AccountDetailsModal` allows editing and deleting line items
- No "Add" functionality exists

**Desired Functionality**:

1. **Add New Account**:
   - Button in MasterDataList2: "Add New Account"
   - Opens modal/form to create new account
   - Requires: Account **CARRIER**, OTG Comp Billing item (these define the account)
   - Optionally pre-fill other fields with defaults
   - Creates new account with first line item
   - Account appears in account list after creation

2. **Add Line Item to Existing Account**:
   - Button in `AccountDetailsModal`: "Add Line Item"
   - Opens form/modal to add new line item to current account
   - Pre-fills Account **CARRIER** and OTG Comp Billing item (from account)
   - Allows editing all other fields
   - Adds line item to existing account
   - Updates account grouping automatically

**UI Design**:

**Add New Account Flow**:
```
MasterDataList2:
  [Add New Account] button
    ↓
  Modal/Form:
    - Account **CARRIER** (required)
    - OTG Comp Billing item (required)
    - Other fields (optional, with defaults)
    [Cancel] [Create Account]
```

**Add Line Item Flow**:
```
AccountDetailsModal:
  [Add Line Item] button
    ↓
  Form/Inline Editor:
    - Account **CARRIER** (pre-filled, disabled)
    - OTG Comp Billing item (pre-filled, disabled)
    - All other fields (editable)
    [Cancel] [Add Line Item]
```

**Required Fields** (for new accounts/line items):
- Account **CARRIER** (string) - Required
- OTG Comp Billing item (string) - Required
- Service Provider (string) - Optional but recommended
- COMP 1, COMP 2, COMP 3, COMP 4 (strings) - Optional
- Monthly Unit Price (number) - Optional
- EXPECTED/Mo. OTG Comp % (number/percent) - Optional
- All other 62 columns - Optional

**DB**: None (uses existing Firebase masterRecords collection)

**UI**: Add "Add New Account" and "Add Line Item" buttons and forms

**Files to Update**:
- `components/MasterDataList2.tsx`:
  - Add "Add New Account" button
  - Add modal/form for creating new account
  - Handle account creation (creates new MasterRecord)
  
- `components/AccountDetailsModal.tsx`:
  - Add "Add Line Item" button
  - Add form/inline editor for adding line item
  - Pre-fill Account **CARRIER** and OTG Comp Billing item
  - Handle line item creation (adds to existing account)

**Implementation Details**:

1. **Add New Account Modal**:
   - Create new component or add to MasterDataList2
   - Form fields for required fields (Account **CARRIER**, OTG Comp Billing item)
   - Optional fields can be added later via edit
   - On submit: Create new MasterRecord with all fields
   - Generate unique ID: `master-${Date.now()}-${Math.random()}`
   - Save to Firebase via `handleUpdate`
   - Close modal and show new account in list

2. **Add Line Item Form**:
   - Add to AccountDetailsModal (can be inline or modal)
   - Pre-fill Account **CARRIER** from account
   - Pre-fill OTG Comp Billing item from account
   - Show form fields for other important columns
   - On submit: Create new MasterRecord
   - Add to existing account (same Account **CARRIER** + OTG Comp Billing item)
   - Save to Firebase
   - Refresh account details

3. **Field Handling**:
   - Use existing `columns` array to determine which fields to show
   - Support all 62 columns dynamically
   - Required fields: Account **CARRIER**, OTG Comp Billing item
   - Optional fields: Everything else
   - Use appropriate input types (text, number, percent) based on column type

**Acceptance**:
- [ ] "Add New Account" button exists in MasterDataList2
- [ ] Clicking button opens form/modal
- [ ] Can create new account with Account **CARRIER** and OTG Comp Billing item
- [ ] New account appears in account list after creation
- [ ] "Add Line Item" button exists in AccountDetailsModal
- [ ] Clicking button opens form/inline editor
- [ ] Form pre-fills Account **CARRIER** and OTG Comp Billing item
- [ ] Can add new line item to existing account
- [ ] New line item appears in account details
- [ ] All fields save correctly to Firebase
- [ ] Account grouping updates correctly after adding
- [ ] Validation: Required fields must be filled
- [ ] Can cancel without saving

**Dependencies**: None

**Notes**: 
- Account is defined by Account **CARRIER** + OTG Comp Billing item combination
- New accounts need at least these two fields
- Line items added to account must have same Account **CARRIER** + OTG Comp Billing item
- Use existing Firebase hooks for saving (`useSaveMasterData2`)
- Consider showing most important fields first, then allow editing all fields
- Can reuse existing edit form logic for consistency

---

#### ✅ Ticket: Update Commissions Tab to Show Expandable Months Jan-Jun 2026 with Carrier Status (COMPLETED 2026-01-30)
**Goal**: Update Commissions tab to show January 2026 through June 2026 as expandable sections, each showing carrier statement upload status

**Completed Changes**:

1. **Month List Generation**:
   - Created array of months: Jan 2026 through Jun 2026
   - Merged with Firebase processing months (uses Firebase data if available, otherwise generated structure)

2. **UI Structure Updates**:
   - Removed month selector dropdown/buttons
   - Created expandable month sections (accordion) with chevron icons
   - Each month section shows carrier status (always visible) and seller statements (when expanded)
   - Status badges show Complete/Partial/Empty for each month

3. **Carrier Status Display**:
   - Shows carrier status grid for each month (always visible)
   - Displays ✅ for uploaded carriers, ❌ for missing carriers
   - Delete functionality with per-statement confirmation (fixed deletion bug)

4. **Seller Statements**:
   - Added Account View and Line Item View toggle
   - Account View: Groups items by account name with totals
   - Line Item View: Shows individual billing items (original view)
   - Both views show proper number formatting with commas

5. **Additional Improvements**:
   - Removed Master Data tab, renamed Master Data 2 to "Comp Key"
   - Added number formatting utility (formatCurrency, formatNumber, formatWholeNumber)
   - Removed "*" prefix from ENA account names (now uses provider field)
   - Fixed deletion confirmation to use statement ID instead of carrier name

**Files Updated**:
- `components/Reports.tsx` - Complete redesign with expandable months
- `components/Layout.tsx` - Removed Master Data tab, renamed to Comp Key
- `components/MasterDataList2.tsx` - Renamed to Comp Key
- `App.tsx` - Updated to use Comp Key as main tab
- `components/Dashboard.tsx` - Updated error messages
- `services/numberFormat.ts` - New utility for number formatting
- `components/AccountCard.tsx`, `AccountListItem.tsx`, `AccountDetailsModal.tsx` - Added number formatting
- `components/Dashboard.tsx`, `Disputes.tsx` - Added number formatting
- `services/carrierExtractors/zayoExtractor.ts` - Removed "*" prefix
- `services/carrierExtractors/gotoExtractor.ts` - Removed "*" prefix
- `services/matchingService.ts` - Updated to use provider field
- `services/sellerStatements.ts` - Updated to use provider field for ENA detection

**Acceptance**:
- [x] Shows 6 months: January 2026 through June 2026
- [x] Each month is expandable/collapsible
- [x] Carrier status grid shows for each month (always visible)
- [x] Status badge shows Complete/Partial/Empty for each month
- [x] January 2026 shows current seller statements when expanded
- [x] Other months show empty state when expanded (if no data)
- [x] Carrier status shows uploaded (✅) vs missing (❌) for each carrier
- [x] Expand/collapse works correctly
- [x] No month selector dropdown/buttons
- [x] UI is clean and organized
- [x] Account View and Line Item View toggle works
- [x] Number formatting with commas throughout
- [x] Deletion works correctly per statement (not per carrier)

**Dependencies**: None

---

#### ✅ Ticket: Switch Statement Processing to Use Master Data 2 (COMPLETED)
**Goal**: Update all statement processing automations to use Master Data 2 instead of Master Data

**Completed Changes**:

1. **Updated App.tsx**:
   - Changed `Dashboard` to receive `masterData2` instead of `masterData`
   - Master Data 2 now loaded from Firebase via `useMasterData2()` hook

2. **Updated Dashboard Component**:
   - Updated to use `masterData2` prop
   - Updated validation messages to reference "Master Data 2"
   - Added duplicate detection before processing (skips expensive operations)
   - Improved batch upload handling with progress indicators

3. **Master Data 2 Persistence**:
   - Implemented Firebase persistence (individual documents per record)
   - Added `saveMasterData2`, `updateMasterData2Record`, `deleteMasterData2Record` functions
   - Updated Firestore security rules and indexes
   - Fixed document size limits by using collection instead of single document

4. **Optimized Deletion Flow**:
   - Added optimistic UI updates for instant carrier statement removal
   - Implemented direct seller statement updates (removes items instead of regenerating)
   - Added batched updates for multiple deletions
   - Fixed duplicate key warnings in Reports component

5. **Performance Improvements**:
   - Duplicate detection now skips processing entirely
   - Seller statement updates use direct item removal (much faster than regeneration)
   - Added delays between batch operations to prevent write stream exhaustion

**Files Updated**:
- `App.tsx` - Now passes `masterData2` to Dashboard
- `components/Dashboard.tsx` - Uses masterData2, added duplicate detection
- `components/MasterDataList2.tsx` - Firebase persistence, loading states
- `components/Reports.tsx` - Optimistic updates, direct seller statement updates
- `services/firebaseMutations.ts` - Master Data 2 CRUD, optimized deletion
- `services/firebaseHooks.ts` - Master Data 2 hooks
- `services/firebaseQueries.ts` - Master Data 2 queries
- `firestore/firestore.rules` - Added masterData2 collection rules
- `firestore/firestore.indexes.json` - Added masterData2 indexes
- `components/Dashboard.tsx` - Update prop and references to use Master Data 2
- Update any validation messages to say "Master Data 2" instead of "Master Data"

**Files That Don't Need Changes** (they accept parameter):
- `services/carrierStatementPipeline.ts` - Already accepts `masterData` parameter
- `services/matchingService.ts` - Already accepts `masterData` parameter
- `services/disputeDetection.ts` - Already accepts `masterData` parameter
- `services/carrierStatementProcessor.ts` - Already accepts `masterData` parameter
- `services/stateLookup.ts` - Already accepts `masterData` parameter
- `services/geminiService.ts` - Already accepts `masterData` parameter

**DB**: None

**UI**: Update Dashboard to use Master Data 2

**Acceptance**:
- [ ] Dashboard receives `masterData2` from App.tsx
- [ ] Statement upload uses Master Data 2 for processing
- [ ] Carrier statement processing uses Master Data 2 for matching
- [ ] Vendor statement analysis uses Master Data 2 for matching
- [ ] State lookup uses Master Data 2
- [ ] Dispute detection uses Master Data 2
- [ ] Validation messages reference "Master Data 2"
- [ ] All automations work correctly with Master Data 2
- [ ] No references to old `masterData` in statement processing flow

**Dependencies**: None

**Notes**: 
- This is a simple prop/parameter change - services already accept masterData as parameter
- Master Data 2 has all 62 columns vs Master Data which may have fewer
- Ensure Master Data 2 is loaded before processing statements
- Test that matching still works correctly with Master Data 2 structure

---

### ✅ Completed Slices
- Clean Up Master Data CSV and Import to Firebase (2026-01-28) - Added CSV analysis and cleaning services using Gemini, created Master Data 2 tab with all 62 columns, implemented CSV reformatting script

### 🔄 In Progress

### 📋 Backlog

#### Ticket: Clean Up Master Data CSV and Import to Firebase
**Goal**: Use Gemini 2.5 Flash to analyze and clean up the master data CSV, then import it into Firebase Firestore

**Problem**: 
- Master data CSV has 60+ columns with complex headers
- Data needs to be cleaned, organized, and understood before importing
- Currently master data is only stored in React state (lost on refresh)
- Need to store master data in Firebase for persistence

**CSV Headers** (from user):
- ST, Account **CARRIER**, Carrier Comp Type, Carrier Relationship, Service Provider, Status / Type, Opportunity Promo Year, Promo Year Revenue, Install Date OR OTG Payable Date, OTG Comp Billing item, Cust. ACTIVE BAN, Historic BAN, Item Desc., PAYING Monthly Comp %, Quantity, Price, Monthly Unit Price, EXPECTED/Mo. OTG Comp %, Monthly Comp to OTG, One-Time Unit Price, One-Time Comp %, One-Time Comp Expected, Cust. Billed Type, COMP 1, COMP 2, COMP 3, COMP 4, before 07/2025 COMP 1-4, NOTES, MISSING OTG COMP, SVC Change Date, Prev. Unit Price, OTG Compensable Product NAME, MISSING MONDAY, Sig Date, Term, Location Name, Service Address, Order #, Circuit ID, Unique Order Details, TED, Renewal Details, Monday Product Comments, Monday Item ID, COMP CALC, OTG PD since July, and monthly seller statements (July through June)

**Current State**:
- Master data stored in React state (`App.tsx`)
- CSV file: `OTG.0 Comp Key AFTER 07_2025 - NEW Comp Key - 20260115_160812.csv`
- Gemini API key added to `.env.local`
- No Firebase storage for master data yet

**Tasks**:

1. **Use Gemini to Analyze CSV**:
   - Create a service function that uses Gemini 2.5 Flash to analyze the CSV
   - Send CSV headers and sample rows to Gemini
   - Ask Gemini to:
     * Identify which columns are essential vs optional
     * Suggest data cleaning/organization
     * Identify duplicate or redundant columns
     * Suggest data normalization
     * Identify data quality issues
     * Map columns to our MasterRecord structure

2. **Create CSV Analysis Service**:
   - `services/csvAnalysisService.ts` - Uses Gemini to analyze CSV
   - Function: `analyzeMasterDataCSV(csvContent: string): Promise<CSVAnalysis>`
   - Returns: Column importance, data quality issues, cleaning suggestions, mapping suggestions

3. **Create CSV Cleaning Service**:
   - `services/csvCleaningService.ts` - Cleans CSV based on Gemini analysis
   - Function: `cleanMasterDataCSV(csvContent: string, analysis: CSVAnalysis): Promise<CleanedCSVData>`
   - Handles: Removing duplicates, normalizing values, fixing data types, removing empty rows

4. **Create Firebase Master Data Service**:
   - `services/firebaseMasterData.ts` - Firebase operations for master data
   - Create `masterRecords` collection in Firestore
   - Functions:
     * `uploadMasterData(records: MasterRecord[]): Promise<void>` - Batch upload
     * `getMasterData(): Promise<MasterRecord[]>` - Get all records
     * `updateMasterRecord(id: string, data: Partial<MasterRecord>): Promise<void>`
     * `deleteMasterRecord(id: string): Promise<void>`

5. **Create Firestore Schema**:
   - Add `masterRecords` collection to Firestore
   - Schema matches `MasterRecord` TypeScript interface
   - Indexes: `clientName`, `otgCompBillingItem`, `serviceType`

6. **Create Import UI**:
   - Add "Analyze CSV" button to Master Data tab
   - Show Gemini analysis results (column importance, issues, suggestions)
   - Add "Clean & Import" button that:
     * Cleans CSV using Gemini suggestions
     * Converts to MasterRecord format
     * Uploads to Firebase
   - Show progress and results

7. **Update App to Use Firebase**:
   - Replace React state master data with Firebase queries
   - Use `useMasterData()` hook from Firebase service
   - Update `MasterDataList` to sync with Firebase

**DB**: Create `masterRecords` Firestore collection

**UI**: Add CSV analysis and import UI to Master Data tab

**Files to Create**:
- `services/csvAnalysisService.ts` - Gemini CSV analysis
- `services/csvCleaningService.ts` - CSV cleaning logic
- `services/firebaseMasterData.ts` - Firebase master data operations
- `services/firebaseMasterDataHooks.ts` - React hooks for master data

**Files to Update**:
- `components/MasterDataList.tsx` - Add CSV analysis/import UI
- `App.tsx` - Use Firebase master data instead of state
- `firestore/firestore.rules` - Add rules for `masterRecords` collection
- `firestore/firestore.indexes.json` - Add indexes for master data queries

**Gemini Analysis Prompt** (for `csvAnalysisService.ts`):
```
You are analyzing a master data CSV file for a commission reconciliation system.

CSV Headers: [list all headers]
Sample Rows: [first 5-10 rows]

Please analyze this CSV and provide:
1. **Essential Columns**: Which columns are critical for commission matching and calculations?
2. **Optional Columns**: Which columns are nice-to-have but not essential?
3. **Data Quality Issues**: Any missing values, inconsistencies, or errors?
4. **Column Mapping**: Map CSV columns to our MasterRecord structure:
   - clientName (Account **CARRIER**)
   - serviceType (Service Provider)
   - salesperson (COMP 1)
   - expectedAmount (Monthly Unit Price)
   - splitPercentage (EXPECTED/Mo. OTG Comp %)
   - otgCompBillingItem (OTG Comp Billing item)
   - state (ST)
   - [other fields]
5. **Cleaning Suggestions**: How should we clean/normalize this data?
6. **Duplicate Detection**: Are there duplicate records? How to identify them?
7. **Data Normalization**: Any values that need standardization?
```

**Acceptance**:
- [ ] Gemini analyzes CSV and provides insights (column importance, issues, suggestions)
- [ ] CSV analysis service created and working
- [ ] CSV cleaning service created and working
- [ ] Firebase `masterRecords` collection created
- [ ] Firebase master data service created (upload, get, update, delete)
- [ ] CSV can be analyzed using Gemini
- [ ] CSV can be cleaned based on Gemini suggestions
- [ ] Master data can be imported to Firebase
- [ ] Master data loads from Firebase on app start
- [ ] Master Data tab shows data from Firebase
- [ ] CRUD operations sync with Firebase
- [ ] No data loss during migration

**Dependencies**: 
- Gemini API key in `.env.local` (already done ✅)
- Firebase project set up (already done ✅)

**Notes**: 
- Use Gemini 2.5 Flash model (fast and cost-effective)
- CSV has 60+ columns - focus on essential ones first
- Master data is used for matching carrier statements - ensure key fields are preserved
- Account grouping uses "Account **CARRIER**" + "OTG Comp Billing item" - preserve these fields
- COMP 1-4 columns are used for role splits - preserve these
- Consider batching Firebase writes for large imports (500 records per batch)

---
**Goal**: Fix Firebase import errors and ensure the Firebase backend is fully functional for uploading and deleting carrier statements

**Problem**: 
- Error: `Failed to resolve import "firebase/app" from "services/firebaseClient.ts"`
- Firebase package is in `package.json` but not installed in `node_modules`
- Need to verify Firebase is properly set up and working
- Need to test upload and delete functionality

**Root Cause**:
- `firebase` package is listed in `package.json` but dependencies haven't been installed
- Need to run `npm install` to install Firebase SDK
- May need to verify Firebase configuration is correct
- Need to ensure Firestore and Storage are properly initialized

**DB**: None (setup/verification only)

**UI**: None (backend setup only)

**Files to Check/Update**:
- `package.json` - Verify Firebase is listed (already there ✅)
- `node_modules/` - Ensure Firebase is installed (run `npm install`)
- `services/firebaseClient.ts` - Verify imports and initialization
- `.env.local` - Verify Firebase config variables are set (already set ✅)
- `firebase.json` - Verify Firebase project configuration
- `.firebaserc` - Verify Firebase project ID matches

**Steps to Fix**:

1. **Install Dependencies**:
   - Run `npm install` to install Firebase SDK
   - Verify `node_modules/firebase` exists
   - Check for any installation errors

2. **Verify Firebase Configuration**:
   - Check `.env.local` has all required Firebase config variables
   - Verify Firebase project exists and is accessible
   - Test Firebase connection

3. **Verify Firestore Setup**:
   - Check Firestore database is enabled in Firebase Console
   - Verify security rules allow read/write (test mode is OK for now)
   - Test creating a document

4. **Verify Cloud Storage Setup**:
   - Check Cloud Storage is enabled in Firebase Console
   - Verify security rules allow read/write (test mode is OK for now)
   - Test uploading a file

5. **Test Backend Operations**:
   - Test uploading a carrier statement
   - Test storing matches
   - Test generating seller statements
   - Test deleting a carrier statement
   - Verify seller statements regenerate correctly

**Acceptance**:
- [ ] Firebase package installed (`npm install` completed successfully)
- [ ] No import errors for `firebase/app`, `firebase/firestore`, `firebase/storage`
- [ ] Firebase client initializes without errors
- [ ] Firestore connection works (can read/write)
- [ ] Cloud Storage connection works (can upload/download)
- [ ] Can upload carrier statement (file to Storage, metadata to Firestore)
- [ ] Can store matches in Firestore
- [ ] Can generate and store seller statements
- [ ] Can query seller statements
- [ ] Can delete carrier statement (removes file, metadata, matches)
- [ ] Seller statements regenerate correctly after delete
- [ ] No console errors related to Firebase
- [ ] App runs without Firebase-related errors

**Dependencies**: 
- Firebase project must be set up (already done ✅)
- Firebase config in `.env.local` (already done ✅)

**Notes**: 
- This is a setup/verification ticket - should be quick
- Main issue is likely just missing `npm install`
- After fixing, test all Firebase operations to ensure everything works
- If there are other issues, fix them as part of this ticket

---

#### Ticket: Migrate from Convex to Firebase Backend
**Goal**: Delete Convex backend and migrate entire backend to Firebase (Firestore + Cloud Storage)

**Why Firebase?**:
- More flexible and scalable than Convex
- Better file storage integration (Cloud Storage)
- More control over data structure and queries
- Better for complex data operations
- Industry-standard backend solution

**Migration Steps**:

1. **Setup Firebase MCP in Cursor**:
   - Configure Firebase MCP server in Cursor settings
   - This allows AI to interact with Firebase during migration

2. **Setup Firebase Project**:
   - Create Firebase project (or use existing)
   - Enable Firestore Database
   - Enable Cloud Storage
   - Get Firebase config (API keys, project ID, etc.)

3. **Install Firebase Dependencies**:
   - Install `firebase` npm package
   - Remove `convex` package (or keep temporarily for reference)

4. **Create Firestore Schema**:
   - Design collections: `carrierStatements`, `matches`, `sellerStatements`
   - Define data structure matching current Convex schema
   - Set up indexes for queries

5. **Create Firebase Service Layer**:
   - Replace `convex/mutations.ts` → `services/firebaseMutations.ts`
   - Replace `convex/queries.ts` → `services/firebaseQueries.ts`
   - Replace `services/convexClient.ts` → `services/firebaseClient.ts`
   - Update `services/convexHooks.ts` → `services/firebaseHooks.ts`

6. **Migrate File Storage**:
   - Move from Convex file storage to Firebase Cloud Storage
   - Update upload/download logic

7. **Update Client Components**:
   - Update `components/Dashboard.tsx` to use Firebase
   - Update `components/Reports.tsx` to use Firebase
   - Update `components/ProcessingMonths.tsx` to use Firebase
   - Remove Convex imports, add Firebase imports

8. **Remove Convex Code**:
   - Delete `convex/` directory
   - Remove Convex environment variables
   - Clean up Convex-related code

**Firebase Structure**:

**Firestore Collections**:

```typescript
// Collection: carrierStatements
{
  id: string (auto-generated),
  filename: string,
  carrier: 'GoTo' | 'Lumen' | 'MetTel' | 'TBO' | 'Zayo' | 'Allstream',
  statementMonth: string, // "YYYY-MM"
  processingMonth: string, // "YYYY-MM"
  fileUrl: string, // Cloud Storage URL
  uploadedAt: Timestamp,
}

// Collection: matches
{
  id: string (auto-generated),
  processingMonth: string, // "YYYY-MM"
  matchedRow: object, // MatchedRow data
  carrierStatementId: string, // Reference to carrierStatements
  createdAt: Timestamp,
}

// Collection: sellerStatements
{
  id: string (auto-generated),
  processingMonth: string, // "YYYY-MM"
  roleGroup: 'RD1/2' | 'RD3/4' | 'RM1/2' | 'RM3/4' | 'OVR/RD5' | 'OTG',
  items: array, // SellerStatementItem[]
  totalOtgComp: number,
  totalSellerComp: number,
  processedAt: Timestamp,
}
```

**Firestore Indexes Needed**:
- `carrierStatements`: Index on `processingMonth`, composite index on `carrier` + `processingMonth`
- `matches`: Index on `processingMonth`, index on `carrierStatementId`
- `sellerStatements`: Index on `processingMonth`

**Cloud Storage Structure**:
- Bucket: `carrier-statements/{processingMonth}/{carrier}/{filename}`

**DB**: Migrate from Convex to Firebase Firestore + Cloud Storage

**UI**: Update all components to use Firebase instead of Convex

**Files to Create**:
- `services/firebaseClient.ts` - Initialize Firebase app
- `services/firebaseMutations.ts` - Firebase write operations
- `services/firebaseQueries.ts` - Firebase read operations
- `services/firebaseHooks.ts` - React hooks for Firebase
- `firebase.json` - Firebase configuration
- `.firebaserc` - Firebase project configuration
- `firestore.rules` - Security rules
- `storage.rules` - Storage security rules

**Files to Update**:
- `package.json` - Add Firebase, remove Convex
- `components/Dashboard.tsx` - Use Firebase hooks
- `components/Reports.tsx` - Use Firebase hooks
- `components/ProcessingMonths.tsx` - Use Firebase hooks
- `App.tsx` - Remove Convex provider, add Firebase init
- `.env.local` - Add Firebase config, remove Convex URL

**Files to Delete**:
- `convex/` directory (entire folder)
- `services/convexClient.ts`
- `docs/CONVEX_MCP_SETUP.md` (or update to Firebase)

**Acceptance**:
- [ ] Firebase MCP configured in Cursor
- [ ] Firebase project created and configured
- [ ] Firebase dependencies installed
- [ ] Firestore collections created with correct schema
- [ ] Cloud Storage bucket configured
- [ ] Firebase client initialized
- [ ] Can upload carrier statement (file to Storage, metadata to Firestore)
- [ ] Can store matches in Firestore
- [ ] Can generate and store seller statements
- [ ] Can query seller statements by processing month
- [ ] Can delete carrier statement (removes file, metadata, matches)
- [ ] Seller statements regenerate correctly after delete
- [ ] All Convex code removed
- [ ] App works with Firebase backend

**Dependencies**: 
- Firebase project setup
- Firebase MCP configuration

**Notes**: 
- Keep Convex code temporarily for reference during migration
- Test each step before moving to next
- Firebase MCP will help with migration - AI can interact with Firebase directly
- Consider data migration if there's existing Convex data (may need export/import script)

---
**Goal**: Delete and rebuild the Convex backend with a simple, clean implementation focused on core functionality: upload carrier statements, delete them, and process seller statements from matches

**Problem**: 
- Current backend has become overly complex with continuation patterns, byte tracking, partial processing, etc.
- Multiple mutations and queries that may have bugs or unnecessary complexity
- Need a clean, simple backend that just works for the core use case

**Core Requirements** (Keep It Simple):

1. **Upload Carrier Statements**:
   - Upload XLSX file to Convex file storage
   - Store metadata: filename, carrier, statementMonth, processingMonth, fileId, uploadedAt
   - Check for duplicates (same carrier + processingMonth) and allow replacing
   - Process statement: extract rows, match against master data, store matches
   - Generate seller statements from all matches for the processing month

2. **Delete Carrier Statements**:
   - Delete the carrier statement record
   - Delete associated matches for that statement
   - Regenerate seller statements from remaining matches for that processing month
   - Clean up file from storage

3. **Seller Statements**:
   - Automatically generated when carrier statement is uploaded
   - Regenerated when carrier statement is deleted
   - Show all commissionable items from ALL carriers for a processing month
   - Aggregate matches correctly across all carriers

**What to Keep**:
- Basic schema: `carrierStatements`, `matches`, `sellerStatements` tables
- File storage for XLSX files
- Processing month concept (for organizing statements)

**What to Remove/Simplify**:
- Complex continuation patterns
- Byte tracking logic
- Partial processing states
- `processingMonths` table (can derive from carrierStatements queries)
- Overly complex mutations with many edge cases
- Any deprecated fields or unused code

**DB Schema** (Simplified):

```typescript
// convex/schema.ts
export default defineSchema({
  carrierStatements: defineTable({
    filename: v.string(),
    carrier: v.union(
      v.literal("GoTo"),
      v.literal("Lumen"),
      v.literal("MetTel"),
      v.literal("TBO"),
      v.literal("Zayo"),
      v.literal("Allstream")
    ),
    statementMonth: v.string(), // "YYYY-MM"
    processingMonth: v.string(), // "YYYY-MM"
    fileId: v.id("_storage"),
    uploadedAt: v.number(),
  })
    .index("by_processing_month", ["processingMonth"])
    .index("by_carrier_month", ["carrier", "processingMonth"]),

  matches: defineTable({
    processingMonth: v.string(), // "YYYY-MM"
    matchedRow: v.any(), // MatchedRow
    carrierStatementId: v.id("carrierStatements"),
  })
    .index("by_processing_month", ["processingMonth"])
    .index("by_carrier_statement", ["carrierStatementId"]),

  sellerStatements: defineTable({
    processingMonth: v.string(), // "YYYY-MM"
    roleGroup: v.union(
      v.literal("RD1/2"),
      v.literal("RD3/4"),
      v.literal("RM1/2"),
      v.literal("RM3/4"),
      v.literal("OVR/RD5"),
      v.literal("OTG")
    ),
    items: v.array(v.any()), // SellerStatementItem[]
    totalOtgComp: v.number(),
    totalSellerComp: v.number(),
    processedAt: v.number(),
  })
    .index("by_processing_month", ["processingMonth"]),
});
```

**Mutations Needed** (Simple):

1. `uploadCarrierStatement`:
   - Generate upload URL
   - Check for duplicate
   - Store metadata after file upload
   - Process statement (extract, match, store matches)
   - Generate seller statements from ALL matches for processing month

2. `deleteCarrierStatement`:
   - Delete matches for this statement
   - Delete statement record
   - Delete file from storage
   - Regenerate seller statements from remaining matches

**Queries Needed** (Simple):

1. `getCarrierStatements` - Get all (optionally filtered by processingMonth)
2. `getSellerStatements` - Get seller statements for a processing month
3. `getFileUrl` - Get download URL for a file

**DB**: Rebuild schema, mutations, queries

**UI**: May need minor updates to use simplified mutations/queries

**Files to Create/Update**:
- `convex/schema.ts` - Simplified schema (remove processingMonths table, clean up carrierStatements)
- `convex/mutations.ts` - Rebuild with simple mutations:
  - `uploadCarrierStatement` - Simple upload + process
  - `deleteCarrierStatement` - Simple delete + regenerate
- `convex/queries.ts` - Rebuild with simple queries:
  - `getCarrierStatements`
  - `getSellerStatements`
  - `getFileUrl`
- Update client code (`components/Dashboard.tsx`, `components/Reports.tsx`, `components/ProcessingMonths.tsx`) to use simplified API
- Update `services/convexHooks.ts` if needed

**Implementation Approach**:
1. Delete existing `convex/mutations.ts` and `convex/queries.ts` (or rename as backup)
2. Create new simple implementations from scratch
3. Use existing `generateSellerStatements` from `services/sellerStatements.ts` (client-side)
4. Process matches in client-side code, then store results
5. Keep it simple - avoid complex pagination, byte tracking, continuation patterns
6. If hitting limits, use `.collect()` with reasonable limits or process in smaller chunks client-side

**Acceptance**:
- [ ] Can upload carrier statement (XLSX file)
- [ ] File stored in Convex file storage
- [ ] Metadata stored in `carrierStatements` table
- [ ] Matches stored in `matches` table
- [ ] Seller statements generated and stored in `sellerStatements` table
- [ ] Can delete carrier statement
- [ ] Deleting removes statement, matches, and file
- [ ] Seller statements regenerate correctly after delete
- [ ] Seller statements show items from ALL carriers for processing month
- [ ] No complex continuation patterns or byte tracking
- [ ] Code is simple and easy to understand
- [ ] Works correctly with multiple carriers for same processing month

**Dependencies**: None

**Notes**: 
- Start fresh - delete complex code and rebuild simple version
- Use existing client-side processing logic (`services/sellerStatements.ts`, `services/matchingService.ts`)
- Process matches client-side, then store results in Convex
- Keep mutations/queries simple - let client handle complexity
- If hitting Convex limits, process in smaller batches client-side before storing

---
**Goal**: Fix "Too many bytes read" error (16MB limit exceeded) when regenerating seller statements for processing months with many matches

**Problem**: 
- Error: "Too many bytes read in a single function execution (limit: 16777216 bytes)"
- Occurs in `convex/mutations.ts` line 340 in `regenerateSellerStatements` mutation
- Happens when processing months with many matches across multiple carriers
- Even with batch processing (25 rows per batch), cumulative reads exceed Convex's 16MB limit

**Root Cause**:
- `regenerateSellerStatements` processes matches in batches of 25 rows per carrier
- Each `matchedRow` object can be large (100KB+) as it contains full carrier statement data
- Convex tracks total bytes read across ALL queries in a single function execution
- With 6 carriers and hundreds/thousands of matches, cumulative reads exceed 16MB limit
- Current batching doesn't prevent hitting the limit because it's cumulative across all batches

**Current Implementation**:
- Processes each carrier statement sequentially
- Fetches matches in batches of 25 using ID-based pagination
- Aggregates seller statements incrementally in memory
- Stores final seller statements at the end
- Problem: Too many batches = too many reads = exceeds 16MB limit

**DB**: None (bug fix in mutation logic)

**UI**: None (bug fix only, but will fix error when regenerating seller statements)

**Solution Options**:

1. **Track Bytes Read and Stop Before Limit** (Recommended):
   - Estimate bytes read per batch (JSON.stringify length)
   - Track cumulative bytes read
   - Stop processing when approaching limit (e.g., 15MB)
   - Store partial seller statements
   - Return status indicating partial completion
   - Allow client to call mutation again to continue from where it left off

2. **Use Smaller Batches with Stricter Limits**:
   - Reduce batch size further (e.g., 10 rows)
   - Add hard limit on total batches processed
   - Process fewer carriers per execution
   - Store partial results and allow continuation

3. **Split into Multiple Mutations**:
   - Create `regenerateSellerStatementsPartial` that processes one carrier at a time
   - Client calls it sequentially for each carrier
   - Each call stays under limit
   - Final call aggregates and stores seller statements

4. **Use Scheduled Actions/Background Processing**:
   - Move heavy processing to scheduled action
   - Process in chunks over time
   - More complex but handles very large datasets

**Recommended Approach**: Option 1 - Track bytes read and implement continuation pattern

**Files to Update**:
- `convex/mutations.ts` - Fix `regenerateSellerStatements` mutation:
  - Add byte tracking (estimate size of each batch)
  - Stop processing when approaching 15MB limit
  - Store partial seller statements if needed
  - Return continuation token/status if partial
  - Allow resuming from last processed carrier/ID
- Consider adding `regenerateSellerStatementsContinue` mutation for resuming partial processing

**Expected Behavior**:
- Mutation processes matches without hitting read limit
- If dataset is too large, processes what it can and returns partial status
- Client can call mutation again to continue processing
- Seller statements are correctly generated from all matches (even if processed in multiple calls)

**Acceptance**:
- [x] Mutation processes matches without hitting 16MB read limit
- [x] Byte tracking accurately estimates bytes read per batch
- [x] Stops processing before hitting limit (e.g., at 15MB)
- [x] Returns status indicating if processing is complete or partial
- [x] Partial processing stores intermediate state (if needed)
- [x] Can resume processing from where it left off (if partial)
- [x] Seller statements correctly aggregate from all matches (even across multiple mutation calls)
- [x] Works correctly with 6 carriers and thousands of matches
- [x] Error handling for edge cases (no matches, single carrier, etc.)

**Implementation Notes** (2026-01-26):
- Implemented Option 1: Track bytes read and stop before limit with continuation pattern
- Added byte tracking using `JSON.stringify(batch).length` to estimate bytes read per batch
- Tracks cumulative bytes read across all batches
- Stops processing when approaching 15MB limit (leaves 1MB headroom)
- Returns partial status with continuation info (`lastCarrierIndex`, `lastMatchId`) when hitting limit
- Supports merging partial seller statements with existing ones for continuation
- Client code (`Reports.tsx`) automatically handles continuation - calls mutation repeatedly until complete
- Added comprehensive logging for debugging byte tracking and continuation
- Handles edge cases: no matches, single carrier, empty processing month
- Works seamlessly with large datasets - processes in multiple iterations automatically

**Dependencies**: None

**Notes**: 
- Convex tracks cumulative bytes read across all queries in a single function execution
- Even small batches can exceed limit if there are many matches
- Need to balance between processing efficiency and staying under limit
- Consider that `matchedRow` objects are large (contain full carrier statement data)
- May need to optimize data structure or use a different aggregation approach

---

#### Ticket: Fix Missing Convex Query Error in Dashboard
**Goal**: Remove unused Convex query hook that's causing console error when accessing Upload Statement tab

**Problem**: 
- `Dashboard.tsx` line 55 calls `useQuery(api.queries.getMatchedRowsForRegeneration)` 
- This query doesn't exist in `convex/queries.ts`
- Causes error: "Could not find public function for 'queries:getMatchedRowsForRegeneration'"
- The query hook is declared but never used - the actual work is done by `fetchAllMatchedRows` mutation

**DB**: None

**UI**: None (bug fix only)

**Files to Update**:
- `components/Dashboard.tsx` - Remove line 55: `const getMatchedRowsForRegeneration = useQuery(api.queries.getMatchedRowsForRegeneration);`

**Acceptance**:
- [ ] Removed unused query hook from Dashboard.tsx
- [ ] No console errors when accessing Upload Statement tab
- [ ] Upload functionality still works correctly
- [ ] No other functionality broken

**Dependencies**: None

**Notes**: 
- This is a simple cleanup - the query hook was never implemented and isn't needed
- The `fetchAllMatchedRows` mutation handles the actual work

---

#### Ticket: Convex Backend Integration for Carrier Statement Storage
**Goal**: Integrate Convex backend to persistently store uploaded carrier statements, track processing months, prevent duplicate uploads, and improve month distinction in Commissions section

**Key Requirements**:

1. **Convex Schema Setup**:
   - Create `carrierStatements` table to store uploaded statement files and metadata
   - Create `processingMonths` table to track which carriers are uploaded per month
   - Create `sellerStatements` table to store processed seller statement data per month
   - Create `matches` table to store matched rows per processing month
   - Use Convex file storage for actual XLSX files
   - Store file metadata (filename, carrier, statement month, processing month, upload date)

2. **Carrier Statement Storage**:
   - Store uploaded XLSX files in Convex file storage
   - Store statement metadata in `carrierStatements` table:
     - `id` (Id<"carrierStatements">)
     - `filename` (string)
     - `carrier` (string: 'GoTo' | 'Lumen' | 'MetTel' | 'TBO' | 'Zayo' | 'Allstream')
     - `statementMonth` (string: "YYYY-MM")
     - `processingMonth` (string: "YYYY-MM")
     - `fileId` (Id<"_storage">) - Reference to Convex file storage
     - `uploadedAt` (number: timestamp)
     - `extractedRows` (array of CarrierStatementRow) - Store extracted data
     - `matchedRows` (array of MatchedRow) - Store matched data
   - Prevent duplicate uploads: Check if same carrier + processing month already exists
   - Allow replacing: If duplicate detected, update existing record instead of creating new one

3. **Processing Month Tracking**:
   - Create/update `processingMonths` table:
     - `id` (Id<"processingMonths">)
     - `monthKey` (string: "YYYY-MM")
     - `monthLabel` (string: "Month YYYY")
     - `carriers` (object with carrier keys: GoTo, Lumen, MetTel, TBO, Zayo, Allstream)
     - `status` (string: 'complete' | 'partial' | 'empty')
     - `lastProcessedAt` (number: timestamp, optional)
   - Track which carriers are uploaded per month
   - Update status automatically (complete when all 6 carriers uploaded)

4. **Seller Statements Storage**:
   - Store processed seller statements in `sellerStatements` table:
     - `id` (Id<"sellerStatements">)
     - `processingMonth` (string: "YYYY-MM")
     - `roleGroup` (string: 'RD1/2' | 'RD3/4' | 'RM1/2' | 'RM3/4' | 'OVR/RD5' | 'OTG')
     - `items` (array of SellerStatementItem)
     - `totalOtgComp` (number)
     - `totalSellerComp` (number)
     - `processedAt` (number: timestamp)
   - Link seller statements to processing months
   - Allow querying by processing month

5. **Month Distinction in Commissions**:
   - Update `Reports.tsx` (Commissions component) to:
     - Group seller statements by processing month
     - Show month selector/filter at top
     - Display month label prominently for each group
     - Show "December 2025", "January 2026", etc. as section headers
     - Display carrier status indicators per month
     - Show which carriers contributed to each month's totals
   - Make it clear which month each seller statement belongs to

6. **Upload Statement Management**:
   - Create UI component to show uploaded statements per month
   - Display list of uploaded carrier statements with:
     - Carrier name
     - Statement month
     - Processing month
     - Upload date
     - File size
     - Status (Uploaded, Processed)
   - Allow viewing/downloading uploaded statements
   - Show duplicate warning if trying to upload same carrier/month again
   - Allow replacing existing statement

7. **Convex Functions**:
   - `mutations.ts`:
     - `uploadCarrierStatement` - Upload file, store metadata, update processing month
     - `replaceCarrierStatement` - Replace existing statement
     - `processCarrierStatement` - Process statement, create matches, generate seller statements
     - `updateSellerStatements` - Update seller statements for a processing month
   - `queries.ts`:
     - `getCarrierStatements` - Get all statements (optionally filtered by processing month)
     - `getProcessingMonths` - Get all processing months with carrier status
     - `getSellerStatements` - Get seller statements for a processing month
     - `getCarrierStatementById` - Get single statement with file download
     - `checkDuplicate` - Check if carrier/month combination already exists

**DB Schema** (Convex):

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  carrierStatements: defineTable({
    filename: v.string(),
    carrier: v.union(
      v.literal("GoTo"),
      v.literal("Lumen"),
      v.literal("MetTel"),
      v.literal("TBO"),
      v.literal("Zayo"),
      v.literal("Allstream")
    ),
    statementMonth: v.string(), // "YYYY-MM"
    processingMonth: v.string(), // "YYYY-MM"
    fileId: v.id("_storage"),
    uploadedAt: v.number(),
    extractedRows: v.optional(v.array(v.any())), // CarrierStatementRow[]
    matchedRows: v.optional(v.array(v.any())), // MatchedRow[]
    processedAt: v.optional(v.number()),
  })
    .index("by_processing_month", ["processingMonth"])
    .index("by_carrier_month", ["carrier", "processingMonth"]),

  processingMonths: defineTable({
    monthKey: v.string(), // "YYYY-MM"
    monthLabel: v.string(), // "Month YYYY"
    carriers: v.object({
      GoTo: v.optional(v.id("carrierStatements")),
      Lumen: v.optional(v.id("carrierStatements")),
      MetTel: v.optional(v.id("carrierStatements")),
      TBO: v.optional(v.id("carrierStatements")),
      Zayo: v.optional(v.id("carrierStatements")),
      Allstream: v.optional(v.id("carrierStatements")),
    }),
    status: v.union(
      v.literal("complete"),
      v.literal("partial"),
      v.literal("empty")
    ),
    lastProcessedAt: v.optional(v.number()),
  })
    .index("by_month_key", ["monthKey"]),

  sellerStatements: defineTable({
    processingMonth: v.string(), // "YYYY-MM"
    roleGroup: v.union(
      v.literal("RD1/2"),
      v.literal("RD3/4"),
      v.literal("RM1/2"),
      v.literal("RM3/4"),
      v.literal("OVR/RD5"),
      v.literal("OTG")
    ),
    items: v.array(v.any()), // SellerStatementItem[]
    totalOtgComp: v.number(),
    totalSellerComp: v.number(),
    processedAt: v.number(),
  })
    .index("by_processing_month", ["processingMonth"]),

  matches: defineTable({
    processingMonth: v.string(), // "YYYY-MM"
    matchedRow: v.any(), // MatchedRow
    carrierStatementId: v.id("carrierStatements"),
  })
    .index("by_processing_month", ["processingMonth"]),
});
```

**UI Changes**:

1. **Upload Statement Tab**:
   - Check for duplicates before uploading
   - Show existing statements for selected processing month
   - Display "Replace" option if duplicate detected
   - Show upload progress and confirmation

2. **Processing Months View** (new component or section):
   - List all processing months
   - Show carrier status indicators per month
   - Show uploaded statements per month
   - Allow filtering/viewing by month

3. **Commissions Tab (Reports.tsx)**:
   - Add month selector/filter at top
   - Group seller statements by processing month
   - Show month headers: "December 2025", "January 2026", etc.
   - Display carrier status per month
   - Show which carriers contributed to totals
   - Make month distinction very clear

**Files to Create/Update**:

- `convex/schema.ts` - Define Convex schema (create if doesn't exist)
- `convex/mutations.ts` - Create mutations for uploading/processing statements
- `convex/queries.ts` - Create queries for fetching statements/months
- `services/convexClient.ts` - Create Convex client setup (if needed)
- `components/UploadStatement.tsx` - Update to use Convex mutations
- `components/ProcessingMonths.tsx` - Update to use Convex queries
- `components/Reports.tsx` - Update to show months clearly, use Convex queries
- `services/statementStorage.ts` - Update to use Convex instead of local state (or create new service)

**Acceptance**:
- [ ] Convex schema created with all required tables
- [ ] Can upload carrier statement and store in Convex
- [ ] File stored in Convex file storage
- [ ] Metadata stored in `carrierStatements` table
- [ ] Processing month tracked in `processingMonths` table
- [ ] Duplicate detection works (same carrier + processing month)
- [ ] Can replace existing statement
- [ ] Seller statements stored in Convex per processing month
- [ ] Commissions tab shows months clearly (grouped by month)
- [ ] Month selector/filter works in Commissions tab
- [ ] Can view uploaded statements per month
- [ ] Carrier status indicators show correctly per month
- [ ] Data persists across page refreshes
- [ ] Can query statements by processing month
- [ ] Can download/view uploaded statement files

**Dependencies**: Convex MCP already connected

**Notes**:
- Use Convex MCP tools to interact with Convex backend
- Store actual XLSX files in Convex file storage (not in database)
- Keep extracted/matched data in database for fast querying
- Update existing `statementStorage.ts` service to use Convex queries/mutations
- Ensure backward compatibility during migration (if any existing data)

---

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
