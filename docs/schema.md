# Data Schema

## Current State (Client-Side Only)

Currently, all data exists only in React component state. No database or persistent storage.

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
