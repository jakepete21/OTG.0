# OTG.0 - AI Commission Auditor

## What This App Is

A commission reconciliation tool that uses AI (Gemini) to match vendor statements against an internal master service list, identify discrepancies, and generate commission reports.

## Current State

### Tech Stack
- **Frontend**: React 19 + Vite + TypeScript
- **Backend**: Firebase (Firestore + Cloud Storage)
- **AI Service**: Google Gemini 2.5 Flash (via @google/genai)
- **UI Libraries**: Lucide React (icons), Recharts (charts)
- **Data Processing**: XLSX (Excel/CSV parsing)
- **State Management**: React hooks with Firebase real-time updates
- **Styling**: Tailwind CSS (inline classes)

### Current Features

#### 1. Comp Key (`MasterDataList2`)
- **Full Column Display**: Shows all 62 columns from the reformatted OTG.0 Comp Key CSV
- **Account-Level View**: Master data is grouped by account (Account **CARRIER** + OTG Comp Billing item)
- Account cards display summary information (total monthly comp, line item count, service provider, etc.)
- Click account card to expand and view all line items in a modal
- CRUD operations (add, edit, delete records) available within account detail modal
- Dynamic column rendering in account detail modals (all columns visible)
- Auto-loads reformatted CSV on mount
- Export functionality for complete dataset
- Uses reformatted CSV file with proper column ordering
- **Number Formatting**: All numbers display with proper comma formatting (e.g., $1,234.56)

#### 2. Upload Statement (`Dashboard`)
- Drag-and-drop file upload for monthly commission statements
- Supports: PDF, CSV, Excel, JSON, Images
- AI-powered extraction and matching
- Real-time processing status
- Discrepancy detection:
  - Matched
  - Missing Payment
  - Amount Mismatch
  - Unknown Service
  - Duplicate

#### 3. Disputes (`Disputes`)
- View all discrepancies and issues from statement analysis
- Grouped by discrepancy type (Amount Mismatch, Unknown Service, Duplicate)
- Missing payments section (expected but not found in statement)
- Summary cards showing dispute counts

#### 4. Commissions (`Reports`)
- **Expandable Month Sections**: Shows January 2026 through June 2026 as expandable accordion sections
- **Carrier Status Display**: Each month shows carrier upload status (✅ uploaded, ❌ missing) for all 6 carriers
- **Status Badges**: Complete (6/6 carriers), Partial (1-5/6), or Empty (0/6) status per month
- **Seller Statements**: When expanded, shows seller statements grouped by role groups (RD1/2, RD3/4, RM1/2, RM3/4, OVR/RD5, OTG)
- **Account View & Line Item View**: Toggle between account-level summary or detailed line item view
- **Number Formatting**: All currency amounts display with proper comma formatting (e.g., $1,234.56)
- Expandable transaction details
- Export/print functionality (PDF export)
- **Carrier Statement Management**: Delete carrier statements directly from Commissions tab with confirmation

#### 5. Statement Compare
- Compare uploaded CSV/XLSX seller statements (by role group) against Firebase seller statements for a processing month
- AI (Gemini) detects column mappings when sheet/column names vary
- **10-cent tolerance**: In the UI, amounts and total differences within $0.10 are treated as matching to avoid flagging small rounding drift; seller statement generation is unchanged

### Data Flow

1. **Master Data Setup**: User imports/creates master records with expected services
2. **Statement Upload**: User uploads vendor statement (PDF, CSV, Excel, etc.)
3. **AI Processing**: Gemini extracts line items and matches against master data
4. **Discrepancy Detection**: System identifies missing payments, amount mismatches, unknown services
5. **Report Generation**: Commission statements generated per salesperson

### Key Workflows

#### Upload & Process Statement
1. User ensures master data is loaded
2. User uploads vendor statement file
3. File is parsed (structured) or sent to Gemini (unstructured)
4. Gemini analyzes statement against master data
5. Results displayed with summary stats, charts, and detailed table
6. Missing payments highlighted separately

#### Manage Master Data
1. Import via file upload or paste from spreadsheet
2. System auto-detects column mappings
3. User can add/edit/delete records
4. Custom columns can be added
5. Export to CSV for backup
6. **CSV Analysis**: Use Gemini AI to analyze CSV structure, identify data quality issues, and get cleaning suggestions
7. **CSV Cleaning**: Apply AI-suggested cleaning operations (remove duplicates, normalize values, fix data types)

#### Master Data 2 (Full Column View)
1. Auto-loads reformatted CSV with all 62 columns
2. View complete dataset with all columns visible
3. Account-level grouping with full column details in modals
4. Export complete dataset with all columns

## Architecture Decisions

### Backend Architecture
- **Firebase Firestore**: NoSQL database for carrier statements, matches, and seller statements
- **Firebase Cloud Storage**: File storage for carrier statement XLSX files
- **Real-time Updates**: Firestore `onSnapshot` provides real-time data synchronization
- **Client-Side Processing**: Statement processing, matching, and seller statement generation happen client-side
- Data persists across page refreshes

### AI Integration Pattern
- Uses Gemini's structured output (JSON schema)
- Two-step process: column mapping → full analysis
- Handles both structured (CSV/Excel) and unstructured (PDF/Images) files
- Gemini API called directly from browser (API key in environment variables)

### State Management
- React hooks (`useCarrierStatements`, `useSellerStatements`, etc.) provide real-time data
- Firebase handles persistence and synchronization for carrier statements, matches, and seller statements
- Component-level state for UI interactions
- Master data stored in component state (Master Data 2 uses reformatted CSV with all columns)
- Future: Migrate master data to Firestore for persistence

## Current Limitations

1. **Master Data**: Still stored in component state (not persisted)
2. **No User Authentication**: Single-user application (security rules in test mode)
3. **No Multi-User**: Single-user application
4. **API Key Exposure**: Gemini API key in client code (security risk - should move to backend)
5. **Limited Validation**: Basic input validation

## Future Considerations

- Migrate master data to Firestore
- Add user authentication (Firebase Auth)
- Add proper security rules (currently in test mode)
- Move Gemini API key to backend/Cloud Functions
- Add multi-tenant support with proper RLS
- Add analysis history tracking
- Enhanced PDF export features
