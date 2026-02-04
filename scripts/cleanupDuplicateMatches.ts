/**
 * Cleanup script to remove duplicate matches from Firebase
 * Keeps the first match for each unique key (billingItem|accountName|carrierStatementId)
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
function loadEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    const envFile = readFileSync(envPath, 'utf-8');
    envFile.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          value = value.replace(/^["']|["']$/g, '');
          process.env[key] = value;
        }
      }
    });
  } catch (error: any) {
    console.warn(`Could not load .env.local: ${error.message}`);
  }
}

loadEnv();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanupDuplicateMatches() {
  console.log('========== CLEANING UP DUPLICATE MATCHES ==========\n');

  const processingMonth = process.argv[2] || '2026-02';
  console.log(`Processing Month: ${processingMonth}\n`);

  // Get all matches for this processing month
  const matchesRef = collection(db, 'matches');
  const matchesQuery = query(
    matchesRef,
    where('processingMonth', '==', processingMonth)
  );
  const matchesSnapshot = await getDocs(matchesQuery);

  console.log(`Found ${matchesSnapshot.docs.length} total match(es) for ${processingMonth}\n`);

  // Group matches by key (billingItem|accountName|carrierStatementId)
  const matchKeys = new Map<string, Array<{ docId: string; data: any }>>();
  
  matchesSnapshot.docs.forEach((docSnapshot) => {
    const data = docSnapshot.data();
    const matchedRow = data.matchedRow || {};
    const key = `${matchedRow.otgCompBillingItem}|${matchedRow.accountName}|${data.carrierStatementId}`;
    
    if (!matchKeys.has(key)) {
      matchKeys.set(key, []);
    }
    matchKeys.get(key)!.push({ docId: docSnapshot.id, data });
  });

  // Find duplicates
  const duplicates: Array<{ key: string; docs: Array<{ docId: string; data: any }> }> = [];
  matchKeys.forEach((docs, key) => {
    if (docs.length > 1) {
      duplicates.push({ key, docs });
    }
  });

  console.log(`Found ${duplicates.length} duplicate match key(s)\n`);

  if (duplicates.length === 0) {
    console.log('✅ No duplicates found - all matches are unique!\n');
    return;
  }

  // Show summary of duplicates
  const totalDuplicates = duplicates.reduce((sum, dup) => sum + (dup.docs.length - 1), 0);
  console.log(`Total duplicate documents to remove: ${totalDuplicates}\n`);

  // Show top 10 duplicates
  const topDuplicates = duplicates
    .sort((a, b) => b.docs.length - a.docs.length)
    .slice(0, 10);
  
  console.log('Top 10 duplicate matches:');
  topDuplicates.forEach((dup, idx) => {
    const matchedRow = dup.docs[0].data.matchedRow || {};
    console.log(`  ${idx + 1}. "${dup.key}" appears ${dup.docs.length} times`);
    console.log(`     BillingItem: ${matchedRow.otgCompBillingItem}, Account: ${matchedRow.accountName}`);
  });
  console.log('');

  // Count duplicates to remove (we'll process deletions in batches later)
  let duplicatesRemoved = 0;
  const BATCH_SIZE = 450; // Firestore batch limit

  for (const dup of duplicates) {
    // Count how many duplicates we'll remove (keep 1, delete rest)
    duplicatesRemoved += dup.docs.length - 1;
  }

  if (duplicatesRemoved > 0) {
    console.log(`\n========== COMMITTING CHANGES ==========`);
    console.log(`Duplicate matches to remove: ${duplicatesRemoved}`);
    
    // Commit in batches if needed
    if (duplicatesRemoved <= BATCH_SIZE) {
      await batch.commit();
      console.log(`✅ Removed ${duplicatesRemoved} duplicate matches\n`);
    } else {
      // Process in batches
      console.log(`Processing ${duplicatesRemoved} deletions in batches of ${BATCH_SIZE}...`);
      
      // Collect all delete operations
      const deleteOps: Array<{ docId: string }> = [];
      for (const dup of duplicates) {
        const keepDoc = dup.docs.sort((a, b) => {
          const aTime = a.data.createdAt?.toMillis?.() || a.data.createdAt || 0;
          const bTime = b.data.createdAt?.toMillis?.() || b.data.createdAt || 0;
          return aTime - bTime;
        })[0];
        
        dup.docs.forEach((docData) => {
          if (docData.docId !== keepDoc.docId) {
            deleteOps.push({ docId: docData.docId });
          }
        });
      }
      
      // Delete in batches
      let deletedCount = 0;
      for (let i = 0; i < deleteOps.length; i += BATCH_SIZE) {
        const chunk = deleteOps.slice(i, i + BATCH_SIZE);
        const deleteBatch = writeBatch(db);
        
        chunk.forEach((op) => {
          const deleteDocRef = doc(matchesRef, op.docId);
          deleteBatch.delete(deleteDocRef);
        });
        
        await deleteBatch.commit();
        deletedCount += chunk.length;
        console.log(`  Deleted batch: ${deletedCount}/${deleteOps.length} (${chunk.length} matches)`);
        
        // Add delay between batches to prevent write stream exhaustion
        if (i + BATCH_SIZE < deleteOps.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      console.log(`✅ Removed ${deletedCount} duplicate matches\n`);
    }
  } else {
    console.log('✅ No duplicates to remove\n');
  }

  console.log('========== CLEANUP COMPLETE ==========\n');
  console.log('⚠️ IMPORTANT: After removing duplicate matches, you should regenerate seller statements:');
  console.log('   - Go to Commissions tab');
  console.log('   - Click "Regenerate Seller Statements" for the affected month');
  console.log('   - This will recalculate seller statements from the deduplicated matches\n');
}

cleanupDuplicateMatches()
  .then(() => {
    console.log('Cleanup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error during cleanup:', error);
    process.exit(1);
  });
