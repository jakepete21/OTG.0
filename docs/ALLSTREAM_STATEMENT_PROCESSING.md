# Allstream Carrier Statement Processing

This document explains specifically how Allstream carrier statements are processed in the Google Apps Script automation.

## Overview

Allstream statements are Excel files (XLSX) with two possible tabs. The processing extracts data from both tabs using different logic for each.

## Key Characteristics

### Month Offset
- **Allstream has a +2 month offset**
- If processing December 2025, need Allstream statement from February 2026
- Example: `shiftMonth(targetMonth, -2)` → February statement for December processing

### File Identification
- File name must contain "Allstream" or "OneTel H" (case-insensitive)
- File name must contain month token (YYYY-MM format)

### Tab Structure
Allstream workbooks contain two tabs:
- **"OneTel H R"** - Primary tab (always processed)
- **"OneTel H"** - Secondary tab (optional, complex parsing)

## Data Extraction Process

### Tab 1: OneTel H R (Primary)

**Start Row**: Row 14 (skip first 13 rows)

**Fixed Column Positions** (0-based):
- **OTG Comp Billing item**: Column E (index 4)
- **Account Name**: Column F (index 5)
- **Invoice Total**: Column I (index 8)
- **Commission Amount**: Column K (index 10)

**Processing Logic**:
- Read from Row 14 to last row
- Extract fixed columns
- Skip rows where all fields blank
- Skip rows where billing item blank

**Output Type**: Blank (`""`) - no type identifier

**Output Format**: 7 columns (includes Type column, but blank for this tab)

### Tab 2: OneTel H (Secondary, Optional)

**Complex Section-Based Parsing**

This tab contains multiple sections that need special parsing:
- **NEW SOLD REVENUE**
- **CHANGES & CANCELS**
- **ADJUSTMENTS**

Each section has different parsing logic.

#### Section Detection

**Find Section Start**:
- Look for section header in Column A (case-insensitive, normalized)
- Examples: "NEW SOLD REVENUE", "CHANGES & CANCELS", "ADJUSTMENTS"

**Find Section End**:
- "NEW SOLD REVENUE": Ends at "Total New Sold Revenue" in Column A
- "CHANGES & CANCELS": Ends at "Subtotal" in Column C (index 2)
- "ADJUSTMENTS": Ends at "Subtotal" in Column C (index 2)

#### Row Processing Within Section

**Account Detection**:
- Account Number: Column A contains 4+ digits (e.g., "12345")
- Account Name: First non-blank value from Columns B, C, D, or E
- Category: Text label in Column A (e.g., "Residual Adjustments", "Spiffs")
- Commission: Last currency value found in entire row

**Category Processing**:
- Categories are detected from Column A text labels
- Singularized: "Residual Adjustments" → "Residual Adjustment"
- "Spiffs" → "Spiff"
- Used as Type identifier

**Account Name Cleaning**:
```javascript
function cleanAccountName(raw) {
  // Remove parentheses notes: "Acme Corp (notes)" → "Acme Corp"
  s = s.replace(/\([^)]*\)/g, '').trim();
  
  // Remove month/billing suffixes:
  // "Denver Public Library Oct Billing" → "Denver Public Library"
  // Cut at " Oct " or " Billing"
  const octIdx = s.search(/\sOct\s/i);
  if (octIdx > 0) s = s.slice(0, octIdx).trim();
  
  const billIdx = s.search(/\sBilling/i);
  if (billIdx > 0) s = s.slice(0, billIdx).trim();
  
  // Collapse whitespace
  return s.replace(/\s+/g, ' ').trim();
}
```

**Money Extraction**:
- Scans entire row for currency patterns
- Finds last currency value: `/\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g`
- Uses last match found

**Account Block Tracking**:
- Tracks "active account" as rows are processed
- When new account number detected → flush previous account
- When subtotal detected → flush current account
- Commission accumulates across multiple rows for same account

**Flush Logic**:
```javascript
function flushActive() {
  if (!active || !active.acctNum || !active.acctName || !active.lastMoney) return;
  
  billingItem = active.acctNum;  // Account number = billing item
  commissionAmount = active.lastMoney;
  type = active.category || sectionName;
  
  // Invoice Total is blank for OneTel H tab
  output.push([state, acctName, "", billingItem, "", commissionAmount, type]);
}
```

## Output Format

All tabs combine into single output with **7 columns**:

```javascript
[
  State,                    // A - Looked up from Comp Key
  Account Name,             // B - Cleaned account name
  Account Number,           // C - Always blank
  OTG Comp Billing item,   // D - Account number (for OneTel H)
  Invoice Total,           // E - Column I (OneTel H R) or blank (OneTel H)
  Commission Amount,       // F - Column K (OneTel H R) or extracted (OneTel H)
  Type                     // G - Section/category name or blank
]
```

## State Resolution

- State is looked up from Comp Key using `getStateForBillingItem_(billingItem)`
- No State column in Allstream statements
- Returns empty string if not found

## Data Normalization

### Currency Parsing
- OneTel H R: Values read as-is
- OneTel H: Extracted via regex pattern matching
- Handles `$`, commas, decimals

### Account Name Cleaning
- Removes parentheses notes
- Removes month/billing suffixes
- Collapses whitespace

### Category Singularization
- "Residual Adjustments" → "Residual Adjustment"
- "Spiffs" → "Spiff"
- Removes trailing 's' from plurals

## Example Processing

### OneTel H R Tab:
**Input Row 14**:
```
Column E (4): "12345"
Column F (5): "Acme Corporation"
Column I (8): "$1,234.56"
Column K (10): "$123.45"
```

**Output**:
```
["", "Acme Corporation", "", "12345", 1234.56, 123.45, ""]
```

### OneTel H Tab - NEW SOLD REVENUE Section:
**Input Rows**:
```
Row 10: ["NEW SOLD REVENUE", ...]
Row 11: ["12345", "Acme Corp", ..., "$500"]
Row 12: ["", "", ..., "$50"]
Row 13: ["Total New Sold Revenue", ...]
```

**Processing**:
- Detect account "12345" in Row 11
- Extract commission: "$50" (last money value)
- Account name: "Acme Corp"
- Category: "NEW SOLD REVENUE"
- Flush on "Total New Sold Revenue"

**Output**:
```
["", "Acme Corp", "", "12345", "", 50, "NEW SOLD REVENUE"]
```

### OneTel H Tab - ADJUSTMENTS Section:
**Input Rows**:
```
Row 20: ["ADJUSTMENTS", ...]
Row 21: ["Residual Adjustments", ...]
Row 22: ["12345", "Acme Corp Oct Billing", ..., "$100"]
Row 23: ["", "", ..., "$25"]
Row 24: ["Residual Adjustment Subtotal", ..., "$125"]
```

**Processing**:
- Category: "Residual Adjustments" → "Residual Adjustment"
- Account: "12345"
- Account name: "Acme Corp Oct Billing" → cleaned to "Acme Corp"
- Commission: "$125" (accumulated, flushed on subtotal)

**Output**:
```
["", "Acme Corp", "", "12345", "", 125, "Residual Adjustment"]
```

## Special Considerations

### Two Different Parsing Methods
- **OneTel H R**: Simple fixed-column extraction
- **OneTel H**: Complex section-based parsing with account tracking

### Account Number = Billing Item (OneTel H)
- For OneTel H tab, Account Number serves as billing item
- Account Number column remains blank in output
- Used for matching against Comp Key

### Invoice Total Blank (OneTel H)
- OneTel H tab only extracts Commission Amount
- Invoice Total is blank for these rows
- OneTel H R tab includes Invoice Total

### Category Detection
- Categories detected from Column A text labels
- Used as Type identifier
- Helps classify commission types

### Account Block Tracking
- Tracks active account across multiple rows
- Accumulates commission until flush
- Flushes on new account, subtotal, or section end

## Integration Points

### With Comp Key (Master Data)
- Uses `getStateForBillingItem_()` to lookup State
- Looks up by Account Number (billing item)
- Caches Comp Key data for performance

### With Matching Process
- Allstream rows go into "Allstream" tab in Combined spreadsheet
- Matching process uses "OTG Comp Billing item" as key
- Type column preserved for reference

## Error Handling

- If "OneTel H R" missing → processes "OneTel H" only
- If "OneTel H" missing → processes "OneTel H R" only
- If section markers not found → returns empty array for that section
- If account number invalid → skips account block
- If all fields blank → skips row

## Performance Notes

- OneTel H R: Fast (fixed columns)
- OneTel H: Slower (section parsing, account tracking)
- Comp Key lookup is cached

## Column Mapping Summary

### OneTel H R Tab:
| Output Column | Source Column | Column Index (0-based) | Notes |
|--------------|---------------|------------------------|-------|
| State | Comp Key lookup | - | Looked up using billing item |
| Account Name | Column F | 5 | - |
| Account Number | - | - | Always blank |
| OTG Comp Billing item | Column E | 4 | - |
| Invoice Total | Column I | 8 | - |
| Commission Amount | Column K | 10 | - |
| Type | - | - | Blank |

### OneTel H Tab:
| Output Column | Source | Notes |
|--------------|--------|-------|
| State | Comp Key lookup | Looked up using account number |
| Account Name | Columns B/C/D/E | Cleaned, first non-blank |
| Account Number | - | Always blank |
| OTG Comp Billing item | Column A (account number) | 4+ digits |
| Invoice Total | - | Always blank |
| Commission Amount | Extracted from row | Last currency value |
| Type | Column A (category) | Section name or category |

## Next Steps for App Integration

To replicate this in the app:

1. **File Upload**: Accept XLSX files, detect if Allstream
2. **Tab Detection**: Find "OneTel H R" and "OneTel H" tabs
3. **OneTel H R Processing**: Fixed column extraction (Row 14+)
4. **OneTel H Processing**: Section detection and account tracking
5. **Account Name Cleaning**: Remove suffixes, parentheses
6. **Category Detection**: Extract and singularize categories
7. **State Lookup**: Lookup State from Master Data using Account Number
8. **Output**: Combine both tabs into single dataset

The AI can help with:
- Intelligent section boundary detection
- Account block tracking and accumulation
- Account name cleaning patterns
- Category detection and classification
- Money extraction from unstructured rows
