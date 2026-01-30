/**
 * Firebase Queries Service
 * Handles read operations from Firestore
 */

import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebaseClient';

/**
 * Carrier Statement document structure
 */
export interface CarrierStatementDoc {
  id: string;
  filename: string;
  carrier: 'GoTo' | 'Lumen' | 'MetTel' | 'TBO' | 'Zayo' | 'Allstream';
  statementMonth: string; // "YYYY-MM"
  processingMonth: string; // "YYYY-MM"
  fileUrl: string;
  uploadedAt: Timestamp | Date;
}

/**
 * Match document structure
 */
export interface MatchDoc {
  id: string;
  processingMonth: string;
  matchedRow: any; // MatchedRow
  carrierStatementId: string;
  createdAt: Timestamp | Date;
}

/**
 * Seller Statement document structure
 */
export interface SellerStatementDoc {
  id: string;
  processingMonth: string;
  roleGroup: 'RD1/2' | 'RD3/4' | 'RM1/2' | 'RM3/4' | 'OVR/RD5' | 'OTG';
  items: any[]; // SellerStatementItem[]
  totalOtgComp: number;
  totalSellerComp: number;
  processedAt: Timestamp | Date;
}

/**
 * Get all carrier statements, optionally filtered by processing month
 */
export async function getCarrierStatements(
  processingMonth?: string
): Promise<CarrierStatementDoc[]> {
  const statementsRef = collection(db, 'carrierStatements');
  let q = query(statementsRef, orderBy('uploadedAt', 'desc'));

  if (processingMonth) {
    q = query(
      statementsRef,
      where('processingMonth', '==', processingMonth),
      orderBy('uploadedAt', 'desc')
    );
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as CarrierStatementDoc[];
}

/**
 * Get seller statements for a processing month
 */
export async function getSellerStatements(
  processingMonth: string
): Promise<SellerStatementDoc[]> {
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const q = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth),
    orderBy('roleGroup', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as SellerStatementDoc[];
}

/**
 * Get file download URL from storage path or URL
 */
export async function getFileUrl(storagePathOrUrl: string): Promise<string> {
  // If it's already a full URL, return it
  if (storagePathOrUrl.startsWith('http://') || storagePathOrUrl.startsWith('https://')) {
    return storagePathOrUrl;
  }

  // Otherwise, treat it as a storage path
  const storageRef = ref(storage, storagePathOrUrl);
  return await getDownloadURL(storageRef);
}

/**
 * Get a single carrier statement by ID
 * Note: This function is not efficient for Firestore - use getDoc instead
 * Keeping for compatibility but consider using getDoc directly in hooks
 */
export async function getCarrierStatementById(
  statementId: string
): Promise<CarrierStatementDoc | null> {
  const { doc, getDoc } = await import('firebase/firestore');
  const statementRef = doc(db, 'carrierStatements', statementId);
  const statementDoc = await getDoc(statementRef);

  if (!statementDoc.exists()) {
    return null;
  }

  return {
    id: statementDoc.id,
    ...statementDoc.data(),
  } as CarrierStatementDoc;
}
