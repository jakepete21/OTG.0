/**
 * Cleanup script to remove duplicate seller statement documents
 * Merges duplicate documents by keeping the one with deterministic ID (or first one if none)
 * and properly merging items by key to prevent double-counting
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, writeBatch, doc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '../.env.local');
    const envFile = readFileSync(envPath, 'utf-8');
    const envVars: Record<string, string> = {};
    envFile.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        envVars[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    });
    Object.assign(process.env, envVars);
  } catch (error) {
    console.warn('Could not load .env.local, using process.env');
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

async function cleanupDuplicateSellerStatements() {
  console.log('========== CLEANING UP DUPLICATE SELLER STATEMENTS ==========\n');

  // Use the processing month from command line or default to 2026-02
  const processingMonth = process.argv[2] || '2026-02';

  console.log(`Processing Month: ${processingMonth}\n`);

  // Get all seller statements for this processing month
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const sellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth)
  );
  const sellerSnapshot = await getDocs(sellerQuery);

  console.log(`Found ${sellerSnapshot.docs.length} total seller statement document(s) for ${processingMonth}\n`);

  // Group documents by roleGroup
  const roleGroupMap = new Map<string, Array<{ docId: string; data: any }>>();
  sellerSnapshot.docs.forEach((docSnapshot) => {
    const data = docSnapshot.data();
    const roleGroup = data.roleGroup;
    if (roleGroup) {
      if (!roleGroupMap.has(roleGroup)) {
        roleGroupMap.set(roleGroup, []);
      }
      roleGroupMap.get(roleGroup)!.push({ docId: docSnapshot.id, data });
    }
  });

  // Find duplicates and merge them
  const batch = writeBatch(db);
  let duplicatesRemoved = 0;
  let documentsUpdated = 0;

  roleGroupMap.forEach((docs, roleGroup) => {
    if (docs.length > 1) {
      console.log(`\n⚠️ Found ${docs.length} duplicate document(s) for roleGroup: ${roleGroup}`);
      
      // Find the document with deterministic ID (preferred) or use the first one
      const deterministicId = `${processingMonth}_${roleGroup.replace(/\//g, '_')}`;
      let keepDoc = docs.find(d => d.docId === deterministicId);
      if (!keepDoc) {
        keepDoc = docs[0];
        console.log(`   No deterministic ID found, keeping first document: ${keepDoc.docId}`);
      } else {
        console.log(`   Keeping document with deterministic ID: ${keepDoc.docId}`);
      }

      // Merge items from all duplicate documents
      const allItems: any[] = [];
      const itemKeys = new Map<string, any>();
      
      docs.forEach((docData) => {
        const items = docData.data.items || [];
        items.forEach((item: any) => {
          const key = `${item.otgCompBillingItem}|${item.accountName}`;
          const existingItem = itemKeys.get(key);
          
          if (existingItem) {
            // Item already exists - check if values match
            const otgMatch = Math.abs((existingItem.otgComp || 0) - (item.otgComp || 0)) < 0.01;
            const sellerMatch = Math.abs((existingItem.sellerComp || 0) - (item.sellerComp || 0)) < 0.01;
            
            if (!otgMatch || !sellerMatch) {
              console.log(`   ⚠️ Duplicate item "${key}" has different values:`);
              console.log(`      Existing: OTG=$${(existingItem.otgComp || 0).toFixed(2)}, Seller=$${(existingItem.sellerComp || 0).toFixed(2)}`);
              console.log(`      New: OTG=$${(item.otgComp || 0).toFixed(2)}, Seller=$${(item.sellerComp || 0).toFixed(2)}`);
              console.log(`      Using existing values to prevent double-counting`);
            }
            // Don't add duplicate item - keep existing one
          } else {
            // New item - add it
            itemKeys.set(key, item);
            allItems.push(item);
          }
        });
      });

      // Recalculate totals from merged items
      const totalOtgComp = allItems.reduce((sum, item) => sum + (item.otgComp || 0), 0);
      const totalSellerComp = allItems.reduce((sum, item) => sum + (item.sellerComp || 0), 0);

      console.log(`   Merged ${allItems.length} unique items (removed ${docs.reduce((sum, d) => sum + (d.data.items?.length || 0), 0) - allItems.length} duplicates)`);
      console.log(`   Total OTG Comp: $${totalOtgComp.toFixed(2)}`);
      console.log(`   Total Seller Comp: $${totalSellerComp.toFixed(2)}`);

      // Update the document to keep (use deterministic ID)
      const keepDocRef = doc(sellerStatementsRef, deterministicId);
      batch.set(keepDocRef, {
        processingMonth,
        roleGroup,
        items: allItems,
        totalOtgComp,
        totalSellerComp,
        processedAt: keepDoc.data.processedAt || new Date(),
      });
      documentsUpdated++;

      // Delete duplicate documents
      docs.forEach((docData) => {
        if (docData.docId !== keepDoc.docId) {
          const deleteDocRef = doc(sellerStatementsRef, docData.docId);
          batch.delete(deleteDocRef);
          duplicatesRemoved++;
          console.log(`   Deleting duplicate document: ${docData.docId}`);
        }
      });
    } else if (docs.length === 1) {
      // Single document - check if it needs to be migrated to deterministic ID
      const docData = docs[0];
      const deterministicId = `${processingMonth}_${roleGroup.replace(/\//g, '_')}`;
      
      if (docData.docId !== deterministicId) {
        console.log(`\n📝 Migrating ${roleGroup} to deterministic ID: ${deterministicId}`);
        
        // Create new document with deterministic ID
        const newDocRef = doc(sellerStatementsRef, deterministicId);
        batch.set(newDocRef, {
          ...docData.data,
          processingMonth,
          roleGroup,
        });
        
        // Delete old document
        const oldDocRef = doc(sellerStatementsRef, docData.docId);
        batch.delete(oldDocRef);
        
        documentsUpdated++;
        duplicatesRemoved++;
      }
    }
  });

  if (duplicatesRemoved > 0 || documentsUpdated > 0) {
    console.log(`\n========== COMMITTING CHANGES ==========`);
    console.log(`Documents updated: ${documentsUpdated}`);
    console.log(`Duplicate documents removed: ${duplicatesRemoved}`);
    await batch.commit();
    console.log(`✅ Cleanup completed successfully!\n`);
  } else {
    console.log(`✅ No duplicates found - all documents are clean!\n`);
  }

  console.log('========== CLEANUP COMPLETE ==========\n');
}

cleanupDuplicateSellerStatements()
  .then(() => {
    console.log('Cleanup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error during cleanup:', error);
    process.exit(1);
  });
