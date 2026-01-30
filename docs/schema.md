# Data Schema

## Current State (Hybrid: Component State + Firebase)

- **Master Data**: Stored in React component state (not persisted to database)
- **Carrier Statements**: Stored in Firebase Firestore + Cloud Storage
- **Matches**: Stored in Firebase Firestore
- **Seller Statements**: Stored in Firebase Firestore
- **Processing Months**: Derived from carrier statements in Firestore

## TypeScript Types

### MasterRecord
```typescript
interface MasterRecord {
  id: string;                    // Generated: "master-{timestamp}"
  clientName: string;            // Required
  serviceType: string;           // Required
  salesperson: string;           // Required
  expectedAmount: number;        // Monthly expected revenue
  splitPercentage: number;       // Commission split (0.10 = 10%)
  [key: string]: any;            // Dynamic custom columns
}
```

### ProcessedItem
```typescript
interface ProcessedItem {
  id: string;                    // Generated: "proc-{idx}-{timestamp}"
  date: string;                  // YYYY-MM-DD format
  vendor: string;
  clientName: string;            // Extracted from statement
  serviceDescription: string;
  amountReceived: number;
  matchedMasterId?: string;      // ID of matched MasterRecord
  salesperson?: string;           // From MasterRecord if matched
  commissionAmount: number;      // Calculated: amountReceived * splitPercentage
  discrepancyType: DiscrepancyType;
  explanation: string;
}
```

### DiscrepancyType Enum
- `NONE` = 'Matched'
- `MISSING_PAYMENT` = 'Missing Payment'
- `AMOUNT_MISMATCH` = 'Amount Mismatch'
- `UNKNOWN_SERVICE` = 'Unknown Service'
- `DUPLICATE` = 'Duplicate'

### AnalysisResult
```typescript
interface AnalysisResult {
  processedItems: ProcessedItem[];
  missingFromStatement: MasterRecord[];  // Master records not found in statement
  summary: string;                       // AI-generated summary
}
```

### CommissionStatement
```typescript
interface CommissionStatement {
  salesperson: string;
  totalCommission: number;
  items: ProcessedItem[];
}
```

### CarrierStatementRow
```typescript
interface CarrierStatementRow {
  state: string;
  accountName: string;
  accountNumber: string;
  otgCompBillingItem: string;
  invoiceTotal: number;
  commissionAmount: number;
  provider: string;
  carrierStatement: string; // Carrier name (GoTo, Lumen, Zayo, etc.)
  billDescription?: string;
  billPeriod?: string;
}
```

### MatchedRow
```typescript
interface MatchedRow extends CarrierStatementRow {
  matchedMasterId: string;
  expectedCompPercent?: number;
  roleSplits: RoleSplits;
  vpNotes?: string;
}

interface RoleSplits {
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
}
```

### Dispute
```typescript
enum DisputeType {
  NEW_ACCOUNT = 'new_account',
  ZERO = 'zero',
  CHARGEBACK = 'chargeback',
  CANCELED = 'canceled',
  CHANGED_RATE = 'changed_rate',
  MONTHS_HELD = 'months_held'
}

interface Dispute {
  id: string;
  type: DisputeType;
  accountName: string;
  otgCompBillingItem: string;
  state?: string;
  accountNumber?: string;
  expectedAmount?: number;
  actualAmount?: number;
  difference?: number;
  explanation: string;
  dateDetected: Date;
  provider?: string;
  carrierStatement?: string;
  billDescription?: string;
  billPeriod?: string;
}
```

### SellerStatement
```typescript
interface SellerStatement {
  roleGroup: string; // 'RD1/2', 'RD3/4', 'RM1/2', 'RM3/4', 'OVR/RD5', 'OTG'
  items: SellerStatementItem[];
  totalOtgComp: number; // Total Commission Amount
  totalSellerComp: number; // Sum of role splits for this group
}

interface SellerStatementItem {
  state: string;
  accountName: string;
  otgCompBillingItem: string;
  otgComp: number; // Commission Amount
  sellerComp: number; // Role split amount
  provider: string;
  vpNotes?: string;
}
```

### CarrierStatementProcessingResult
```typescript
interface CarrierStatementProcessingResult {
  carrierStatementRows: CarrierStatementRow[];
  matchedRows: MatchedRow[];
  disputes: Dispute[];
  sellerStatements: SellerStatement[];
  summary: string;
}
```

### CarrierStatement (Statement Storage)
```typescript
interface CarrierStatement {
  id: string;
  filename: string;
  carrier: 'GoTo' | 'Lumen' | 'MetTel' | 'TBO' | 'Zayo' | 'Allstream';
  statementMonth: Date; // Month of statement (e.g., October 2025)
  processingMonth: Date; // Month being processed (e.g., December 2025)
  uploadedAt: Date;
  rows: CarrierStatementRow[];
  matchedRows?: MatchedRow[];
  sellerStatements?: SellerStatement[];
  disputes?: Dispute[];
}
```

### ProcessingMonthData
```typescript
interface ProcessingMonthData {
  monthKey: string; // Format: "YYYY-MM" (e.g., "2025-12")
  monthLabel: string; // Format: "Month YYYY" (e.g., "December 2025")
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
```

## Firebase Backend Schema (Current Implementation)

The application uses Firebase Firestore as the backend database. The schema is defined in `firestore/firestore.rules` and `firestore/firestore.indexes.json`.

### Collections

#### `carrierStatements`
Stores uploaded carrier statement files and their metadata.

**Fields**:
- `id` (string) - Auto-generated document ID
- `filename` (string) - Original filename
- `carrier` (string) - Carrier type: "GoTo" | "Lumen" | "MetTel" | "TBO" | "Zayo" | "Allstream"
- `statementMonth` (string) - Statement month in "YYYY-MM" format
- `processingMonth` (string) - Processing month in "YYYY-MM" format
- `fileUrl` (string) - Firebase Cloud Storage URL
- `uploadedAt` (Timestamp) - Timestamp when uploaded

**Indexes** (defined in `firestore/firestore.indexes.json`):
- `processingMonth` (ascending) - Single-field index
- `carrier` (ascending) + `processingMonth` (ascending) - Composite index

#### `matches`
Stores matched rows per processing month.

**Fields**:
- `id` (string) - Auto-generated document ID
- `processingMonth` (string) - Processing month in "YYYY-MM" format
- `matchedRow` (object) - MatchedRow object
- `carrierStatementId` (string) - Reference to source carrier statement document ID
- `createdAt` (Timestamp) - Timestamp when created

**Indexes**:
- `processingMonth` (ascending) - Single-field index
- `carrierStatementId` (ascending) - Single-field index

#### `sellerStatements`
Stores processed seller statements grouped by role group.

**Fields**:
- `id` (string) - Auto-generated document ID
- `processingMonth` (string) - Processing month in "YYYY-MM" format
- `roleGroup` (string) - Role group: "RD1/2" | "RD3/4" | "RM1/2" | "RM3/4" | "OVR/RD5" | "OTG"
- `items` (array) - Array of SellerStatementItem objects
- `totalOtgComp` (number) - Total OTG commission
- `totalSellerComp` (number) - Total seller commission
- `processedAt` (Timestamp) - Timestamp when processed

**Indexes**:
- `processingMonth` (ascending) - Single-field index
- `roleGroup` (ascending) + `processingMonth` (ascending) - Composite index

### File Storage

XLSX files are stored in Firebase Cloud Storage at path: `carrier-statements/{processingMonth}/{carrier}/{filename}`

Files are referenced via `fileUrl` in the `carrierStatements` collection. Download URLs are generated using Firebase Storage SDK.

### Service Layer

**Mutations** (see `services/firebaseMutations.ts`):
- `uploadCarrierStatement()` - Upload file to Storage, store metadata in Firestore (handles duplicates)
- `storeMatches()` - Store matches in batches
- `regenerateSellerStatements()` - Generate and store seller statements from all matches
- `deleteCarrierStatement()` - Delete statement, matches, file, and regenerate seller statements

**Queries** (see `services/firebaseQueries.ts`):
- `getCarrierStatements()` - Get all statements (optionally filtered by processing month)
- `getCarrierStatementById()` - Get single statement
- `getSellerStatements()` - Get seller statements for a processing month
- `getFileUrl()` - Get download URL from Storage path or URL

**React Hooks** (see `services/firebaseHooks.ts`):
- `useCarrierStatements()` - Real-time hook for carrier statements
- `useSellerStatements()` - Real-time hook for seller statements
- `useProcessingMonths()` - Derive processing months from carrier statements
- `useCarrierStatementById()` - Real-time hook for single statement

## Future Database Schema (If Migrating to Supabase)

### Tables Needed

#### `orgs`
- `id` (uuid, primary key)
- `name` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)

#### `profiles` (extends Supabase auth.users)
- `id` (uuid, references auth.users)
- `email` (text)
- `full_name` (text)
- `created_at` (timestamp)

#### `org_members`
- `id` (uuid, primary key)
- `org_id` (uuid, references orgs)
- `user_id` (uuid, references profiles)
- `role` (text: 'owner' | 'admin' | 'member')
- `created_at` (timestamp)

#### `master_records`
- `id` (uuid, primary key)
- `org_id` (uuid, references orgs)
- `client_name` (text)
- `service_type` (text)
- `salesperson` (text)
- `expected_amount` (numeric)
- `split_percentage` (numeric)
- `custom_fields` (jsonb)  // For dynamic columns
- `created_at` (timestamp)
- `updated_at` (timestamp)

#### `analyses` (analysis runs)
- `id` (uuid, primary key)
- `org_id` (uuid, references orgs)
- `statement_filename` (text)
- `statement_type` (text)
- `summary` (text)
- `created_at` (timestamp)
- `created_by` (uuid, references profiles)

#### `processed_items`
- `id` (uuid, primary key)
- `analysis_id` (uuid, references analyses)
- `master_record_id` (uuid, nullable, references master_records)
- `date` (date)
- `vendor` (text)
- `client_name` (text)
- `service_description` (text)
- `amount_received` (numeric)
- `commission_amount` (numeric)
- `discrepancy_type` (text)
- `explanation` (text)

## RLS Intent (Future)

### Multi-Tenant Access Pattern
- Users can only access data for orgs they're members of
- RLS policies check `org_members` table
- All domain tables include `org_id` for filtering

### Example RLS Policies

```sql
-- Master records: org members can read/write their org's records
CREATE POLICY "org_members_can_access_master_records"
ON master_records
FOR ALL
USING (
  org_id IN (
    SELECT org_id FROM org_members 
    WHERE user_id = auth.uid()
  )
);

-- Analyses: org members can read/write their org's analyses
CREATE POLICY "org_members_can_access_analyses"
ON analyses
FOR ALL
USING (
  org_id IN (
    SELECT org_id FROM org_members 
    WHERE user_id = auth.uid()
  )
);
```

## Migration Notes

When adding persistence:
1. Keep TypeScript types aligned with database schema
2. Use Zod for runtime validation
3. Consider using Supabase's TypeScript generator
4. Add migration scripts for existing data (if any)
