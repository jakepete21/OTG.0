# Google Apps Script Automation Documentation

This document explains how the existing Google Apps Script automation works with Google Sheets. This automation processes carrier statements, matches them against master data (Comp Key), and generates disputes and seller statements.

## Overview

The automation consists of two main pipelines:

1. **Carrier Statement Processing Pipeline** (`runCarriers.js`)
   - Processes carrier statement files (XLSX)
   - Creates a combined monthly spreadsheet
   - Matches against Comp Key (master data)
   - Generates seller statements

2. **Dispute Detection Pipeline** (`DisputesRunner.js`)
   - Runs 6 different dispute detection scripts
   - Identifies various types of discrepancies
   - Outputs to Disputes spreadsheet

## Pipeline 1: Carrier Statement Processing

### Entry Point
`runCarrierStatementPipeline()` in `runCarriers.js`

### Workflow

#### Step 1: Read Target Month
- Reads month from cell A1 of active sheet
- Formats as YYYY-MM (e.g., "2026-01")
- Each carrier has a month offset (e.g., Zayo is -2 months)

#### Step 2: Find Carrier Statement Files
- Searches Google Drive folder for carrier statement files
- Carriers: GoTo, Lumen, MetTel, TBO, Zayo, Allstream
- Matches files by carrier name + month token
- Each carrier has different file naming patterns

#### Step 3: Extract Data from Statements
- Each carrier has a custom extraction script:
  - `collectGoToRows_fromFile()` - Processes GoTo workbook (multiple tabs)
  - `collectLumenRows_fromFile()` - Extracts Lumen data
  - `collectMetTelRows_fromFile()` - Extracts MetTel data
  - `collectTBORows_fromFile()` - Extracts TBO data
  - `collectZayoRows_fromFile()` - Extracts Zayo data (9 columns)
  - `collectAllstreamRows_fromFile()` - Extracts Allstream data

#### Step 4: Create Combined Spreadsheet
- Creates new spreadsheet: `COMBINED Carrier Statement {YYYY-MM} Seller Statements`
- Creates tabs for each carrier (Zayo, Lumen, GoTo, TBO, MetTel, Allstream)
- Writes extracted data to respective tabs

#### Step 5: Build Matches Tab
- Calls `compareAndCopyWholeRowsInto()` (`Matches.js`)
- Scans all carrier tabs
- Matches rows against Comp Key using "OTG Comp Billing item"
- For matched rows:
  - Copies full row data
  - Calculates commission splits by role (RD1, RD2, RM1, etc.)
  - Uses role percentage map (RD1=20%, RD2=10%, etc.)
- Creates "Matches" tab with all matched transactions

#### Step 6: Build Seller Statements
- Calls `summarizeFinalStatementsInto()` (`Statements.js`)
- Groups Matches by "OTG Comp Billing item"
- Aggregates by role groups:
  - RD1/2 (RD1 + RD2 roles)
  - RD3/4 (RD3 + RD4 roles)
  - RM1/2 (RM1 + RM2 roles)
  - RM3/4 (RM3 + RM4 roles)
  - OVR/RD5 (OVR + RD5 roles)
  - OTG (OTG role)
- Creates separate tabs for each seller group

#### Step 7: Build Deposit Totals
- Calls `buildDepositTotals_()` (`DepositTotals.js`)
- Creates "Deposit Totals" tab
- Shows provider totals
- Shows commissionable totals by category

#### Step 8: Highlight Unmatched Items
- Calls `highlightCompKeyNotMatched_()`
- Highlights items in Comp Key that weren't matched
- Uses light red background color

### Key Data Structures

**Standard Headers** (6 columns):
- State
- Account Name
- Account Number
- OTG Comp Billing item
- Invoice Total
- Commission Amount

**Zayo Headers** (9 columns):
- Additional columns for Zayo-specific data

**Matches Tab Headers**:
- State, Account Name, Account Number, OTG Comp Billing item
- Invoice Total, Commission Amount
- Carrier Statement, Provider
- Bill/Invoice Period, Bill Description
- Role columns: RD1, RD2, RD3, RD4, RM1, RM2, RM3, RM4, OVR, RD5, OTG
- VP NOTES

### Role Percentage Map
```javascript
{
  RD1: 20%, RD2: 10%, RD3: 20%, RD4: 10%, RD5: 20%,
  RM1: 20%, RM2: 10%, RM3: 20%, RM4: 10%,
  OVR: 10%,
  HA1: 20%, HA2: 10%, HA3: 20%, HA4: 10%, HA5: 100%, HA6: 90%,
  'RD2-05': 5%, 'RD4-05': 5%, 'RM1-15': 15%
}
```

## Pipeline 2: Dispute Detection

### Entry Point
`runMonthlyPipeline6()` in `DisputesRunner.js`

### Dispute Types

#### 1. New Accounts All (`NewAccountsAll.js`)
**Function**: `NA_RF1_buildNewAccountsAll()`

**What it does**:
- Finds accounts in carrier statements that are NOT in Comp Key
- Excludes items that already exist in master data
- Outputs to "New Accounts All" tab in Disputes spreadsheet

**Logic**:
- Scans all carrier tabs in Combined spreadsheet
- Checks if "OTG Comp Billing item" exists in Comp Key
- If not found → New account
- Deduplicates by full row signature

**Output columns**: State, Account Name, Account Number, OTG Comp Billing item, Invoice Total, Commission Amount, Provider, Bill Description, Bill/Invoice Period, Date added, Associated Carrier Statement, VP NOTES

---

#### 2. Zeros and Chargebacks (`ZerosAndChargebacks.js`)
**Function**: `ZC_RF1_separateChargebacksAndZerosForSelectedMonth()`

**What it does**:
- Detects commission amounts = $0.00 (with tolerance)
- Detects negative commission amounts (chargebacks)
- Outputs to "Zeros" and "Chargebacks" tabs

**Logic**:
- Reads "Matches" tab from Combined spreadsheet
- Zero detection: `Math.abs(commission) < 0.005` (rounds to $0.00)
- Chargeback detection: `commission < 0`
- Links to actual carrier statement files

**Output**: Separate tabs for Zeros and Chargebacks

---

#### 3. Canceled / Missing (`Canceled.js`)
**Function**: `CM_RF1_copyUnmatchedFromCompKey_ToCanceled_ZMap_NonMRC()`

**What it does**:
- Finds items in Comp Key that are NOT in carrier statements
- Routes to different tabs based on criteria:
  - **ZMap**: If Comp Key column H contains "zmap"
  - **Non-MRC Billing**: If Comp Key column W != "MRC" and non-blank
  - **Canceled / Missing**: Everything else

**Logic**:
- Builds match set from all carrier tabs ("OTG Comp Billing item" column)
- Scans Comp Key for items not in match set
- Routes based on column H and W values

**Output**: Three tabs - ZMap, Non-MRC Billing, Canceled / Missing

---

#### 4. Changed Rates (`ChangedRates.js`)
**Function**: `CR_RF1_flagChangedRatesFromA1()`

**What it does**:
- Compares current month vs previous month
- Detects commission amount changes > $50 threshold
- Outputs to "Changed Rates" tab

**Logic**:
- Finds Combined spreadsheet for target month
- Finds Combined spreadsheet for previous month
- Aggregates commissions by "OTG Comp Billing item"
- Compares totals between months
- Flags if difference > $50
- Handles Zayo offset (-2 months)

**Output**: Changed Rates tab with difference column

---

#### 5. Months Held Not Paid (`MonthsHeldNotPaid.js`)
**Function**: `ZMHNP_RF1_transferMonthsHeldNotPaid_ALL()`

**What it does**:
- Finds Zayo accounts marked "Paid = No"
- Extracts month tokens from "Months" column
- Groups by billing item
- Updates existing rows or appends new

**Logic**:
- Reads Zayo "Collection of Commissions" tab
- Filters for "Paid" flag = "No"
- Parses month tokens (e.g., "Nov'24", "Dec'24")
- Groups by "OTG Comp Billing item"
- Updates existing rows in "Months Held NOT Paid ALL" tab

**Output**: Months Held NOT Paid ALL tab

---

#### 6. Months Held Paid (`MonthsPaidAll.js`)
**Function**: `ZMHP_RF1_copyMonthsHeldPaid_ALL()`

**What it does**:
- Finds Zayo accounts marked "Paid = Yes"
- Extracts month tokens
- Creates one row per month token (except lag month)
- Outputs to "Months Held Paid ALL" tab

**Logic**:
- Reads Zayo "Collection of Commissions" tab
- Filters for "Paid" flag = "Yes"
- Parses month tokens from "Months" column
- Skips the lag month (Zayo offset month)
- Creates one row per month token

**Output**: Months Held Paid ALL tab

---

## Data Flow

```
1. Carrier Statements (XLSX files in Google Drive)
   ↓
2. runCarrierStatementPipeline()
   - Extract data from each carrier
   - Create carrier tabs
   ↓
3. compareAndCopyWholeRowsInto()
   - Match against Comp Key
   - Calculate role splits
   - Create Matches tab
   ↓
4. summarizeFinalStatementsInto()
   - Group by billing item
   - Aggregate by role groups
   - Create seller statement tabs
   ↓
5. buildDepositTotals_()
   - Calculate totals
   - Create Deposit Totals tab
   ↓
6. runMonthlyPipeline6()
   - Run all 6 dispute detection scripts
   - Output to Disputes spreadsheet
```

## Key Concepts

### Month Offsets
Different carriers have different statement months:
- **Zayo**: -2 months (December statement → October data)
- **Others**: Usually 0 offset (statement month = data month)

### Matching Key
- Primary key: **"OTG Comp Billing item"**
- Used to match carrier statement rows against Comp Key
- Normalized (uppercase, remove special chars) for comparison

### Role Splits
- Each matched row gets commission split by roles
- Roles come from Comp Key (COMP 1, COMP 2, etc.)
- Percentages defined in role percentage map
- Example: RD1 gets 20% of commission, RD2 gets 10%

### Comp Key Structure
- Master data spreadsheet
- Contains all expected accounts/services
- Key columns:
  - ST (State)
  - Account **CARRIER** (Account Name)
  - OTG Comp Billing item (matching key)
  - Service Provider
  - COMP 1, COMP 2, COMP 3, COMP 4 (roles)
  - EXPECTED/Mo. OTG Comp % (expected commission %)
  - Monthly Unit Price
  - Many other columns (62 total)

## File Locations

### Google Drive Folders
- **Carrier Statements Folder**: Contains uploaded carrier statement files
- **Combined Folder**: Contains monthly combined spreadsheets
- **Disputes Spreadsheet**: Single spreadsheet with multiple dispute tabs

### Spreadsheet IDs (Hardcoded)
- **Comp Key Spreadsheet**: Master data source
- **Disputes Spreadsheet**: Destination for all disputes
- **Combined Folder**: Where monthly combined files are stored

## Current Limitations

1. **Google Sheets Dependent**: All data stored in Google Sheets
2. **Manual Execution**: Scripts must be run manually
3. **No AI Matching**: Uses exact string matching (normalized)
4. **Fixed Logic**: Dispute detection rules are hardcoded
5. **No History**: No tracking of past runs or changes
6. **Limited Error Handling**: Basic error messages
7. **No UI**: Must use Google Apps Script editor

## Integration Opportunities

### AI Enhancement Areas

1. **Fuzzy Matching**:
   - Current: Exact match on "OTG Comp Billing item"
   - AI: Fuzzy matching for similar names, typos, variations

2. **Intelligent Dispute Detection**:
   - Current: Rule-based detection
   - AI: Learn patterns, detect anomalies, suggest resolutions

3. **Data Extraction**:
   - Current: Carrier-specific extraction scripts
   - AI: Generic extraction using AI (Gemini) for any format

4. **Rate Change Detection**:
   - Current: Simple threshold ($50)
   - AI: Context-aware detection, understand seasonal patterns

5. **Account Classification**:
   - Current: Manual routing (ZMap, Non-MRC)
   - AI: Auto-classify accounts based on patterns

### App Integration Benefits

1. **Better UX**: Web app instead of Google Sheets
2. **Automated**: Run on upload, not manual execution
3. **History**: Track all runs, changes, disputes
4. **Real-time**: See results immediately
5. **AI-Powered**: Better matching and detection
6. **Multi-user**: Support multiple users/orgs
7. **Export**: Better PDF/Excel export options
