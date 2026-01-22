# GoTo Carrier Statement Processing

This document explains specifically how GoTo carrier statements are processed in the Google Apps Script automation.

## Overview

GoTo statements are Excel workbooks (XLSX) with multiple tabs/sheets. The processing extracts data from multiple tabs and combines them into a single output.

## Key Characteristics

### Month Offset
- **GoTo has a +1 month offset**
- If processing December 2025, need GoTo statement from January 2026
- Example: `shiftMonth(targetMonth, -1)` → January statement for December processing

### File Identification
- File name must contain "GoTo" (case-insensitive)
- File name must contain month token (YYYY-MM format)

### Tab Structure
GoTo workbooks contain multiple tabs:
- **"Data"** - REQUIRED (main data)
- **"Equipment"** - Optional (equipment commissions)
- **"One-Time"** - Optional (one-time commissions)
- **"Canceled"** - Optional (canceled accounts)
- **"Assist"** - Optional (assist commissions)
- **"CAD"** - Optional (CAD commissions)
- **"2G Energy"** - Optional (2G Energy commissions)

## Data Extraction Process

### Special Commission Adjustment Rule
**CRITICAL**: If OTG Comp Billing item == `"CN-568463-1409"`, subtract `118.29` from Commission Amount.
- Applies to ALL tabs where commission is extracted
- Applied after reading commission value, before output

```javascript
if (billingItem === "CN-568463-1409") {
  commissionAmount = commissionAmount - 118.29;
}
```

### Tab 1: Data (REQUIRED)

**Start Row**: Row 4 (skip first 3 rows)

**Column Mapping**:
- **Account Name**: Column C (index 2)
- **OTG Comp Billing item**: Column B (index 1)
- **Invoice Total**: Column G (index 6)
- **Commission Amount**: Column H (index 7)

**Stop Condition**: Stop when row contains "customer details" (case-insensitive) in column A

**Skip Rows**: Skip rows where billing item contains "customer totals" (case-insensitive)

**Output Type**: `"GoTo"`

**Example Row**:
```
Row 4: [..., "CN-12345", "Acme Corp", ..., "$1000", "$100"]
Output: ["", "Acme Corp", "", "CN-12345", 1000, 100, "GoTo"]
```

### Tab 2: Equipment (Optional)

**Start Row**: Row 4

**Column Mapping**:
- **Account Name**: Column A (index 0) - First non-blank value, prefixed with `*`
- **OTG Comp Billing item**: Column I (index 8)
- **Invoice Total**: Sum of Column F (index 5) - grouped by billing item
- **Commission Amount**: Sum of Column G (index 6) - grouped by billing item

**Grouping Logic**:
- Groups rows by OTG Comp Billing item (Column I)
- Sums Invoice Total (Column F) for each group
- Sums Commission Amount (Column G) for each group
- Uses first Account Name (Column A) from group, adds `*` prefix

**Output Type**: `"GoTo - Equipment"`

**Example**:
```
Row 4: ["Acme Corp", ..., "CN-12345", ..., "$500", "$50"]
Row 5: ["", ..., "CN-12345", ..., "$300", "$30"]
Output: ["", "*Acme Corp", "", "CN-12345", 800, 80, "GoTo - Equipment"]
```

### Tab 3: One-Time (Optional)

**Start Row**: Row 2

**Column Mapping**:
- **Account Name**: Column A (index 0)
- **OTG Comp Billing item**: Column B (index 1)
- **Invoice Total**: Column E (index 4)
- **Commission Amount**: Column I (index 8)

**Output Type**: `"GoTo - One-Time"`

### Tab 4: Canceled (Optional)

**Start Row**: Row 2

**Column Mapping** (SWAPPED):
- **Account Name**: Column B (index 1) - normally billing item column
- **OTG Comp Billing item**: Column A (index 0) - normally account name column
- **Invoice Total**: Blank (`""`)
- **Commission Amount**: Blank (`""`)

**Output Type**: `"GoTo - Canceled"`

**Note**: Columns A and B are swapped for Canceled tab

### Tab 5: Assist (Optional)

**Start Row**: Row 2

**Column Mapping**:
- **Account Name**: Column A (index 0)
- **OTG Comp Billing item**: Column C (index 2)
- **Invoice Total**: Column E (index 4)
- **Commission Amount**: Column H (index 7)

**Output Type**: `"GoTo (Assist)"`

### Tab 6: CAD (Optional)

**Start Row**: Row 1 (scans entire sheet)

**Section Detection**:
- Finds section starting with "Customer Summary" in Column A
- Finds subsection starting with "Customer Number" in Column B
- Stops at "Customer Totals - USD" in Column B

**Column Mapping** (within detected section):
- **Account Name**: Column C (index 2)
- **OTG Comp Billing item**: Column B (index 1)
- **Invoice Total**: Column G (index 6)
- **Commission Amount**: Column H (index 7)

**Output Type**: `"GoTo - CAD"`

### Tab 7: 2G Energy (Optional)

**Same logic as CAD tab** - uses section detection

**Output Type**: `"GoTo - 2G Energy"`

## Output Format

All tabs combine into single output with **7 columns** (GOTO_HEADERS):

```javascript
[
  State,                    // A - Looked up from Comp Key
  Account Name,             // B - May have * prefix for Equipment
  Account Number,           // C - Always blank ("")
  OTG Comp Billing item,   // D - Service number/ID
  Invoice Total,           // E - Numeric, parsed from currency
  Commission Amount,       // F - Numeric, adjusted if CN-568463-1409
  Type                     // G - Tab type identifier
]
```

## State Resolution

- State is always looked up from Comp Key using `getStateForBillingItem_(billingItem)`
- No State column in GoTo statements
- Returns empty string if not found in Comp Key

## Data Normalization

### Currency Parsing
- Removes `$`, commas, spaces
- Handles negative values: `(123.45)` → `-123.45`
- Returns `0` if blank/null

### Billing Item Normalization
- Trims whitespace
- Used for matching and state lookup

### Account Name Processing
- Trims whitespace
- Adds `*` prefix for Equipment tab rows
- Preserves original casing

## Special Rules Summary

1. **Special Commission Adjustment**: `CN-568463-1409` → subtract `118.29`
2. **Equipment Grouping**: Groups by billing item, sums totals, adds `*` to account name
3. **Canceled Swap**: Columns A and B are swapped
4. **Section Detection**: CAD and 2G Energy use section markers
5. **Stop Conditions**: Data tab stops at "customer details"

## Example Processing

### Data Tab Row:
**Input**:
```
Row 4: [..., "CN-568463-1409", "Acme Corp", ..., "$1000", "$118.29"]
```

**Processing**:
- Billing item = "CN-568463-1409" → Apply adjustment
- Commission = 118.29 - 118.29 = 0

**Output**:
```
["", "Acme Corp", "", "CN-568463-1409", 1000, 0, "GoTo"]
```

### Equipment Tab (Grouped):
**Input**:
```
Row 4: ["Acme Corp", ..., "CN-12345", ..., "$500", "$50"]
Row 5: ["", ..., "CN-12345", ..., "$300", "$30"]
```

**Processing**:
- Group by "CN-12345"
- Sum Invoice: 500 + 300 = 800
- Sum Commission: 50 + 30 = 80
- Use first Account Name: "Acme Corp" → "*Acme Corp"

**Output**:
```
["", "*Acme Corp", "", "CN-12345", 800, 80, "GoTo - Equipment"]
```

## Integration Points

### With Comp Key (Master Data)
- Uses `getStateForBillingItem_()` to lookup State
- Caches Comp Key data for performance

### With Matching Process
- GoTo rows go into "GoTo" tab in Combined spreadsheet
- Matching process uses "OTG Comp Billing item" as key
- Type column preserved for reference

## Error Handling

- If "Data" tab missing → throws error (required)
- If other tabs missing → skips them (optional)
- If section markers not found (CAD/2G) → returns empty array
- If billing item blank → skips row
- If account name and billing item both blank → skips row

## Performance Notes

- Processes tabs sequentially
- Equipment tab requires grouping (O(n) operation)
- Comp Key lookup is cached

## Next Steps for App Integration

To replicate this in the app:

1. **File Upload**: Accept XLSX files, detect if GoTo
2. **Tab Detection**: Find all tabs (Data required, others optional)
3. **Tab-Specific Processing**: Apply correct column mapping per tab
4. **Special Rules**: Apply commission adjustment, grouping, swapping
5. **Section Detection**: Use AI to detect sections for CAD/2G Energy
6. **Output**: Combine all tabs into single dataset

The AI can help with:
- Intelligent tab detection and classification
- Section boundary detection (CAD/2G Energy)
- Understanding special rules context
- Handling format variations
