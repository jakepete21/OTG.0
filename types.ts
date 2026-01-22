export interface MasterRecord {
  id: string;
  clientName: string;
  serviceType: string;
  salesperson: string;
  expectedAmount: number; // Monthly expected revenue
  splitPercentage: number; // e.g., 0.10 for 10%
  [key: string]: any; // Allow dynamic custom columns
}

export enum DiscrepancyType {
  NONE = 'Matched',
  MISSING_PAYMENT = 'Missing Payment',
  AMOUNT_MISMATCH = 'Amount Mismatch',
  UNKNOWN_SERVICE = 'Unknown Service',
  DUPLICATE = 'Duplicate'
}

export interface ProcessedItem {
  id: string;
  date: string;
  vendor: string;
  clientName: string; // Extracted from statement
  serviceDescription: string;
  amountReceived: number;
  matchedMasterId?: string; // ID of the MasterRecord if matched
  salesperson?: string;
  commissionAmount: number;
  discrepancyType: DiscrepancyType;
  explanation: string;
}

export interface CommissionStatement {
  salesperson: string;
  totalCommission: number;
  items: ProcessedItem[];
}

export interface AnalysisResult {
  processedItems: ProcessedItem[];
  missingFromStatement: MasterRecord[]; // Items in Master but not in Statement
  summary: string;
}

// Carrier Statement Processing Types
export interface CarrierStatementRow {
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

export interface RoleSplits {
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
  HA1?: number;
  HA2?: number;
  HA3?: number;
  HA4?: number;
  HA5?: number;
  HA6?: number;
  OTG?: number;
}

export interface MatchedRow extends CarrierStatementRow {
  matchedMasterId: string;
  expectedCompPercent?: number;
  roleSplits: RoleSplits;
  vpNotes?: string;
}

export enum DisputeType {
  NEW_ACCOUNT = 'new_account',
  ZERO = 'zero',
  CHARGEBACK = 'chargeback',
  CANCELED = 'canceled',
  CHANGED_RATE = 'changed_rate',
  MONTHS_HELD = 'months_held'
}

export interface Dispute {
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

export interface SellerStatement {
  roleGroup: string; // 'RD1/2', 'RD3/4', 'RM1/2', 'RM3/4', 'OVR/RD5', 'OTG'
  items: SellerStatementItem[];
  totalOtgComp: number; // Total Commission Amount
  totalSellerComp: number; // Sum of role splits for this group
}

export interface SellerStatementItem {
  state: string;
  accountName: string;
  otgCompBillingItem: string;
  otgComp: number; // Commission Amount
  sellerComp: number; // Role split amount
  provider: string;
  vpNotes?: string;
}

export interface CarrierStatementProcessingResult {
  carrierStatementRows: CarrierStatementRow[];
  matchedRows: MatchedRow[];
  disputes: Dispute[];
  sellerStatements: SellerStatement[];
  summary: string;
}