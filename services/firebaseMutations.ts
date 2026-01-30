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
 * Remove undefined values and clean data for Firestore compatibility
 * Firestore doesn't allow undefined values, functions, or certain types
 */
function removeUndefinedValues<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // Handle functions - convert to null (Firestore doesn't support functions)
  if (typeof obj === 'function') {
    return null as T;
  }
  
  // Handle Date objects - convert to ISO string
  if (obj instanceof Date) {
    return obj.toISOString() as T;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedValues).filter(item => item !== null && item !== undefined) as T;
  }
  
  // Handle objects
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip undefined values
      if (value === undefined) {
        continue;
      }
      
      // Skip functions
      if (typeof value === 'function') {
        continue;
      }
      
      // Recursively clean nested objects
      cleaned[key] = removeUndefinedValues(value);
    }
    return cleaned as T;
  }
  
  // Return primitive values as-is
  return obj;
}

/**
 * Clean and validate data for Firestore
 * Ensures data is serializable and within size limits
 */
function cleanForFirestore(records: any[]): any[] {
  return records.map(record => {
    const cleaned: any = {};
    
    for (const [key, value] of Object.entries(record)) {
      // Skip undefined
      if (value === undefined) {
        continue;
      }
      
      // Skip functions
      if (typeof value === 'function') {
        continue;
      }
      
      // Convert Date to string
      if (value instanceof Date) {
        cleaned[key] = value.toISOString();
        continue;
      }
      
      // Convert null to empty string for strings, or keep null for other types
      if (value === null) {
        cleaned[key] = '';
        continue;
      }
      
      // Handle arrays
      if (Array.isArray(value)) {
        cleaned[key] = value.map(item => {
          if (typeof item === 'function' || item === undefined) return '';
          if (item instanceof Date) return item.toISOString();
          return item;
        });
        continue;
      }
      
      // Handle objects
      if (typeof value === 'object') {
        const nestedCleaned: any = {};
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (nestedValue !== undefined && typeof nestedValue !== 'function') {
            if (nestedValue instanceof Date) {
              nestedCleaned[nestedKey] = nestedValue.toISOString();
            } else {
              nestedCleaned[nestedKey] = nestedValue;
            }
          }
        }
        cleaned[key] = nestedCleaned;
        continue;
      }
      
      // Primitive values
      cleaned[key] = value;
    }
    
    return cleaned;
  });
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

    // Delete old matches for this statement in batches (to avoid transaction size limit)
    const matchesRef = collection(db, 'matches');
    const matchesQuery = query(
      matchesRef,
      where('carrierStatementId', '==', statementId)
    );
    const matchesSnapshot = await getDocs(matchesQuery);
    
    // Delete in batches of 450 (Firestore limit is 500)
    // Add delays between batches to prevent "Write stream exhausted" errors
    const DELETE_BATCH_SIZE = 450;
    const matchDocs = matchesSnapshot.docs;
    const totalBatches = Math.ceil(matchDocs.length / DELETE_BATCH_SIZE);
    
    for (let i = 0; i < matchDocs.length; i += DELETE_BATCH_SIZE) {
      const chunk = matchDocs.slice(i, i + DELETE_BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((matchDoc) => {
        batch.delete(matchDoc.ref);
      });
      await batch.commit();
      const currentBatch = Math.floor(i / DELETE_BATCH_SIZE) + 1;
      console.log(`[uploadCarrierStatement] Deleted ${chunk.length} old matches (batch ${currentBatch}/${totalBatches})`);
      
      // Add delay between batches to prevent write stream exhaustion (except for the last batch)
      if (currentBatch < totalBatches) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

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
  matchedRowsBatch: MatchedRow[],
  onProgress?: (current: number, total: number) => void
): Promise<{ success: boolean; count: number }> {
  const matchesRef = collection(db, 'matches');
  const createdAt = Timestamp.now();
  
  // Firestore batch limit: 500 operations per batch
  // Use 450 to leave some headroom for safety
  const BATCH_SIZE = 450;
  let totalStored = 0;

  const totalBatches = Math.ceil(matchedRowsBatch.length / BATCH_SIZE);

  // Process in chunks to avoid "Transaction too big" error
  for (let i = 0; i < matchedRowsBatch.length; i += BATCH_SIZE) {
    const chunk = matchedRowsBatch.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

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
    
    // Report progress
    if (onProgress) {
      onProgress(currentBatch, totalBatches);
    }
    
    // Log progress for large batches
    if (matchedRowsBatch.length > BATCH_SIZE) {
      console.log(`[storeMatches] Stored batch ${currentBatch}/${totalBatches} (${chunk.length} matches)`);
    }
  }

  return { success: true, count: totalStored };
}

/**
 * Update seller statements by removing items from deleted matches
 * Much faster than regenerating - just removes items and recalculates totals
 */
export async function removeItemsFromSellerStatements(
  processingMonth: string,
  deletedMatches: MatchedRow[]
): Promise<{ success: boolean; updatedGroups: number; removedItemsCount: number }> {
  if (deletedMatches.length === 0) {
    return { success: true, updatedGroups: 0, removedItemsCount: 0 };
  }

  // Create a set of identifiers for items to remove
  // Match by otgCompBillingItem + accountName (key fields)
  const itemsToRemove = new Set<string>();
  deletedMatches.forEach(match => {
    if (match.otgCompBillingItem && match.accountName) {
      const key = `${match.otgCompBillingItem}|${match.accountName}`;
      itemsToRemove.add(key);
    }
  });

  if (itemsToRemove.size === 0) {
    return { success: true, updatedGroups: 0, removedItemsCount: 0 };
  }

  // Get all seller statements for this processing month
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const sellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth)
  );
  const sellerSnapshot = await getDocs(sellerQuery);

  if (sellerSnapshot.empty) {
    return { success: true, updatedGroups: 0, removedItemsCount: 0 };
  }

  const batch = writeBatch(db);
  let updatedGroups = 0;
  let removedItemsCount = 0;

  sellerSnapshot.docs.forEach((sellerDoc) => {
    const data = sellerDoc.data();
    const items: any[] = data.items || [];
    
    // Filter out items that match deleted matches
    const filteredItems = items.filter(item => {
      const key = `${item.otgCompBillingItem}|${item.accountName}`;
      const shouldRemove = itemsToRemove.has(key);
      if (shouldRemove) {
        removedItemsCount++;
      }
      return !shouldRemove;
    });

    // If no items left, delete the seller statement document
    if (filteredItems.length === 0) {
      batch.delete(sellerDoc.ref);
      updatedGroups++;
    } else {
      // Recalculate totals
      const totalOtgComp = filteredItems.reduce((sum, item) => sum + (item.otgComp || 0), 0);
      const totalSellerComp = filteredItems.reduce((sum, item) => sum + (item.sellerComp || 0), 0);

      // Update the document
      batch.update(sellerDoc.ref, {
        items: filteredItems,
        totalOtgComp,
        totalSellerComp,
        processedAt: Timestamp.now(), // Update timestamp
      });
      updatedGroups++;
    }
  });

  await batch.commit();

  console.log(`[removeItemsFromSellerStatements] Removed ${removedItemsCount} items from ${updatedGroups} seller statement groups`);

  return {
    success: true,
    updatedGroups,
    removedItemsCount,
  };
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
  const totalSellerBatches = Math.ceil(sellerDocs.length / DELETE_BATCH_SIZE);
  for (let i = 0; i < sellerDocs.length; i += DELETE_BATCH_SIZE) {
    const chunk = sellerDocs.slice(i, i + DELETE_BATCH_SIZE);
    const deleteBatch = writeBatch(db);
    chunk.forEach((sellerDoc) => {
      deleteBatch.delete(sellerDoc.ref);
    });
    await deleteBatch.commit();
    
    // Add delay between batches to prevent write stream exhaustion (except for the last batch)
    const currentBatch = Math.floor(i / DELETE_BATCH_SIZE) + 1;
    if (currentBatch < totalSellerBatches) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
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
  deletedMatches: MatchedRow[];
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
  
  // Extract matched rows before deleting (for updating seller statements)
  const deletedMatches: MatchedRow[] = matchesSnapshot.docs.map(doc => doc.data().matchedRow);
  
  // Delete matches in batches if needed
  const DELETE_BATCH_SIZE = 450;
  const matchDocs = matchesSnapshot.docs;
  const totalMatchBatches = Math.ceil(matchDocs.length / DELETE_BATCH_SIZE);
  for (let i = 0; i < matchDocs.length; i += DELETE_BATCH_SIZE) {
    const chunk = matchDocs.slice(i, i + DELETE_BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((matchDoc) => {
      batch.delete(matchDoc.ref);
    });
    await batch.commit();
    
    // Add delay between batches to prevent write stream exhaustion (except for the last batch)
    const currentBatch = Math.floor(i / DELETE_BATCH_SIZE) + 1;
    if (currentBatch < totalMatchBatches) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
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
    deletedMatches, // Return deleted matches so client can update seller statements directly
    deletedSellerStatementsCount: 0, // Seller statements are updated by client, not deleted here
  };
}

/**
 * Save Master Data 2 to Firebase
 * Stores each record as its own document in the masterData2 collection
 * This avoids the 1MB per-document limit and allows for better querying
 */
export async function saveMasterData2(
  records: any[]
): Promise<void> {
  if (!records || records.length === 0) {
    console.warn('[saveMasterData2] No records to save');
    return;
  }
  
  const masterData2Collection = collection(db, 'masterData2');
  
  // Clean data for Firestore compatibility
  const cleanedRecords = cleanForFirestore(records);
  
  console.log(`[saveMasterData2] Preparing to save ${cleanedRecords.length} records as individual documents`);
  
  // Firestore batch limit is 500 operations, so we need to batch
  const BATCH_SIZE = 500;
  let savedCount = 0;
  
  try {
    // Delete all existing records first (to handle updates/replacements)
    // Get all existing documents
    const existingSnapshot = await getDocs(masterData2Collection);
    const existingDocs = existingSnapshot.docs;
    
    // Delete in batches with delays to avoid overwhelming Firestore
    for (let i = 0; i < existingDocs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = existingDocs.slice(i, i + BATCH_SIZE);
      
      chunk.forEach((docSnapshot) => {
        batch.delete(docSnapshot.ref);
      });
      
      await batch.commit();
      console.log(`[saveMasterData2] Deleted ${chunk.length} existing records`);
      
      // Add delay between batches to avoid overwhelming Firestore
      if (i + BATCH_SIZE < existingDocs.length) {
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
      }
    }
    
    // Save new records in batches with delays
    for (let i = 0; i < cleanedRecords.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = cleanedRecords.slice(i, i + BATCH_SIZE);
      
      chunk.forEach((record) => {
        // Use record.id as document ID, or generate one if missing
        const docId = record.id || `record-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const recordRef = doc(masterData2Collection, docId);
        batch.set(recordRef, {
          ...record,
          updatedAt: Timestamp.now(),
        });
      });
      
      await batch.commit();
      savedCount += chunk.length;
      console.log(`[saveMasterData2] Saved batch: ${savedCount}/${cleanedRecords.length} records`);
      
      // Add delay between batches to avoid overwhelming Firestore (except for last batch)
      if (i + BATCH_SIZE < cleanedRecords.length) {
        await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay between batches
      }
    }
    
    console.log(`[saveMasterData2] Successfully saved ${savedCount} records to Firebase`);
  } catch (error: any) {
    console.error('[saveMasterData2] Error saving to Firestore:', error);
    console.error('[saveMasterData2] Error code:', error.code);
    console.error('[saveMasterData2] Error message:', error.message);
    console.error('[saveMasterData2] Saved so far:', savedCount, 'of', cleanedRecords.length);
    
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied. Please check Firestore security rules.');
    }
    
    // Re-throw with more context
    throw new Error(`Failed to save Master Data 2: ${error.message || error.code || 'Unknown error'}`);
  }
}

/**
 * Update a single master record in Master Data 2
 */
export async function updateMasterData2Record(
  recordId: string,
  updates: Partial<any>
): Promise<void> {
  const recordRef = doc(db, 'masterData2', recordId);
  const recordDoc = await getDoc(recordRef);
  
  if (!recordDoc.exists()) {
    throw new Error(`Record with id ${recordId} not found`);
  }
  
  const cleanedUpdates = cleanForFirestore([updates])[0];
  
  await setDoc(
    recordRef,
    {
      ...cleanedUpdates,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
}

/**
 * Delete a master record from Master Data 2
 */
export async function deleteMasterData2Record(
  recordId: string
): Promise<void> {
  const recordRef = doc(db, 'masterData2', recordId);
  await deleteDoc(recordRef);
}
