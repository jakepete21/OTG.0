/**
 * Firebase Mutations Service
 * Handles write operations to Firestore and Cloud Storage
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  query,
  where,
  getDocs,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from './firebaseClient';
import { generateSellerStatements } from './sellerStatements';
import { MatchedRow } from '../types';

/**
 * Remove undefined values from an object recursively
 * Firestore doesn't allow undefined values - they must be null or omitted
 */
function removeUndefinedValues<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedValues) as T;
  }
  
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefinedValues(value);
      }
    }
    return cleaned as T;
  }
  
  return obj;
}

/**
 * Upload carrier statement file to Cloud Storage and store metadata in Firestore
 * Checks for duplicates (same carrier + processingMonth) and allows replacing
 */
export async function uploadCarrierStatement(
  file: File,
  metadata: {
    filename: string;
    carrier: 'GoTo' | 'Lumen' | 'MetTel' | 'TBO' | 'Zayo' | 'Allstream';
    statementMonth: string; // "YYYY-MM"
    processingMonth: string; // "YYYY-MM"
  }
): Promise<{ statementId: string; isReplacement: boolean; fileUrl: string }> {
  const { filename, carrier, statementMonth, processingMonth } = metadata;

  // Check for duplicate (same carrier + processing month)
  const statementsRef = collection(db, 'carrierStatements');
  const duplicateQuery = query(
    statementsRef,
    where('carrier', '==', carrier),
    where('processingMonth', '==', processingMonth)
  );
  const duplicateSnapshot = await getDocs(duplicateQuery);
  const existing = duplicateSnapshot.docs[0];

  // Upload file to Cloud Storage
  // Path structure: carrier-statements/{processingMonth}/{carrier}/{filename}
  const storagePath = `carrier-statements/${processingMonth}/${carrier}/${filename}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file);
  const fileUrl = await getDownloadURL(storageRef);

  const uploadedAt = Timestamp.now();
  let statementId: string;
  let isReplacement = false;

  if (existing) {
    // Replace existing statement
    statementId = existing.id;
    isReplacement = true;
    
    // Update metadata
    await setDoc(
      doc(db, 'carrierStatements', statementId),
      {
        filename,
        carrier,
        statementMonth,
        processingMonth,
        fileUrl,
        uploadedAt,
      },
      { merge: true }
    );

    // Delete old matches for this statement
    const matchesRef = collection(db, 'matches');
    const matchesQuery = query(
      matchesRef,
      where('carrierStatementId', '==', statementId)
    );
    const matchesSnapshot = await getDocs(matchesQuery);
    
    const batch = writeBatch(db);
    matchesSnapshot.docs.forEach((matchDoc) => {
      batch.delete(matchDoc.ref);
    });
    await batch.commit();

    // Delete old file from storage if path is different
    const oldData = existing.data();
    if (oldData.fileUrl && oldData.fileUrl !== fileUrl) {
      try {
        const oldStorageRef = ref(storage, oldData.fileUrl);
        await deleteObject(oldStorageRef);
      } catch (error) {
        console.warn('Failed to delete old file from storage:', error);
      }
    }
  } else {
    // Create new statement
    const newDocRef = doc(collection(db, 'carrierStatements'));
    statementId = newDocRef.id;
    
    await setDoc(newDocRef, {
      filename,
      carrier,
      statementMonth,
      processingMonth,
      fileUrl,
      uploadedAt,
    });
  }

  // Clear seller statements for this processing month (will be regenerated)
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const sellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth)
  );
  const sellerSnapshot = await getDocs(sellerQuery);
  
  const batch = writeBatch(db);
  sellerSnapshot.docs.forEach((sellerDoc) => {
    batch.delete(sellerDoc.ref);
  });
  await batch.commit();

  return { statementId, isReplacement, fileUrl };
}

/**
 * Store matches in batches
 * Client processes matches client-side, then stores them here
 * Automatically splits into smaller batches if needed (Firestore limit: 500 operations per batch)
 */
export async function storeMatches(
  processingMonth: string,
  carrierStatementId: string,
  matchedRowsBatch: MatchedRow[]
): Promise<{ success: boolean; count: number }> {
  const matchesRef = collection(db, 'matches');
  const createdAt = Timestamp.now();
  
  // Firestore batch limit: 500 operations per batch
  // Use 450 to leave some headroom for safety
  const BATCH_SIZE = 450;
  let totalStored = 0;

  // Process in chunks to avoid "Transaction too big" error
  for (let i = 0; i < matchedRowsBatch.length; i += BATCH_SIZE) {
    const chunk = matchedRowsBatch.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach((matchedRow) => {
      const matchDocRef = doc(matchesRef);
      // Remove undefined values from matchedRow before storing (Firestore doesn't allow undefined)
      const cleanedMatchedRow = removeUndefinedValues(matchedRow);
      batch.set(matchDocRef, {
        processingMonth,
        matchedRow: cleanedMatchedRow,
        carrierStatementId,
        createdAt,
      });
    });

    await batch.commit();
    totalStored += chunk.length;
    
    // Log progress for large batches
    if (matchedRowsBatch.length > BATCH_SIZE) {
      console.log(`[storeMatches] Stored batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(matchedRowsBatch.length / BATCH_SIZE)} (${chunk.length} matches)`);
    }
  }

  return { success: true, count: totalStored };
}

/**
 * Regenerate seller statements from all matches for a processing month
 * Client calls this after storing all matches
 */
export async function regenerateSellerStatements(
  processingMonth: string
): Promise<{ success: boolean; matchedRowsCount: number; sellerStatementGroups: number }> {
  // Get all matches for this processing month
  const matchesRef = collection(db, 'matches');
  const matchesQuery = query(
    matchesRef,
    where('processingMonth', '==', processingMonth)
  );
  const matchesSnapshot = await getDocs(matchesQuery);

  if (matchesSnapshot.empty) {
    // Clear existing seller statements
    const sellerStatementsRef = collection(db, 'sellerStatements');
    const sellerQuery = query(
      sellerStatementsRef,
      where('processingMonth', '==', processingMonth)
    );
    const sellerSnapshot = await getDocs(sellerQuery);
    
    const batch = writeBatch(db);
    sellerSnapshot.docs.forEach((sellerDoc) => {
      batch.delete(sellerDoc.ref);
    });
    await batch.commit();
    
    return { success: true, matchedRowsCount: 0, sellerStatementGroups: 0 };
  }

  // Convert Firestore matches to MatchedRow array
  const matchedRows: MatchedRow[] = matchesSnapshot.docs.map((doc) => doc.data().matchedRow);
  
  // Log match statistics for debugging
  const matchStats = matchesSnapshot.docs.reduce((acc, doc) => {
    const data = doc.data();
    const carrierId = data.carrierStatementId || 'unknown';
    acc[carrierId] = (acc[carrierId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log(`[regenerateSellerStatements] Processing ${matchedRows.length} total matches for ${processingMonth}`);
  console.log(`[regenerateSellerStatements] Matches by carrier statement:`, matchStats);

  // Generate seller statements using client-side logic
  const sellerStatements = generateSellerStatements(matchedRows);

  // Delete existing seller statements in batches (Firestore limit: 500 operations per batch)
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const sellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth)
  );
  const sellerSnapshot = await getDocs(sellerQuery);
  
  // Delete in batches if needed
  const DELETE_BATCH_SIZE = 450;
  const sellerDocs = sellerSnapshot.docs;
  for (let i = 0; i < sellerDocs.length; i += DELETE_BATCH_SIZE) {
    const chunk = sellerDocs.slice(i, i + DELETE_BATCH_SIZE);
    const deleteBatch = writeBatch(db);
    chunk.forEach((sellerDoc) => {
      deleteBatch.delete(sellerDoc.ref);
    });
    await deleteBatch.commit();
  }

  // Store new seller statements
  const processedAt = Timestamp.now();
  const storeBatch = writeBatch(db);
  
  sellerStatements.forEach((stmt) => {
    const sellerDocRef = doc(sellerStatementsRef);
    // Remove undefined values before storing (Firestore doesn't allow undefined)
    const cleanedStmt = removeUndefinedValues(stmt);
    storeBatch.set(sellerDocRef, {
      processingMonth,
      roleGroup: cleanedStmt.roleGroup,
      items: cleanedStmt.items,
      totalOtgComp: cleanedStmt.totalOtgComp,
      totalSellerComp: cleanedStmt.totalSellerComp,
      processedAt,
    });
  });
  
  await storeBatch.commit();

  return {
    success: true,
    matchedRowsCount: matchedRows.length,
    sellerStatementGroups: sellerStatements.length,
  };
}

/**
 * Delete a carrier statement
 * Deletes statement, matches, and file
 * Note: Client should call regenerateSellerStatements after deletion
 */
export async function deleteCarrierStatement(
  statementId: string
): Promise<{
  success: boolean;
  statementId: string;
  processingMonth: string;
  deletedMatchesCount: number;
  deletedSellerStatementsCount: number;
}> {
  // Get statement info before deleting
  const statementRef = doc(db, 'carrierStatements', statementId);
  const statementDoc = await getDoc(statementRef);
  
  if (!statementDoc.exists()) {
    throw new Error('Statement not found');
  }

  const statementData = statementDoc.data();
  const processingMonth = statementData.processingMonth;
  const fileUrl = statementData.fileUrl;

  // Delete matches for this statement in batches (Firestore limit: 500 operations per batch)
  const matchesRef = collection(db, 'matches');
  const matchesQuery = query(
    matchesRef,
    where('carrierStatementId', '==', statementId)
  );
  const matchesSnapshot = await getDocs(matchesQuery);
  
  const deletedMatchesCount = matchesSnapshot.docs.length;
  
  // Delete matches in batches if needed
  const DELETE_BATCH_SIZE = 450;
  const matchDocs = matchesSnapshot.docs;
  for (let i = 0; i < matchDocs.length; i += DELETE_BATCH_SIZE) {
    const chunk = matchDocs.slice(i, i + DELETE_BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((matchDoc) => {
      batch.delete(matchDoc.ref);
    });
    await batch.commit();
  }

  // Delete the statement (separate batch to ensure it's deleted even if matches deletion fails)
  const statementBatch = writeBatch(db);
  statementBatch.delete(statementRef);
  await statementBatch.commit();

  // Delete file from storage
  if (fileUrl) {
    try {
      // Extract storage path from URL
      // Firebase Storage URLs are in format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
      // We need to extract and decode the path part
      const urlObj = new URL(fileUrl);
      const pathMatch = urlObj.pathname.match(/\/o\/(.+?)(?:\?|$)/);
      if (pathMatch) {
        // Decode the path (it's URL-encoded in the storage URL)
        const storagePath = decodeURIComponent(pathMatch[1].replace(/%2F/g, '/'));
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
        console.log(`[deleteCarrierStatement] Deleted file from storage: ${storagePath}`);
      } else {
        // If URL parsing fails, try to reconstruct path from metadata
        // Path structure: carrier-statements/{processingMonth}/{carrier}/{filename}
        const filename = statementData.filename || 'unknown';
        const carrier = statementData.carrier || 'unknown';
        const storagePath = `carrier-statements/${processingMonth}/${carrier}/${filename}`;
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
        console.log(`[deleteCarrierStatement] Deleted file from storage (reconstructed path): ${storagePath}`);
      }
    } catch (error: any) {
      // Log but don't fail the entire deletion if file deletion fails
      // The file might have already been deleted or the path might be incorrect
      console.warn(`[deleteCarrierStatement] Failed to delete file from storage (continuing with Firestore deletion):`, error.message);
    }
  }

  // Note: Seller statements are cleared by the client calling regenerateSellerStatements
  // We don't delete them here to avoid race conditions
  // The client will regenerate seller statements after deletion

  return {
    success: true,
    statementId,
    processingMonth,
    deletedMatchesCount,
    deletedSellerStatementsCount: 0, // Seller statements are regenerated by client, not deleted here
  };
}
