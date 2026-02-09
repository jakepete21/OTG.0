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
import { ref, uploadBytes, getDownloadURL, deleteObject, getBytes } from 'firebase/storage';
import { db, storage } from './firebaseClient';
import { generateSellerStatements } from './sellerStatements';
import { MatchedRow, CarrierStatementRow, MasterRecord } from '../types';
import { matchCarrierStatements } from './matchingService';
import { extractCarrierStatementData } from './carrierStatementProcessor';
import { getFileUrl, getCarrierStatements } from './firebaseQueries';
import { processCarrierStatement } from './carrierStatementPipeline';

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

  // Note: Seller statements are NOT deleted here anymore
  // They are updated incrementally by addItemsToSellerStatements() after matches are stored
  // This allows multiple carriers to coexist without conflicts

  return { statementId, isReplacement, fileUrl };
}

/**
 * Update the total commission amount (sum of commissionAmount from every line) on a carrier statement.
 * Used for Deposit Totals display.
 */
export async function updateCarrierStatementTotalCommissionAmount(
  statementId: string,
  totalCommissionAmount: number
): Promise<void> {
  const statementRef = doc(db, 'carrierStatements', statementId);
  await setDoc(statementRef, { totalCommissionAmount }, { merge: true });
}

/** Minimal shape for storing unmatched rows on carrier statement (for differences report) */
interface UnmatchedRowDoc {
  accountName: string;
  otgCompBillingItem: string;
  commissionAmount: number;
  state?: string;
  accountNumber?: string;
  provider?: string;
  invoiceTotal?: number;
}

/**
 * Update the list of unmatched line items (carrier rows not in comp key) on a carrier statement.
 * Used by the Differences report to show actual line items.
 */
export async function updateCarrierStatementUnmatchedRows(
  statementId: string,
  unmatchedRows: CarrierStatementRow[]
): Promise<void> {
  const docs: UnmatchedRowDoc[] = unmatchedRows.map((r) => ({
    accountName: r.accountName ?? '',
    otgCompBillingItem: r.otgCompBillingItem ?? '',
    commissionAmount: Number(r.commissionAmount) || 0,
    state: r.state,
    accountNumber: r.accountNumber,
    provider: r.provider,
    invoiceTotal: r.invoiceTotal != null ? Number(r.invoiceTotal) : undefined,
  }));
  const statementRef = doc(db, 'carrierStatements', statementId);
  await setDoc(statementRef, { unmatchedRows: docs }, { merge: true });
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
  
  // Deduplicate matches before storing
  // Create a map of matches by key (billingItem|accountName) to prevent duplicates
  const matchKeys = new Map<string, MatchedRow>();
  let duplicateCount = 0;
  
  matchedRowsBatch.forEach((matchedRow) => {
    const key = `${matchedRow.otgCompBillingItem}|${matchedRow.accountName}`;
    if (matchKeys.has(key)) {
      duplicateCount++;
      console.warn(`[storeMatches] Duplicate match detected: ${key} (BillingItem=${matchedRow.otgCompBillingItem}, Account=${matchedRow.accountName})`);
    } else {
      matchKeys.set(key, matchedRow);
    }
  });
  
  if (duplicateCount > 0) {
    console.warn(`[storeMatches] Found ${duplicateCount} duplicate matches in batch, deduplicating before storing`);
  }
  
  // Use deduplicated matches
  const deduplicatedMatches = Array.from(matchKeys.values());
  console.log(`[storeMatches] Storing ${deduplicatedMatches.length} unique matches (${matchedRowsBatch.length} total, ${duplicateCount} duplicates removed)`);
  
  // Firestore batch limit: 500 operations per batch
  // Use 450 to leave some headroom for safety
  const BATCH_SIZE = 450;
  const CONCURRENT_BATCHES = 5; // Process up to 5 batches in parallel
  const totalBatches = Math.ceil(deduplicatedMatches.length / BATCH_SIZE);

  // Prepare all batches upfront
  const batchPromises: Array<{ batch: ReturnType<typeof writeBatch>, chunk: MatchedRow[], batchNumber: number }> = [];
  
  for (let i = 0; i < deduplicatedMatches.length; i += BATCH_SIZE) {
    const chunk = deduplicatedMatches.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

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

    batchPromises.push({ batch, chunk, batchNumber });
  }

  // Process batches in parallel with concurrency limit
  let completedBatches = 0;
  const processBatch = async (batchData: typeof batchPromises[0]) => {
    try {
      await batchData.batch.commit();
      completedBatches++;
      
      // Report progress
      if (onProgress) {
        onProgress(completedBatches, totalBatches);
      }
      
      // Log progress for large batches
      if (deduplicatedMatches.length > BATCH_SIZE) {
        console.log(`[storeMatches] Stored batch ${batchData.batchNumber}/${totalBatches} (${batchData.chunk.length} matches)`);
      }
    } catch (error) {
      console.error(`[storeMatches] Error storing batch ${batchData.batchNumber}:`, error);
      throw error;
    }
  };

  // Process batches with concurrency limit
  for (let i = 0; i < batchPromises.length; i += CONCURRENT_BATCHES) {
    const batchChunk = batchPromises.slice(i, i + CONCURRENT_BATCHES);
    await Promise.all(batchChunk.map(processBatch));
  }

  return { success: true, count: deduplicatedMatches.length };
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
 * Add new matched rows to existing seller statements incrementally
 * Much more efficient than regenerating everything - just adds new items and aggregates amounts
 */
// Track function calls to detect if it's being called multiple times
const addItemsCallTracker = new Map<string, number>();

export async function addItemsToSellerStatements(
  processingMonth: string,
  newMatches: MatchedRow[]
): Promise<{ success: boolean; updatedGroups: number; addedItemsCount: number }> {
  if (newMatches.length === 0) {
    return { success: true, updatedGroups: 0, addedItemsCount: 0 };
  }

  // Track function calls
  const callKey = `${processingMonth}-${Date.now()}`;
  const callCount = (addItemsCallTracker.get(processingMonth) || 0) + 1;
  addItemsCallTracker.set(processingMonth, callCount);
  
  console.log(`\n========== [addItemsToSellerStatements] CALL #${callCount} for ${processingMonth} ==========`);
  console.log(`[addItemsToSellerStatements] Stack trace:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));
  console.log(`[addItemsToSellerStatements] Adding ${newMatches.length} new matches to seller statements for ${processingMonth}`);

  console.log(`========== END [addItemsToSellerStatements] CALL #${callCount} ==========\n`);

  // Generate seller statements from new matches
  const newSellerStatements = generateSellerStatements(newMatches);
  console.log(`[addItemsToSellerStatements] Generated ${newSellerStatements.length} seller statement groups from new matches`);

  // Get existing seller statements for this processing month
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const sellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth)
  );
  const sellerSnapshot = await getDocs(sellerQuery);

  // Create a map of existing seller statements by role group
  // Also check for documents with deterministic IDs (new format) and random IDs (old format)
  const existingStatementsMap = new Map<string, { docId: string; data: any }>();
  const duplicateDocuments: Array<{ roleGroup: string; docIds: string[] }> = [];
  
  sellerSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const roleGroup = data.roleGroup;
    if (roleGroup) {
      // Check if this document uses deterministic ID format
      const expectedDeterministicId = `${processingMonth}_${roleGroup.replace(/\//g, '_')}`;
      if (doc.id === expectedDeterministicId) {
        // Document uses deterministic ID - this is the correct format
        if (existingStatementsMap.has(roleGroup)) {
          // Duplicate detected!
          const existing = existingStatementsMap.get(roleGroup)!;
          duplicateDocuments.push({
            roleGroup,
            docIds: [existing.docId, doc.id],
          });
          console.error(`[addItemsToSellerStatements] ⚠️ DUPLICATE DETECTED: Multiple documents exist for ${roleGroup} in ${processingMonth}`);
          console.error(`[addItemsToSellerStatements]   Document 1: ${existing.docId}`);
          console.error(`[addItemsToSellerStatements]   Document 2: ${doc.id} (deterministic ID)`);
          // Keep the deterministic ID version
          existingStatementsMap.set(roleGroup, { docId: doc.id, data });
        } else {
          existingStatementsMap.set(roleGroup, { docId: doc.id, data });
        }
      } else {
        // Document uses random ID (old format) - still include it but log warning
        if (!existingStatementsMap.has(roleGroup)) {
          existingStatementsMap.set(roleGroup, { docId: doc.id, data });
          console.warn(`[addItemsToSellerStatements] Found seller statement with random ID (old format): ${doc.id} for ${roleGroup}. Consider migrating to deterministic ID: ${expectedDeterministicId}`);
        } else {
          // Multiple documents for same roleGroup - this is a duplicate!
          const existing = existingStatementsMap.get(roleGroup)!;
          duplicateDocuments.push({
            roleGroup,
            docIds: [existing.docId, doc.id],
          });
          console.error(`[addItemsToSellerStatements] ⚠️ DUPLICATE DETECTED: Multiple documents exist for ${roleGroup} in ${processingMonth}`);
          console.error(`[addItemsToSellerStatements]   Existing: ${existing.docId}`);
          console.error(`[addItemsToSellerStatements]   Duplicate: ${doc.id}`);
          // Keep the one with deterministic ID if available, otherwise keep existing
          const expectedDeterministicId = `${processingMonth}_${roleGroup.replace(/\//g, '_')}`;
          if (doc.id === expectedDeterministicId) {
            existingStatementsMap.set(roleGroup, { docId: doc.id, data });
          }
        }
      }
    }
  });

  // Log summary of duplicates found
  if (duplicateDocuments.length > 0) {
    console.error(`[addItemsToSellerStatements] ⚠️ WARNING: Found ${duplicateDocuments.length} duplicate role group(s):`);
    duplicateDocuments.forEach((dup) => {
      console.error(`[addItemsToSellerStatements]   - ${dup.roleGroup}: ${dup.docIds.join(', ')}`);
    });
    console.error(`[addItemsToSellerStatements] Run cleanupDuplicateSellerStatements.ts script to fix duplicates`);
  }

  const batch = writeBatch(db);
  let updatedGroups = 0;
  let addedItemsCount = 0;
  const processedAt = Timestamp.now();

  // Process each new seller statement group
  for (const newStmt of newSellerStatements) {
    const existing = existingStatementsMap.get(newStmt.roleGroup);

    if (!existing) {
      // No existing statement for this role group - create new document
      // Use deterministic ID based on processingMonth + roleGroup to prevent duplicates
      // Replace "/" in roleGroup with "_" for valid document ID
      const deterministicId = `${processingMonth}_${newStmt.roleGroup.replace(/\//g, '_')}`;
      const newDocRef = doc(sellerStatementsRef, deterministicId);
      const cleanedStmt = removeUndefinedValues({
        processingMonth,
        roleGroup: newStmt.roleGroup,
        items: newStmt.items,
        totalOtgComp: newStmt.totalOtgComp,
        totalSellerComp: newStmt.totalSellerComp,
        processedAt,
      });
      // Use setDoc with merge: false to ensure we don't accidentally merge with existing data
      batch.set(newDocRef, cleanedStmt);
      addedItemsCount += newStmt.items.length;
      updatedGroups++;
      console.log(`[addItemsToSellerStatements] Created new seller statement group: ${newStmt.roleGroup} with ${newStmt.items.length} items (ID: ${deterministicId})`);
    } else {
      // Merge with existing statement
      const existingItems: any[] = existing.data.items || [];
      
      // Create a map of existing items by key (billingItem|accountName)
      const existingItemsMap = new Map<string, any>();
      existingItems.forEach((item: any) => {
        const key = `${item.otgCompBillingItem}|${item.accountName}`;
        existingItemsMap.set(key, item);
      });

      // Merge new items with existing items
      const mergedItems: any[] = [...existingItems];
      
      newStmt.items.forEach((newItem: any) => {
        const key = `${newItem.otgCompBillingItem}|${newItem.accountName}`;
        const existingItem = existingItemsMap.get(key);
        
        if (existingItem) {
          // Item already exists - aggregate amounts
          const existingIndex = mergedItems.findIndex(
            (item: any) => 
              item.otgCompBillingItem === newItem.otgCompBillingItem &&
              item.accountName === newItem.accountName
          );
          
          if (existingIndex >= 0) {
            mergedItems[existingIndex] = {
              ...mergedItems[existingIndex],
              otgComp: (mergedItems[existingIndex].otgComp || 0) + (newItem.otgComp || 0),
              sellerComp: (mergedItems[existingIndex].sellerComp || 0) + (newItem.sellerComp || 0),
            };
          }
        } else {
          // New item - add it
          mergedItems.push(newItem);
          addedItemsCount++;
        }
      });

      // Recalculate totals
      const totalOtgComp = mergedItems.reduce((sum, item) => sum + (item.otgComp || 0), 0);
      const totalSellerComp = mergedItems.reduce((sum, item) => sum + (item.sellerComp || 0), 0);

      // Sort merged items (same sorting logic as generateSellerStatements)
      mergedItems.sort((a, b) => {
        const pa = (a.provider || '').toLowerCase();
        const pb = (b.provider || '').toLowerCase();
        if (pa !== pb) return pa < pb ? -1 : 1;
        
        const aa = (a.accountName || '').toLowerCase();
        const ab = (b.accountName || '').toLowerCase();
        if (aa !== ab) return aa < ab ? -1 : 1;
        
        const sa = (a.otgCompBillingItem || '').toLowerCase();
        const sb = (b.otgCompBillingItem || '').toLowerCase();
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });

      // Update the document
      const existingDocRef = doc(sellerStatementsRef, existing.docId);
      const cleanedUpdate = removeUndefinedValues({
        items: mergedItems,
        totalOtgComp,
        totalSellerComp,
        processedAt,
      });
      batch.update(existingDocRef, cleanedUpdate);
      updatedGroups++;
      console.log(`[addItemsToSellerStatements] Updated seller statement group: ${newStmt.roleGroup} - added ${newStmt.items.length} items, total items now: ${mergedItems.length}`);
    }
  }

  await batch.commit();

  console.log(`[addItemsToSellerStatements] Added ${addedItemsCount} items to ${updatedGroups} seller statement groups`);

  return {
    success: true,
    updatedGroups,
    addedItemsCount,
  };
}

/**
 * Regenerate seller statements by re-running matching from carrier statements
 * Deletes existing matches, re-extracts carrier statement data, re-matches against master data,
 * stores new matches, and regenerates seller statements
 */
export async function regenerateSellerStatements(
  processingMonth: string,
  masterData?: MasterRecord[]
): Promise<{ success: boolean; matchedRowsCount: number; sellerStatementGroups: number }> {
  console.log(`[regenerateSellerStatements] Starting full regeneration for ${processingMonth}`);
  console.log(`[regenerateSellerStatements] masterData parameter:`, masterData ? `provided (${Array.isArray(masterData) ? masterData.length : 'not array'} items)` : 'not provided');
  
  // If masterData not provided, fetch it from Firebase
  let masterDataToUse: MasterRecord[];
  
  if (masterData && Array.isArray(masterData) && masterData.length > 0) {
    // Use provided masterData
    masterDataToUse = masterData;
    console.log(`[regenerateSellerStatements] Using provided master data: ${masterDataToUse.length} records`);
  } else {
    // Fetch from Firebase
    console.log(`[regenerateSellerStatements] Master data not provided or empty, fetching from Firebase...`);
    try {
      const { getMasterData2 } = await import('./firebaseQueries');
      const fetchedData = await getMasterData2();
      console.log(`[regenerateSellerStatements] getMasterData2 returned:`, fetchedData ? (Array.isArray(fetchedData) ? `${fetchedData.length} items` : 'not an array') : 'null/undefined');
      
      if (!fetchedData || !Array.isArray(fetchedData)) {
        throw new Error(`Failed to fetch master data from Firebase: Invalid response (${fetchedData === null ? 'null' : fetchedData === undefined ? 'undefined' : typeof fetchedData})`);
      }
      masterDataToUse = fetchedData;
      console.log(`[regenerateSellerStatements] Fetched ${masterDataToUse.length} master data records from Firebase`);
    } catch (error: any) {
      console.error(`[regenerateSellerStatements] Error fetching master data from Firebase:`, error);
      throw new Error(`Failed to fetch master data from Firebase: ${error.message}. Please ensure Comp Key is loaded.`);
    }
  }
  
  // Final validation
  if (!masterDataToUse || !Array.isArray(masterDataToUse) || masterDataToUse.length === 0) {
    console.error(`[regenerateSellerStatements] Validation failed:`, {
      masterDataToUse: masterDataToUse ? (Array.isArray(masterDataToUse) ? `${masterDataToUse.length} items` : `not an array (${typeof masterDataToUse})`) : 'null/undefined'
    });
    throw new Error('Master data is required for regeneration. Please ensure Comp Key is loaded in Firebase.');
  }
  
  console.log(`[regenerateSellerStatements] Using ${masterDataToUse.length} master data records`);

  // Step 1: Delete all existing matches for this processing month
  const matchesRef = collection(db, 'matches');
  const matchesQuery = query(
    matchesRef,
    where('processingMonth', '==', processingMonth)
  );
  const matchesSnapshot = await getDocs(matchesQuery);
  
  const existingMatchesCount = matchesSnapshot.docs.length;
  console.log(`[regenerateSellerStatements] Deleting ${existingMatchesCount} existing matches`);
  
  // Delete matches in batches
  const DELETE_BATCH_SIZE = 450;
  const matchDocs = matchesSnapshot.docs;
  const totalMatchBatches = Math.ceil(matchDocs.length / DELETE_BATCH_SIZE);
  for (let i = 0; i < matchDocs.length; i += DELETE_BATCH_SIZE) {
    const chunk = matchDocs.slice(i, i + DELETE_BATCH_SIZE);
    const deleteBatch = writeBatch(db);
    chunk.forEach((matchDoc) => {
      deleteBatch.delete(matchDoc.ref);
    });
    await deleteBatch.commit();
    const currentBatch = Math.floor(i / DELETE_BATCH_SIZE) + 1;
    console.log(`[regenerateSellerStatements] Deleted ${chunk.length} matches (batch ${currentBatch}/${totalMatchBatches})`);
    
    if (currentBatch < totalMatchBatches) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Step 2: Get all carrier statements for this processing month
  // First, get ALL carrier statements to debug any processing month mismatches
  const allCarrierStatements = await getCarrierStatements();
  console.log(`[regenerateSellerStatements] Total carrier statements in database: ${allCarrierStatements.length}`);
  console.log(`[regenerateSellerStatements] All carrier statements:`, allCarrierStatements.map(s => ({
    id: s.id,
    carrier: s.carrier,
    filename: s.filename,
    processingMonth: s.processingMonth,
    statementMonth: s.statementMonth
  })));
  
  // Filter by processing month
  const carrierStatements = allCarrierStatements.filter(s => s.processingMonth === processingMonth);
  console.log(`[regenerateSellerStatements] Found ${carrierStatements.length} carrier statement(s) for processing month ${processingMonth}`);
  console.log(`[regenerateSellerStatements] Carrier statements for ${processingMonth}:`, carrierStatements.map(s => ({
    id: s.id,
    carrier: s.carrier,
    filename: s.filename,
    processingMonth: s.processingMonth
  })));
  
  // Check if there are carrier statements with different processing months that might be relevant
  const otherMonthStatements = allCarrierStatements.filter(s => s.processingMonth !== processingMonth);
  if (otherMonthStatements.length > 0) {
    console.warn(`[regenerateSellerStatements] ⚠️ Found ${otherMonthStatements.length} carrier statement(s) with different processing months:`, 
      otherMonthStatements.map(s => ({
        id: s.id,
        carrier: s.carrier,
        filename: s.filename,
        processingMonth: s.processingMonth,
        statementMonth: s.statementMonth
      }))
    );
  }

  if (carrierStatements.length === 0) {
    // No carrier statements - clear seller statements and return
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

  // Step 3: Re-process each carrier statement
  const allMatchedRows: MatchedRow[] = [];
  const processedCarriers: string[] = [];
  const failedCarriers: Array<{ carrier: string; filename: string; error: string }> = [];
  
  console.log(`[regenerateSellerStatements] Starting to re-process ${carrierStatements.length} carrier statement(s)`);
  
  for (const carrierStatement of carrierStatements) {
    console.log(`[regenerateSellerStatements] Re-processing carrier statement: ${carrierStatement.filename} (${carrierStatement.carrier})`);
    console.log(`[regenerateSellerStatements] Statement ID: ${carrierStatement.id}, Processing Month: ${carrierStatement.processingMonth}`);
    
    try {
      // Download file from Firebase Storage
      // Try using getBytes() first (requires CORS configuration)
      // getBytes() returns ArrayBuffer; use it directly for Blob/File (ArrayBuffer is valid BlobPart)
      let fileBytes: ArrayBuffer;
      
      try {
        // Reconstruct storage path: carrier-statements/{processingMonth}/{carrier}/{filename}
        const storagePath = `carrier-statements/${processingMonth}/${carrierStatement.carrier}/${carrierStatement.filename}`;
        console.log(`[regenerateSellerStatements] Attempting to download file from storage path: ${storagePath}`);
        const storageRef = ref(storage, storagePath);
        fileBytes = await getBytes(storageRef);
        console.log(`[regenerateSellerStatements] Successfully downloaded ${fileBytes.byteLength} bytes for ${carrierStatement.carrier}`);
      } catch (corsError: any) {
        // If getBytes() fails due to CORS, provide helpful error message
        const errorMessage = corsError.message || String(corsError);
        if (errorMessage.includes('CORS') || errorMessage.includes('Access-Control-Allow-Origin')) {
          console.error(`[regenerateSellerStatements] CORS error: Firebase Storage CORS is not configured.`);
          console.error(`[regenerateSellerStatements] To fix this, run: ./scripts/configure-storage-cors.sh`);
          console.error(`[regenerateSellerStatements] Or configure CORS manually using gsutil: gsutil cors set firestore/storage.cors.json gs://otg0-109bd.firebasestorage.app`);
          throw new Error(
            `CORS configuration required: Firebase Storage CORS is not configured for your browser origin. ` +
            `Please run: ./scripts/configure-storage-cors.sh ` +
            `See firestore/storage.cors.json for configuration details.`
          );
        }
        throw corsError;
      }
      
      // Convert ArrayBuffer to File object (ArrayBuffer is valid BlobPart)
      const blob = new Blob([fileBytes]);
      const file = new File([blob], carrierStatement.filename, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      
      // Re-extract and re-match
      console.log(`[regenerateSellerStatements] Processing file ${carrierStatement.filename} with master data (${masterDataToUse.length} records)`);
      const result = await processCarrierStatement(file, masterDataToUse);
      
      console.log(`[regenerateSellerStatements] Re-matched ${result.matchedRows.length} rows for ${carrierStatement.carrier}`);
      
      
      // Store new matches
      console.log(`[regenerateSellerStatements] Storing ${result.matchedRows.length} matches for ${carrierStatement.carrier}`);
      await storeMatches(processingMonth, carrierStatement.id, result.matchedRows);

      // Update carrier statement with total commission from every line (for Deposit Totals)
      // Use raw total when available (Zayo: sum of Commission Amount (USD) for every row), else sum extracted rows
      const totalCommissionAmount = result.rawTotalCommissionAmount ?? result.carrierStatementRows.reduce(
        (sum, r) => sum + (Number(r.commissionAmount) || 0),
        0
      );
      await updateCarrierStatementTotalCommissionAmount(carrierStatement.id, totalCommissionAmount);
      await updateCarrierStatementUnmatchedRows(carrierStatement.id, result.unmatchedRows ?? []);
      
      allMatchedRows.push(...result.matchedRows);
      processedCarriers.push(carrierStatement.carrier);
      console.log(`[regenerateSellerStatements] ✅ Successfully processed ${carrierStatement.carrier}`);
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error(`[regenerateSellerStatements] ❌ Error re-processing ${carrierStatement.filename} (${carrierStatement.carrier}):`, error);
      console.error(`[regenerateSellerStatements] Error details:`, {
        carrier: carrierStatement.carrier,
        filename: carrierStatement.filename,
        statementId: carrierStatement.id,
        processingMonth: carrierStatement.processingMonth,
        error: errorMessage,
        stack: error?.stack
      });
      failedCarriers.push({
        carrier: carrierStatement.carrier,
        filename: carrierStatement.filename,
        error: errorMessage
      });
      // Continue with other carrier statements
    }
  }
  
  console.log(`[regenerateSellerStatements] Processing summary:`);
  console.log(`[regenerateSellerStatements] - Successfully processed carriers: ${processedCarriers.join(', ') || 'none'}`);
  console.log(`[regenerateSellerStatements] - Failed carriers: ${failedCarriers.map(f => `${f.carrier} (${f.filename})`).join(', ') || 'none'}`);
  console.log(`[regenerateSellerStatements] - Total matched rows: ${allMatchedRows.length}`);

  console.log(`[regenerateSellerStatements] Total matched rows after re-matching: ${allMatchedRows.length}`);
  
  if (failedCarriers.length > 0) {
    console.warn(`[regenerateSellerStatements] ⚠️ WARNING: ${failedCarriers.length} carrier statement(s) failed to process:`);
    failedCarriers.forEach(f => {
      console.warn(`[regenerateSellerStatements]   - ${f.carrier}: ${f.filename} - ${f.error}`);
    });
    console.warn(`[regenerateSellerStatements] These carriers will NOT be included in the regenerated seller statements.`);
  }
  
  if (allMatchedRows.length === 0 && carrierStatements.length > 0) {
    console.warn(`[regenerateSellerStatements] ⚠️ WARNING: No matched rows generated despite ${carrierStatements.length} carrier statement(s) found.`);
    console.warn(`[regenerateSellerStatements] This might indicate a problem with matching logic or master data.`);
  }


  // Step 4: Generate seller statements from all re-matched rows
  // Step 4: Generate seller statements from all re-matched rows
  const sellerStatements = generateSellerStatements(allMatchedRows);

  // Delete existing seller statements in batches (Firestore limit: 500 operations per batch)
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const sellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth)
  );
  const sellerSnapshot = await getDocs(sellerQuery);
  
  // Delete in batches if needed (reuse DELETE_BATCH_SIZE from above)
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
    // Use deterministic ID based on processingMonth + roleGroup to prevent duplicates
    // Replace "/" in roleGroup with "_" for valid document ID
    const deterministicId = `${processingMonth}_${stmt.roleGroup.replace(/\//g, '_')}`;
    const sellerDocRef = doc(sellerStatementsRef, deterministicId);
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
    matchedRowsCount: allMatchedRows.length,
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

/**
 * Fix processing month on a carrier statement
 * Useful when a carrier statement was uploaded with incorrect processing month
 */
export async function fixCarrierStatementProcessingMonth(
  statementId: string,
  correctProcessingMonth: string
): Promise<void> {
  const statementRef = doc(db, 'carrierStatements', statementId);
  const statementDoc = await getDoc(statementRef);
  
  if (!statementDoc.exists()) {
    throw new Error(`Carrier statement with id ${statementId} not found`);
  }
  
  const currentData = statementDoc.data();
  const currentProcessingMonth = currentData.processingMonth;
  
  if (currentProcessingMonth === correctProcessingMonth) {
    console.log(`[fixCarrierStatementProcessingMonth] Statement ${statementId} already has correct processingMonth: ${correctProcessingMonth}`);
    return;
  }
  
  console.log(`[fixCarrierStatementProcessingMonth] Updating statement ${statementId}:`);
  console.log(`  Current processingMonth: ${currentProcessingMonth}`);
  console.log(`  New processingMonth: ${correctProcessingMonth}`);
  
  // Update the carrier statement
  await setDoc(
    statementRef,
    {
      processingMonth: correctProcessingMonth,
    },
    { merge: true }
  );
  
  // Update all matches for this statement to have the correct processing month
  const matchesRef = collection(db, 'matches');
  const matchesQuery = query(
    matchesRef,
    where('carrierStatementId', '==', statementId)
  );
  const matchesSnapshot = await getDocs(matchesQuery);
  
  if (matchesSnapshot.docs.length > 0) {
    console.log(`[fixCarrierStatementProcessingMonth] Updating ${matchesSnapshot.docs.length} matches to have processingMonth: ${correctProcessingMonth}`);
    
    const UPDATE_BATCH_SIZE = 450;
    const matchDocs = matchesSnapshot.docs;
    const totalBatches = Math.ceil(matchDocs.length / UPDATE_BATCH_SIZE);
    
    for (let i = 0; i < matchDocs.length; i += UPDATE_BATCH_SIZE) {
      const chunk = matchDocs.slice(i, i + UPDATE_BATCH_SIZE);
      const batch = writeBatch(db);
      
      chunk.forEach((matchDoc) => {
        batch.update(matchDoc.ref, {
          processingMonth: correctProcessingMonth,
        });
      });
      
      await batch.commit();
      const currentBatch = Math.floor(i / UPDATE_BATCH_SIZE) + 1;
      console.log(`[fixCarrierStatementProcessingMonth] Updated ${chunk.length} matches (batch ${currentBatch}/${totalBatches})`);
      
      if (currentBatch < totalBatches) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  }
  
  console.log(`[fixCarrierStatementProcessingMonth] ✅ Successfully updated statement ${statementId} and ${matchesSnapshot.docs.length} matches`);
}
