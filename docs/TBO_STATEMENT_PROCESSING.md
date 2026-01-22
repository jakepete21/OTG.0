# TBO Carrier Statement Processing

This document explains specifically how TBO carrier statements are processed in the Google Apps Script automation.

## Overview

TBO statements are Excel files (XLSX) with a single tab. The processing uses header-based column detection with aggregation by account.

## Key Characteristics

### Month Offset
- **TBO has a +1 month offset**
- If processing December 2025, need TBO statement from January 2026
- Example: `shiftMonth(targetMonth, -1)` → January statement for December processing

### File Identification
- File name must contain "TBO" (case-insensitive)
- File name must contain month token (YYYY-MM format)

### Tab Structure
- **Primary Tab**: "Data" (preferred)
- Falls back to first sheet if "Data" doesn't exist
- Single tab only

## Data Extraction Process

### Step 1: Open Statement File
```javascript
const ss = SpreadsheetApp.openById(file.getId());
let sh = ss.getSheetByName('Data') || ss.getSheets()[0];
```

### Step 2: Header Detection

TBO uses **header-based column detection** with flexible matching:

**Required Headers** (searched in first 10 rows):
- **Customer Business Name**: Account Name
- **Supplier Account**: OTG Comp Billing item (and Account Number)
- **Total Bill**: Invoice Total
- **Total Commission**: Commission Amount

**Header Search Logic**:
- Scans first 10 rows for headers
- Normalizes headers: trim, lowercase, collapse whitespace
- Finds column position for each required header
- Uses highest row number found as header row
- Data starts on next row after header row

### Step 3: Aggregation by Account

**Key Insight**: TBO aggregates rows by unique combination of:
- Customer Business Name + Supplier Account

**Aggregation Logic**:
1. Group rows by `${name}||${account}` key
2. For each group:
   - Sum Invoice Total (Total Bill)
   - Sum Commission Amount (Total Commission)
   - Use first Customer Business Name
   - Use Supplier Account as billing item

**Why Aggregation?**
- TBO statements may have multiple rows per account
- Need to combine them into single row per account
- Prevents duplicate matching

### Step 4: Process Each Aggregated Group

For each unique account:

#### Extract Fields
```javascript
name = Customer Business Name (first value in group)
account = Supplier Account (same for all rows in group)
billSum = Sum of Total Bill (all rows in group)
commSum = Sum of Total Commission (all rows in group)
```

#### Billing Item Assignment
- **OTG Comp Billing item** = Supplier Account
- Same value used for Account Number and Billing Item

#### State Resolution
- State is looked up from Comp Key using `getStateForBillingItem_(billingItem)`
- No State column in TBO statements
- Returns empty string if not found

#### Account Number
- Always blank (`""`)
- Supplier Account is used as billing item, not account number

### Step 5: Output Format

Each aggregated group outputs as **6 columns** (STANDARD_HEADERS):

```javascript
[
  State,                    // A - Looked up from Comp Key
  Account Name,             // B - Customer Business Name
  Account Number,           // C - Always blank
  OTG Comp Billing item,   // D - Supplier Account
  Invoice Total,           // E - Sum of Total Bill
  Commission Amount        // F - Sum of Total Commission
]
```

## Data Normalization

### Currency Parsing
```javascript
function toNumber(val) {
  if (val == null || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
```

### Header Normalization
```javascript
function normalizeHeader(s) {
  return String(s == null ? "" : s)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
```

### Account Name Processing
- Uses first Customer Business Name from group
- Trims whitespace
- Preserves original casing

## Example Row Processing

### Multiple Rows for Same Account:
**Input Rows**:
```
Row 2: ["Acme Corp", "SUP-12345", "$500", "$50"]
Row 3: ["Acme Corp", "SUP-12345", "$300", "$30"]
Row 4: ["Beta Inc", "SUP-67890", "$200", "$20"]
```

**Aggregation**:
- Group 1: "Acme Corp||SUP-12345"
  - Invoice Sum: 500 + 300 = 800
  - Commission Sum: 50 + 30 = 80
- Group 2: "Beta Inc||SUP-67890"
  - Invoice Sum: 200
  - Commission Sum: 20

**Output**:
```
["", "Acme Corp", "", "SUP-12345", 800, 80]
["", "Beta Inc", "", "SUP-67890", 200, 20]
```

### Single Row:
**Input Row**:
```
["Acme Corp", "SUP-12345", "$500", "$50"]
```

**Output**:
```
["", "Acme Corp", "", "SUP-12345", 500, 50]
```

## Skip Conditions

Rows are skipped if:
1. Customer Business Name is blank
2. Supplier Account is blank
3. Both required for grouping key

## Integration Points

### With Comp Key (Master Data)
- Uses `getStateForBillingItem_()` to lookup State
- Looks up by Supplier Account (billing item)
- Caches Comp Key data for performance

### With Matching Process
- TBO rows go into "TBO" tab in Combined spreadsheet
- Matching process uses "OTG Comp Billing item" as key
- Aggregation prevents duplicate matches

## Special Considerations

### Aggregation Required
- **Critical**: Must aggregate by name + account
- Prevents duplicate rows for same account
- Ensures accurate matching

### Header Detection
- Flexible header matching (normalized, case-insensitive)
- Searches first 10 rows
- Handles variations in header names

### Supplier Account = Billing Item
- Supplier Account serves as billing item identifier
- Used for matching against Comp Key
- Account Number column remains blank

## Error Handling

- If "Data" tab missing → uses first sheet
- If required headers not found → throws error
- If row has insufficient columns → skips row
- If name or account blank → skips row

## Performance Notes

- Requires aggregation pass (O(n) operation)
- Header detection scans first 10 rows
- Comp Key lookup is cached

## Column Mapping Summary

| Output Column | Source Header | Aggregation | Notes |
|--------------|---------------|-------------|-------|
| State | Comp Key lookup | - | Looked up using Supplier Account |
| Account Name | Customer Business Name | First value | - |
| Account Number | - | - | Always blank |
| OTG Comp Billing item | Supplier Account | Same for group | Used for matching |
| Invoice Total | Total Bill | Sum | Aggregated |
| Commission Amount | Total Commission | Sum | Aggregated |

## Next Steps for App Integration

To replicate this in the app:

1. **File Upload**: Accept XLSX files, detect if TBO
2. **Tab Detection**: Find "Data" tab or first sheet
3. **Header Detection**: Use AI to find headers intelligently
4. **Aggregation**: Group by Customer Business Name + Supplier Account
5. **Sum Totals**: Sum Invoice Total and Commission Amount per group
6. **State Lookup**: Lookup State from Master Data using Supplier Account
7. **Output**: Store as structured data

The AI can help with:
- Intelligent header detection (better than exact matching)
- Understanding aggregation requirements
- Handling format variations
- Detecting multiple rows per account
