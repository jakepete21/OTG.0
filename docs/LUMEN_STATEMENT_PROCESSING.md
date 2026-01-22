# Lumen Carrier Statement Processing

This document explains specifically how Lumen carrier statements are processed in the Google Apps Script automation.

## Overview

Lumen statements are Excel files (XLSX) with a single tab. The processing uses fixed column positions to extract data.

## Key Characteristics

### Month Offset
- **Lumen has a +3 month offset**
- If processing December 2025, need Lumen statement from March 2026
- Example: `shiftMonth(targetMonth, -3)` → March statement for December processing

### File Identification
- File name must contain "Lumen" (case-insensitive)
- File name must contain month token (YYYY-MM format)

### Tab Structure
- **Primary Tab**: "Sheet1" (default name)
- Falls back to first sheet if "Sheet1" doesn't exist
- Single tab only

## Data Extraction Process

### Step 1: Open Statement File
```javascript
const ss = SpreadsheetApp.openById(file.getId());
const sh = ss.getSheetByName('Sheet1') || ss.getSheets()[0];
```

### Step 2: Read Data
- Start reading from Row 2 (skip header row)
- Read all rows until last row

### Step 3: Fixed Column Positions

Lumen uses **fixed column positions** (1-based indexing):

- **Account Number / Billing Item**: Column P (index 16, 0-based: 15)
- **Account Name**: Column U (index 21, 0-based: 20)
- **Invoice Total**: Column Z (index 26, 0-based: 25)
- **Commission Amount**: Column AB (index 28, 0-based: 27)

### Step 4: Process Each Row

For each row starting from Row 2:

#### Extract Fields
```javascript
acctNum = row[15]   // Column P
acctName = row[20]  // Column U
inv = row[25]       // Column Z
com = row[27]       // Column AB
```

#### Skip Repeated Headers
Skip rows that match these patterns (case-insensitive):
- Account Name contains: `"billing acct name"`
- Account Number contains: `"billing acct nbr"`
- Invoice Total contains: `"adjusted compensable revenue"`

These are repeated section headers that appear throughout the statement.

#### Billing Item Assignment
- **OTG Comp Billing item** = Account Number (Column P)
- Both fields use the same value

#### State Resolution
- State is looked up from Comp Key using `getStateForBillingItem_(billingItem)`
- No State column in Lumen statements
- Returns empty string if not found

### Step 5: Output Format

Each row outputs as **6 columns** (STANDARD_HEADERS):

```javascript
[
  State,                    // A - Looked up from Comp Key
  Account Name,             // B - Column U
  Account Number,           // C - Column P (same as billing item)
  OTG Comp Billing item,   // D - Column P (Account Number)
  Invoice Total,           // E - Column Z
  Commission Amount        // F - Column AB
]
```

## Data Normalization

### Currency Parsing
- Values are read as-is (numbers or currency strings)
- No special parsing needed (Google Sheets handles it)

### Account Name Processing
- Trims whitespace
- Preserves original casing

### Account Number / Billing Item
- Trims whitespace
- Used for matching and state lookup
- Same value used for both Account Number and Billing Item columns

## Example Row Processing

### Normal Row:
**Input Row 2**:
```
Column P (15): "12345"
Column U (20): "Acme Corporation"
Column Z (25): "$1,234.56"
Column AB (27): "$123.45"
```

**Output**:
```
["", "Acme Corporation", "12345", "12345", 1234.56, 123.45]
// State will be looked up from Comp Key using "12345"
```

### Header Row (Skipped):
**Input Row**:
```
Column P: "Billing Acct Nbr"
Column U: "Billing Acct Name"
Column Z: "$0.00"
```

**Processing**: Skipped (matches header pattern)

## Skip Conditions

Rows are skipped if:
1. All fields blank: Account Name, Account Number, Invoice Total, Commission Amount
2. Billing Item (Account Number) is blank
3. Row matches header pattern (repeated section headers)

## Integration Points

### With Comp Key (Master Data)
- Uses `getStateForBillingItem_()` to lookup State
- Looks up by Account Number (which is also the billing item)
- Caches Comp Key data for performance

### With Matching Process
- Lumen rows go into "Lumen" tab in Combined spreadsheet
- Matching process uses "OTG Comp Billing item" as key
- Account Number and Billing Item are identical

## Special Considerations

### Repeated Headers
- Lumen statements have repeated section headers throughout
- These are detected and skipped automatically
- Prevents header rows from being processed as data

### Fixed Columns
- No header detection needed
- Uses fixed column positions
- Assumes consistent format

### Account Number = Billing Item
- Unique to Lumen
- Account Number column (P) serves dual purpose
- Used for both Account Number and OTG Comp Billing item

## Error Handling

- If sheet missing → uses first sheet
- If row has insufficient columns → skips row
- If all fields blank → skips row
- If billing item blank → skips row

## Performance Notes

- Fast processing (fixed columns, no grouping)
- Batch reads columns for efficiency
- Comp Key lookup is cached

## Column Mapping Summary

| Output Column | Source Column | Column Index (0-based) | Notes |
|--------------|---------------|------------------------|-------|
| State | Comp Key lookup | - | Looked up using Account Number |
| Account Name | Column U | 20 | - |
| Account Number | Column P | 15 | Same as billing item |
| OTG Comp Billing item | Column P | 15 | Same as Account Number |
| Invoice Total | Column Z | 25 | - |
| Commission Amount | Column AB | 27 | - |

## Next Steps for App Integration

To replicate this in the app:

1. **File Upload**: Accept XLSX files, detect if Lumen
2. **Tab Detection**: Find "Sheet1" or first sheet
3. **Fixed Column Extraction**: Read from fixed positions (P, U, Z, AB)
4. **Header Filtering**: Skip repeated header rows
5. **State Lookup**: Lookup State from Master Data using Account Number
6. **Output**: Store as structured data

The AI can help with:
- Detecting repeated headers intelligently
- Handling format variations
- Validating column positions
- Understanding Account Number = Billing Item relationship
