/**
 * Firebase Hooks for Statement Storage
 * Provides React hooks for accessing Firebase data with real-time updates
 */

import { useState, useEffect, useMemo } from 'react';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebaseClient';
import { CarrierType } from './monthDetection';
import {
  uploadCarrierStatement,
  storeMatches,
  regenerateSellerStatements,
  addItemsToSellerStatements,
  deleteCarrierStatement,
  removeItemsFromSellerStatements,
  saveMasterData2,
  updateMasterData2Record,
  deleteMasterData2Record,
  fixCarrierStatementProcessingMonth,
} from './firebaseMutations';
import type {
  CarrierStatementDoc,
  SellerStatementDoc,
  MatchDoc,
} from './firebaseQueries';
import { getMasterData2 } from './firebaseQueries';

/**
 * Hook to get all carrier statements with real-time updates
 */
export const useAllCarrierStatements = (): CarrierStatementDoc[] => {
  const [statements, setStatements] = useState<CarrierStatementDoc[]>([]);

  useEffect(() => {
    const statementsRef = collection(db, 'carrierStatements');
    const q = query(statementsRef, orderBy('uploadedAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as CarrierStatementDoc[];
        setStatements(docs);
      },
      (error) => {
        // Handle index building errors gracefully
        if (error.code === 'failed-precondition') {
          console.warn('[useAllCarrierStatements] Index is still building, data will appear when ready:', error.message);
        } else {
          console.error('[useAllCarrierStatements] Error fetching carrier statements:', error);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  return statements;
};

/**
 * Hook to get carrier statements for a processing month with real-time updates
 */
export const useCarrierStatements = (
  processingMonth: string | null
): CarrierStatementDoc[] => {
  const [statements, setStatements] = useState<CarrierStatementDoc[]>([]);

  useEffect(() => {
    if (!processingMonth) {
      setStatements([]);
      return;
    }

    const statementsRef = collection(db, 'carrierStatements');
    const q = query(
      statementsRef,
      where('processingMonth', '==', processingMonth),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as CarrierStatementDoc[];
        setStatements(docs);
      },
      (error) => {
        // Handle index building errors gracefully
        if (error.code === 'failed-precondition') {
          console.warn('[useCarrierStatements] Index is still building, data will appear when ready:', error.message);
        } else {
          console.error('[useCarrierStatements] Error fetching carrier statements:', error);
        }
      }
    );

    return () => unsubscribe();
  }, [processingMonth]);

  return statements;
};

/**
 * Get a single carrier statement by ID with real-time updates
 */
export const useCarrierStatementById = (
  statementId: string | null
): CarrierStatementDoc | null => {
  const [statement, setStatement] = useState<CarrierStatementDoc | null>(null);

  useEffect(() => {
    if (!statementId) {
      setStatement(null);
      return;
    }

    const statementRef = doc(db, 'carrierStatements', statementId);
    const unsubscribe = onSnapshot(statementRef, (docSnapshot) => {
      if (!docSnapshot.exists()) {
        setStatement(null);
        return;
      }

      setStatement({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      } as CarrierStatementDoc);
    });

    return () => unsubscribe();
  }, [statementId]);

  return statement;
};

/**
 * Hook to get seller statements for a processing month with real-time updates
 */
export const useSellerStatements = (
  processingMonth: string | null
): SellerStatementDoc[] => {
  const [statements, setStatements] = useState<SellerStatementDoc[]>([]);

  useEffect(() => {
    if (!processingMonth) {
      setStatements([]);
      return;
    }

    const sellerStatementsRef = collection(db, 'sellerStatements');
    const q = query(
      sellerStatementsRef,
      where('processingMonth', '==', processingMonth),
      orderBy('roleGroup', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as SellerStatementDoc[];
        setStatements(docs);
      },
      (error) => {
        // Handle index building errors gracefully
        if (error.code === 'failed-precondition') {
          console.warn('[useSellerStatements] Index is still building, data will appear when ready:', error.message);
          // Don't set error state - just log it, data will appear when index is ready
        } else {
          console.error('[useSellerStatements] Error fetching seller statements:', error);
        }
      }
    );

    return () => unsubscribe();
  }, [processingMonth]);

  return statements;
};

/**
 * Hook to get all matches for a processing month (for difference report: unmatched vs matched totals)
 */
export const useMatchesForProcessingMonth = (
  processingMonth: string | null
): MatchDoc[] => {
  const [matches, setMatches] = useState<MatchDoc[]>([]);

  useEffect(() => {
    if (!processingMonth) {
      setMatches([]);
      return;
    }

    const matchesRef = collection(db, 'matches');
    const q = query(
      matchesRef,
      where('processingMonth', '==', processingMonth)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as MatchDoc[];
        setMatches(docs);
      },
      (error) => {
        if (error.code === 'failed-precondition') {
          console.warn('[useMatchesForProcessingMonth] Index may be building:', error.message);
        } else {
          console.error('[useMatchesForProcessingMonth] Error:', error);
        }
      }
    );

    return () => unsubscribe();
  }, [processingMonth]);

  return matches;
};

/**
 * Hook to derive processing months from carrier statements
 * Groups statements by processingMonth and calculates status
 */
export const useProcessingMonths = () => {
  const allStatements = useAllCarrierStatements();

  return useMemo(() => {
    // Group by processing month
    const monthMap = new Map<
      string,
      {
        monthKey: string;
        monthLabel: string;
        carriers: Record<string, string>; // carrier -> statementId
        status: 'complete' | 'partial' | 'empty';
        lastProcessedAt?: number;
      }
    >();

    const allCarriers: CarrierType[] = [
      'GoTo',
      'Lumen',
      'MetTel',
      'TBO',
      'Zayo',
      'Allstream',
    ];
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    for (const stmt of allStatements) {
      const processingMonth = stmt.processingMonth;

      if (!monthMap.has(processingMonth)) {
        // Parse month key to create label
        const [year, month] = processingMonth.split('-').map(Number);
        const monthLabel = `${monthNames[month - 1]} ${year}`;

        monthMap.set(processingMonth, {
          monthKey: processingMonth,
          monthLabel,
          carriers: {},
          status: 'empty',
        });
      }

      const monthData = monthMap.get(processingMonth)!;
      monthData.carriers[stmt.carrier] = stmt.id;

      // Update last processed at
      const uploadedAt =
        stmt.uploadedAt instanceof Timestamp
          ? stmt.uploadedAt.toMillis()
          : stmt.uploadedAt instanceof Date
            ? stmt.uploadedAt.getTime()
            : 0;
      if (
        !monthData.lastProcessedAt ||
        uploadedAt > monthData.lastProcessedAt
      ) {
        monthData.lastProcessedAt = uploadedAt;
      }
    }

    // Calculate status for each month
    for (const monthData of monthMap.values()) {
      const uploadedCount = allCarriers.filter(
        (c) => monthData.carriers[c]
      ).length;
      monthData.status =
        uploadedCount === 0
          ? 'empty'
          : uploadedCount === 6
            ? 'complete'
            : 'partial';
    }

    // Convert to array and sort (newest first)
    return Array.from(monthMap.values()).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey)
    );
  }, [allStatements]);
};

/**
 * Hook to upload a carrier statement
 */
export const useUploadCarrierStatement = () => {
  return uploadCarrierStatement;
};

/**
 * Hook to store matches
 */
export const useStoreMatches = () => {
  return storeMatches;
};

/**
 * Hook to regenerate seller statements
 */
export const useRegenerateSellerStatements = () => {
  return regenerateSellerStatements;
};

/**
 * Hook to add items to seller statements incrementally (more efficient than regenerating)
 */
export const useAddItemsToSellerStatements = () => {
  return addItemsToSellerStatements;
};

/**
 * Hook to delete a carrier statement
 */
export const useDeleteCarrierStatement = () => {
  return deleteCarrierStatement;
};

/**
 * Hook to remove items from seller statements (faster than regenerating)
 */
export const useRemoveItemsFromSellerStatements = () => {
  return removeItemsFromSellerStatements;
};

/**
 * Hook to fix processing month on a carrier statement
 */
export const useFixCarrierStatementProcessingMonth = () => {
  return fixCarrierStatementProcessingMonth;
};

/**
 * Hook to get Master Data 2 with real-time updates
 * Listens to the entire masterData2 collection
 */
export const useMasterData2 = (): any[] => {
  const [records, setRecords] = useState<any[]>([]);

  useEffect(() => {
    const masterData2Collection = collection(db, 'masterData2');
    // Query without orderBy initially - index may not be built yet
    // If index is needed, Firestore will prompt to create it
    const q = query(masterData2Collection);
    
    let isMounted = true;
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!isMounted) return;
        
        try {
          const docs = snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data(),
          }));
          setRecords(docs);
        } catch (error: any) {
          console.error('[useMasterData2] Error processing snapshot:', error);
          if (isMounted) {
            setRecords([]);
          }
        }
      },
      (error) => {
        console.error('[useMasterData2] Error fetching master data 2:', error);
        // If collection doesn't exist or permission denied, that's OK - return empty array
        if (error.code === 'not-found' || error.code === 'permission-denied') {
          if (isMounted) {
            setRecords([]);
          }
        } else {
          // For other errors, try to continue with empty array
          console.warn('[useMasterData2] Continuing with empty array due to error');
          if (isMounted) {
            setRecords([]);
          }
        }
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return records;
};

/**
 * Hook to save Master Data 2
 */
export const useSaveMasterData2 = () => {
  return saveMasterData2;
};

/**
 * Hook to update a Master Data 2 record
 */
export const useUpdateMasterData2Record = () => {
  return updateMasterData2Record;
};

/**
 * Hook to delete a Master Data 2 record
 */
export const useDeleteMasterData2Record = () => {
  return deleteMasterData2Record;
};

/**
 * Helper to convert Firebase carrier statement to local format
 */
export const convertFirebaseStatement = (stmt: CarrierStatementDoc): any => {
  if (!stmt) return null;

  const uploadedAt =
    stmt.uploadedAt instanceof Timestamp
      ? stmt.uploadedAt.toDate()
      : stmt.uploadedAt instanceof Date
        ? stmt.uploadedAt
        : new Date();

  return {
    id: stmt.id,
    filename: stmt.filename,
    carrier: stmt.carrier,
    statementMonth: new Date(stmt.statementMonth + '-01'), // Convert "YYYY-MM" to Date
    processingMonth: new Date(stmt.processingMonth + '-01'),
    uploadedAt,
    fileUrl: stmt.fileUrl,
  };
};
