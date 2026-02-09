# Zayo Carrier Statement Processing

This document explains specifically how Zayo carrier statements are processed in the Google Apps Script automation. This is a focused breakdown of just the Zayo extraction logic.

## Overview

Zayo statements are Google Sheets files (XLSX format) that contain commission data. The processing extracts rows from a specific tab and normalizes them into a standard format.

## Key Characteristics

### Month Offset
- **Zayo has a -2 month offset**
- If processing December 2025, need Zayo statement from October 2025
- Example: `shiftMonth(targetMonth, -2)` → October statement for December processing

### File Identification
- File name must contain "Zayo" (case-insensitive)
- File name must contain month token (YYYY-MM format, e.g., "2025-10")
- Special regex patterns for Zayo:
  - `carrier\s+statement\s+zayo\s+2025-10`
  - `-\s*zayo\s+October\s+2025`
  - `-\s*zayo\s+Oct\s+2025`

### Tab Structure
- **Primary Tab**: "Collection of Commissions" (required)
- This tab contains all commission data
- Falls back to first sheet if "Collection of Commissions" doesn't exist

## Data Extraction Process

### Step 1: Open Statement File
```javascript
const ss = SpreadsheetApp.openById(file.getId());
const sh = ss.getSheetByName("Collection of Commissions") || ss.getSheets()[0];
```

### Step 2: Read Data
- Read all values from the sheet
- First row = headers
- Remaining rows = data

### Step 3: Identify Column Positions

The extraction uses **header-based column detection** with fallbacks:

#### Primary (Header-Based) Detection:
Looks for these headers (case-insensitive, flexible matching):
- **State**: `["State", "ST"]`
- **Account Name**: `["Account Name", "Customer Name", "Name"]`
- **Account Number**: `["Account Number", "BAN"]`
- **OTG Comp Billing item**: `["OTG Comp Billing item", "Service Number", "Billing Item", "Service", "Svc Name"]`
- **Svc Name**: `["Svc Name", "Service Name", "Service"]` (special for ENA rule)
- **BAN**: `["Billing Account Number", "BAN", "Billing Acct Nbr", "Billing Account #"]`
- **Invoice Total**: `["Invoice Total", "Invoice Amount", "Total Invoice"]`
- **Commission Amount**: `["Commission Amount", "Total Commissions", "Commission"]`
- **Bill Description**: `["Bill Description", "Description"]`
- **Bill/Invoice Period**: `["Bill/Invoice Period", "Invoice Period", "Reporting Period"]`
- **Provider**: `["Provider"]`

#### Fallback (Fixed Column Positions):
If headers not found, uses these fixed positions:
- Account Name: Column L (index 11)
- OTG Comp Billing item: Column M (index 12)
- Account Number: Column K (index 10)
- Invoice Total: Column AF (index 31)
- Commission Amount: Column AG (index 32)

### Step 4: Process Each Row

For each data row:

#### Extract Basic Fields
```javascript
acctName = row[accountNameColumn] || row[11]  // L
itemRaw = row[billingItemColumn] || row[12]   // M
acctNum = row[accountNumberColumn] || row[10]  // K
inv = row[invoiceTotalColumn] || row[31]       // AF
com = row[commissionColumn] || row[32]         // AG
```

#### Special ENA Rule
**If "Svc Name" column is blank:**
1. Use **BAN** (Billing Account Number) as the "OTG Comp Billing item"
2. Add **asterisk (*)** prefix to Account Name
3. Set Provider to **"ENA"** instead of "Zayo"

```javascript
if (svcNameIsBlank) {
  itemRaw = banValue;  // Use BAN as billing item
  acctName = "*" + acctName;  // Add star prefix
  provider = "ENA";  // Change provider
}
```

#### State Resolution
1. First, try to read State from the row (if column exists)
2. If State is not a valid 2-letter US state abbreviation (`/^[A-Z]{2}$/`)
3. Lookup State from Comp Key using `getStateForBillingItem_(itemRaw)`
   - This function caches Comp Key data
   - Looks up "OTG Comp Billing item" → returns "ST" column value

#### Provider Default
- Default provider = "Zayo"
- Changes to "ENA" if Svc Name is blank (per ENA rule above)

### Step 5: Output Format

Each row outputs as **9 columns** (ZAYO_HEADERS):

```javascript
[
  State,                    // A - 2-letter state code or ""
  Account Name,             // B - May have * prefix for ENA
  Account Number,           // C - BAN or account number
  OTG Comp Billing item,   // D - Service number or BAN (for ENA)
  Invoice Total,           // E - Numeric, parsed from currency
  Commission Amount,       // F - Numeric, parsed from currency
  Provider,                // G - "Zayo" or "ENA"
  Bill Description,        // H - Description text or ""
  Bill/Invoice Period      // I - Period text or ""
]
```

## Data Normalization

### Currency Parsing
- Removes `$`, commas, spaces
- Handles negative values: `(123.45)` → `-123.45`
- Returns empty string `""` if blank/null

### State Validation
- Must be exactly 2 uppercase letters
- Validates against US state abbreviations
- Falls back to Comp Key lookup if invalid/missing

### Account Name Processing
- Trims whitespace
- Adds `*` prefix for ENA accounts (when Svc Name blank)
- Preserves original casing

## Example Row Processing

### Normal Zayo Row:
**Input Row** (from "Collection of Commissions"):
```
State: "CA"
Account Name: "Acme Corp"
Svc Name: "Zayo Fiber 100M"
BAN: "12345"
Invoice Total: "$1,234.56"
Commission Amount: "$123.45"
```

**Output**:
```
["CA", "Acme Corp", "12345", "Zayo Fiber 100M", 1234.56, 123.45, "Zayo", "", ""]
```

### ENA Row (Svc Name blank):
**Input Row**:
```
State: ""
Account Name: "Beta Inc"
Svc Name: ""  // BLANK
BAN: "67890"
Invoice Total: "$2,000.00"
Commission Amount: "$200.00"
```

**Output**:
```
["", "*Beta Inc", "67890", "67890", 2000.00, 200.00, "ENA", "", ""]
// Note: State will be looked up from Comp Key using BAN "67890"
// Account Name has * prefix
// Billing item = BAN
// Provider = "ENA"
```

## Integration Points

### With Comp Key (Master Data)
- Uses `getStateForBillingItem_()` to lookup State
- Caches Comp Key data for performance
- Looks up by "OTG Comp Billing item" column

### With Matching Process
- Zayo rows go into "Zayo" tab in Combined spreadsheet
- Matching process uses "OTG Comp Billing item" as key
- Only first 6 columns used in Matches tab (State through Commission Amount)

### With Dispute Detection
- Zayo has special handling in some dispute scripts:
  - **Months Held**: Reads "Paid" flag and "Months" column
  - **Changed Rates**: Uses -2 month offset for comparison
  - **New Accounts**: Can fallback to statement file for State lookup

## Deposit Total and Unmatched Rows (App)

The app extractor aligns **extracted rows** with the **Deposit Total** so the Commissions "Differences" report can list every line that is not in the comp key:

- **Only rows with "Pay This Reporting Period" = "Yes"** are extracted (same set used for the raw total).
- Rows are **not skipped** for missing Customer Account, Billing Account Number, or Svc Name. Placeholders are used: `(No account)` and `(No billing item)` (or Bill Description when present) so every such line becomes a `CarrierStatementRow`.
- **Raw total** = sum of `commissionAmount` over these extracted rows (no separate second loop).
- Unmatched lines (no comp key match) are stored on the carrier statement as `unmatchedRows` and shown in the Differences report table.

Re-upload or "Regenerate seller statements" after changing this logic so existing months get the full list of unmatched line items.

## Special Considerations

### Month Offset Logic
- When processing December 2025, need October 2025 Zayo statement
- File finder applies offset: `findFileByCarrierMonth(folder, ['Zayo'], octoberDate)`
- Statement month ≠ processing month

### ENA Accounts
- ENA = accounts without service name
- Identified by blank "Svc Name" column
- Use BAN as billing item identifier
- Marked with `*` prefix in Account Name
- Provider set to "ENA" (not "Zayo")

### State Fallback
- If State column missing or invalid in statement
- Lookup from Comp Key using billing item
- Caches lookup for performance
- Returns empty string if not found

## Column Mapping Summary

| Output Column | Primary Source | Fallback Source | Special Rules |
|--------------|----------------|-----------------|---------------|
| State | State/ST column | Comp Key lookup | Must be 2-letter code |
| Account Name | Account Name column | Column L (11) | Add * for ENA |
| Account Number | Account Number/BAN | Column K (10) | - |
| OTG Comp Billing item | Service/Svc Name | Column M (12) or BAN | Use BAN if Svc Name blank |
| Invoice Total | Invoice Total column | Column AF (31) | Parse currency |
| Commission Amount | Commission Amount | Column AG (32) | Parse currency |
| Provider | Provider column | "Zayo" | "ENA" if Svc Name blank |
| Bill Description | Bill Description | - | - |
| Bill/Invoice Period | Bill/Invoice Period | - | - |

## Error Handling

- If "Collection of Commissions" tab missing → uses first sheet
- If headers not found → uses fixed column positions
- If State invalid → looks up from Comp Key
- If billing item blank → skips row
- If account name and billing item both blank → skips row

## Performance Notes

- Comp Key lookup is cached (one-time load per execution)
- Header detection happens once per file
- Fixed column fallbacks avoid re-scanning

## Next Steps for App Integration

To replicate this in the app:

1. **File Upload**: Accept XLSX files, detect if Zayo
2. **Tab Detection**: Find "Collection of Commissions" tab
3. **Column Detection**: Use AI (Gemini) to identify columns intelligently
4. **Row Processing**: Apply ENA rule, state lookup, normalization
5. **Output**: Store as structured data (not Google Sheets)

The AI can help with:
- Intelligent column detection (better than header matching)
- Understanding ENA rule context
- State validation and lookup
- Handling format variations
