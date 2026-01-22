# MetTel Carrier Statement Processing

This document explains specifically how MetTel carrier statements are processed in the Google Apps Script automation.

## Overview

MetTel statements are Excel files (XLSX) with a single tab. The processing uses fixed column positions to extract data.

## Key Characteristics

### Month Offset
- **MetTel has a +2 month offset**
- If processing December 2025, need MetTel statement from February 2026
- Example: `shiftMonth(targetMonth, -2)` → February statement for December processing

### File Identification
- File name must contain "MetTel" or "Met Tel" (case-insensitive)
- File name must contain month token (YYYY-MM format)

### Tab Structure
- **Primary Tab**: First sheet (no specific name required)
- Uses first available sheet

## Data Extraction Process

### Step 1: Open Statement File
```javascript
const ss = SpreadsheetApp.openById(file.getId());
const sh = ss.getSheets()[0];  // First sheet
```

### Step 2: Read Data
- Read all values from sheet
- First row = headers (skipped)
- Remaining rows = data

### Step 3: Fixed Column Positions

MetTel uses **fixed column positions** (0-based indexing):

- **Account Name**: Column C (index 2)
- **OTG Comp Billing item**: Column D (index 3)
- **Invoice Total**: Column N (index 13)
- **Commission Amount**: Column P (index 15)

### Step 4: Process Each Row

For each row starting from Row 2 (index 1):

#### Extract Fields
```javascript
acctName = row[2]    // Column C
billingItem = row[3] // Column D
inv = row[13]        // Column N
com = row[15]        // Column P
```

#### Skip Blank Rows
Skip rows where all fields are blank:
- Account Name
- Billing Item
- Invoice Total
- Commission Amount

#### Skip If Billing Item Blank
- If billing item is blank, skip entire row
- Billing item is required

#### State Resolution
- State is looked up from Comp Key using `getStateForBillingItem_(billingItem)`
- No State column in MetTel statements
- Returns empty string if not found

#### Account Number
- Always blank (`""`)
- MetTel statements don't include Account Number

### Step 5: Output Format

Each row outputs as **6 columns** (STANDARD_HEADERS):

```javascript
[
  State,                    // A - Looked up from Comp Key
  Account Name,             // B - Column C
  Account Number,           // C - Always blank
  OTG Comp Billing item,   // D - Column D
  Invoice Total,           // E - Column N
  Commission Amount        // F - Column P
]
```

## Data Normalization

### Currency Parsing
- Values are read as-is (numbers or currency strings)
- No special parsing needed (Google Sheets handles it)

### Account Name Processing
- Trims whitespace
- Preserves original casing

### Billing Item Processing
- Trims whitespace
- Used for matching and state lookup

## Example Row Processing

### Normal Row:
**Input Row 2**:
```
Column C (2): "Acme Corporation"
Column D (3): "MET-12345-ABC"
Column N (13): "$1,234.56"
Column P (15): "$123.45"
```

**Output**:
```
["", "Acme Corporation", "", "MET-12345-ABC", 1234.56, 123.45]
// State will be looked up from Comp Key using "MET-12345-ABC"
```

### Blank Row (Skipped):
**Input Row**:
```
Column C: ""
Column D: ""
Column N: ""
Column P: ""
```

**Processing**: Skipped (all fields blank)

## Skip Conditions

Rows are skipped if:
1. All fields blank: Account Name, Billing Item, Invoice Total, Commission Amount
2. Billing Item is blank (required field)

## Integration Points

### With Comp Key (Master Data)
- Uses `getStateForBillingItem_()` to lookup State
- Looks up by OTG Comp Billing item (Column D)
- Caches Comp Key data for performance

### With Matching Process
- MetTel rows go into "MetTel" tab in Combined spreadsheet
- Matching process uses "OTG Comp Billing item" as key
- Account Number is always blank

## Special Considerations

### Simple Structure
- MetTel has the simplest extraction logic
- Fixed columns, no grouping, no special rules
- Straightforward row-by-row processing

### No Account Number
- Account Number column always blank
- Only Account Name and Billing Item used

### Fixed Columns
- No header detection needed
- Uses fixed column positions
- Assumes consistent format

## Error Handling

- If sheet missing → uses first sheet
- If row has insufficient columns → skips row
- If all fields blank → skips row
- If billing item blank → skips row

## Performance Notes

- Fastest processing (simple extraction, no grouping)
- Direct column access
- Comp Key lookup is cached

## Column Mapping Summary

| Output Column | Source Column | Column Index (0-based) | Notes |
|--------------|---------------|------------------------|-------|
| State | Comp Key lookup | - | Looked up using Billing Item |
| Account Name | Column C | 2 | - |
| Account Number | - | - | Always blank |
| OTG Comp Billing item | Column D | 3 | - |
| Invoice Total | Column N | 13 | - |
| Commission Amount | Column P | 15 | - |

## Next Steps for App Integration

To replicate this in the app:

1. **File Upload**: Accept XLSX files, detect if MetTel
2. **Tab Detection**: Use first sheet
3. **Fixed Column Extraction**: Read from fixed positions (C, D, N, P)
4. **Blank Row Filtering**: Skip rows with all fields blank
5. **State Lookup**: Lookup State from Master Data using Billing Item
6. **Output**: Store as structured data

The AI can help with:
- Detecting MetTel format
- Validating column positions
- Handling format variations
- Understanding simple extraction pattern
