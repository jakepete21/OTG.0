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
  deleteCarrierStatement,
} from './firebaseMutations';
import type {
  CarrierStatementDoc,
  SellerStatementDoc,
} from './firebaseQueries';

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
 * Hook to delete a carrier statement
 */
export const useDeleteCarrierStatement = () => {
  return deleteCarrierStatement;
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
