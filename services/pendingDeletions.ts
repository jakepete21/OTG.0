/**
 * Shared state for tracking carrier statements that are pending deletion
 * This allows optimistic UI updates - components can immediately treat
 * pending deletions as if they don't exist, even before Firebase deletion completes
 */

// Track statement IDs that are currently being deleted
const pendingDeletions = new Set<string>();

// Track carrier/month combinations for pending deletions (for duplicate checking)
// Key format: "carrier|processingMonth"
const pendingDeletionKeys = new Map<string, string>(); // key -> statementId

// Track when deletions were initiated (for cleanup of stale entries)
const deletionTimestamps = new Map<string, number>();

// Maximum age for pending deletion entries (5 minutes)
const MAX_PENDING_AGE_MS = 5 * 60 * 1000;

/**
 * Mark a statement as pending deletion
 */
export function markAsPendingDeletion(
  statementId: string,
  carrier: string,
  processingMonth: string
): void {
  pendingDeletions.add(statementId);
  const key = `${carrier}|${processingMonth}`;
  pendingDeletionKeys.set(key, statementId);
  deletionTimestamps.set(statementId, Date.now());
  console.log(`[pendingDeletions] Marked ${statementId} (${carrier} - ${processingMonth}) as pending deletion`);
}

/**
 * Remove a statement from pending deletions (deletion completed or cancelled)
 */
export function removePendingDeletion(statementId: string): void {
  pendingDeletions.delete(statementId);
  deletionTimestamps.delete(statementId);
  
  // Remove from key map
  for (const [key, id] of pendingDeletionKeys.entries()) {
    if (id === statementId) {
      pendingDeletionKeys.delete(key);
      break;
    }
  }
  
  console.log(`[pendingDeletions] Removed ${statementId} from pending deletions`);
}

/**
 * Check if a statement is pending deletion
 */
export function isPendingDeletion(statementId: string): boolean {
  // Clean up stale entries first
  cleanupStaleEntries();
  
  return pendingDeletions.has(statementId);
}

/**
 * Check if any statement for a carrier/month combination is pending deletion
 * Returns true if there's a pending deletion for this carrier/month
 */
export function isPendingDeletionForCarrierMonth(
  carrier: string,
  processingMonth: string
): boolean {
  cleanupStaleEntries();
  
  const key = `${carrier}|${processingMonth}`;
  return pendingDeletionKeys.has(key);
}

/**
 * Clean up stale pending deletion entries
 */
function cleanupStaleEntries(): void {
  const now = Date.now();
  const toRemove: string[] = [];
  
  deletionTimestamps.forEach((timestamp, statementId) => {
    if (now - timestamp > MAX_PENDING_AGE_MS) {
      toRemove.push(statementId);
    }
  });
  
  toRemove.forEach(statementId => {
    pendingDeletions.delete(statementId);
    deletionTimestamps.delete(statementId);
    
    // Remove from key map
    for (const [key, id] of pendingDeletionKeys.entries()) {
      if (id === statementId) {
        pendingDeletionKeys.delete(key);
        break;
      }
    }
    
    console.log(`[pendingDeletions] Cleaned up stale entry: ${statementId}`);
  });
}

/**
 * Get all pending deletion statement IDs
 */
export function getAllPendingDeletions(): string[] {
  cleanupStaleEntries();
  return Array.from(pendingDeletions);
}

/**
 * Check if a statement ID is pending deletion
 * Useful for checking if an upload is replacing a pending deletion
 */
export function getPendingDeletionStatementId(
  carrier: string,
  processingMonth: string
): string | null {
  cleanupStaleEntries();
  
  const key = `${carrier}|${processingMonth}`;
  return pendingDeletionKeys.get(key) || null;
}

/**
 * Clear all pending deletions (useful for testing or reset)
 */
export function clearAllPendingDeletions(): void {
  pendingDeletions.clear();
  pendingDeletionKeys.clear();
  deletionTimestamps.clear();
}
