/**
 * Diagnostic script to investigate doubled Firebase values in Statement Compare
 * Checks for duplicate seller statements, duplicate matches, and double-counting issues
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { readFileSync } from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
function loadEnv() {
  try {
    // Use process.cwd() since __dirname isn't available in ES modules
    const envPath = path.join(process.cwd(), '.env.local');
    const envFile = readFileSync(envPath, 'utf-8');
    const envVars: Record<string, string> = {};
    envFile.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove quotes if present
          value = value.replace(/^["']|["']$/g, '');
          envVars[key] = value;
          process.env[key] = value;
        }
      }
    });
    console.log(`Loaded ${Object.keys(envVars).length} environment variables from .env.local`);
  } catch (error: any) {
    console.warn(`Could not load .env.local: ${error.message}`);
    console.warn('Using process.env (may be empty)');
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

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('ERROR: Firebase configuration is missing!');
  console.error('Required environment variables:');
  console.error('  VITE_FIREBASE_API_KEY:', process.env.VITE_FIREBASE_API_KEY ? '✓' : '✗');
  console.error('  VITE_FIREBASE_PROJECT_ID:', process.env.VITE_FIREBASE_PROJECT_ID ? '✓' : '✗');
  console.error('\nMake sure .env.local exists and contains these variables.');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function diagnoseDoubledValues() {
  console.log('========== DIAGNOSING DOUBLED FIREBASE VALUES ==========\n');

  // Use the processing month from command line or default to 2026-01
  const processingMonth = process.argv[2] || '2026-01';
  const roleGroup = 'RD1/2';

  console.log(`Processing Month: ${processingMonth}`);
  console.log(`Role Group: ${roleGroup}\n`);

  // 1. Check for duplicate seller statement documents
  console.log('1. Checking for duplicate seller statement documents...');
  const sellerStatementsRef = collection(db, 'sellerStatements');
  const sellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth),
    where('roleGroup', '==', roleGroup)
  );
  const sellerSnapshot = await getDocs(sellerQuery);
  
  console.log(`   Found ${sellerSnapshot.docs.length} document(s) for ${roleGroup} in ${processingMonth}`);
  
  if (sellerSnapshot.docs.length > 1) {
    console.log(`   ⚠️ DUPLICATE DOCUMENTS DETECTED! Multiple documents exist for ${roleGroup} + ${processingMonth}`);
    sellerSnapshot.docs.forEach((doc, idx) => {
      const data = doc.data();
      console.log(`   Document ${idx + 1}:`);
      console.log(`     ID: ${doc.id}`);
      console.log(`     Items count: ${data.items?.length || 0}`);
      console.log(`     Total OTG Comp: $${(data.totalOtgComp || 0).toFixed(2)}`);
      console.log(`     Total Seller Comp: $${(data.totalSellerComp || 0).toFixed(2)}`);
      console.log(`     Processed At: ${data.processedAt?.toDate?.() || data.processedAt || 'N/A'}`);
    });
  } else if (sellerSnapshot.docs.length === 1) {
    const data = sellerSnapshot.docs[0].data();
    console.log(`   ✅ Single document found (expected)`);
    console.log(`     ID: ${sellerSnapshot.docs[0].id}`);
    console.log(`     Items count: ${data.items?.length || 0}`);
    console.log(`     Total OTG Comp: $${(data.totalOtgComp || 0).toFixed(2)}`);
    console.log(`     Total Seller Comp: $${(data.totalSellerComp || 0).toFixed(2)}`);
    
    // Check for duplicate items within the document
    const items = data.items || [];
    const itemKeys = new Map<string, number>();
    items.forEach((item: any, idx: number) => {
      const key = `${item.otgCompBillingItem}|${item.accountName}`;
      const count = itemKeys.get(key) || 0;
      itemKeys.set(key, count + 1);
    });
    
    const duplicateItems = Array.from(itemKeys.entries()).filter(([_, count]) => count > 1);
    if (duplicateItems.length > 0) {
      console.log(`   ⚠️ DUPLICATE ITEMS WITHIN DOCUMENT DETECTED!`);
      duplicateItems.forEach(([key, count]) => {
        console.log(`     Key "${key}" appears ${count} times`);
        const matchingItems = items.filter((item: any) => 
          `${item.otgCompBillingItem}|${item.accountName}` === key
        );
        matchingItems.forEach((item: any, idx: number) => {
          console.log(`       Item ${idx + 1}: OTG Comp=$${item.otgComp?.toFixed(2) || '0.00'}, Seller Comp=$${item.sellerComp?.toFixed(2) || '0.00'}`);
        });
      });
    } else {
      console.log(`   ✅ No duplicate items within document`);
    }
  } else {
    console.log(`   ⚠️ No documents found for ${roleGroup} in ${processingMonth}`);
  }

  console.log('\n');

  // 2. Check for duplicate matches
  console.log('2. Checking for duplicate matches...');
  const matchesRef = collection(db, 'matches');
  const matchesQuery = query(
    matchesRef,
    where('processingMonth', '==', processingMonth)
  );
  const matchesSnapshot = await getDocs(matchesQuery);
  
  console.log(`   Found ${matchesSnapshot.docs.length} total match(es) for ${processingMonth}`);
  
  // Group matches by key (billingItem|accountName|carrierStatementId)
  const matchKeys = new Map<string, number>();
  matchesSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const matchedRow = data.matchedRow || {};
    const key = `${matchedRow.otgCompBillingItem}|${matchedRow.accountName}|${data.carrierStatementId}`;
    const count = matchKeys.get(key) || 0;
    matchKeys.set(key, count + 1);
  });
  
  const duplicateMatches = Array.from(matchKeys.entries()).filter(([_, count]) => count > 1);
  if (duplicateMatches.length > 0) {
    console.log(`   ⚠️ DUPLICATE MATCHES DETECTED! ${duplicateMatches.length} duplicate match key(s)`);
    duplicateMatches.slice(0, 10).forEach(([key, count]) => {
      console.log(`     Key "${key}" appears ${count} times`);
    });
    if (duplicateMatches.length > 10) {
      console.log(`     ... and ${duplicateMatches.length - 10} more duplicate keys`);
    }
  } else {
    console.log(`   ✅ No duplicate matches found`);
  }

  console.log('\n');

  // 3. Check all seller statements for the processing month (all role groups)
  console.log('3. Checking all seller statements for processing month...');
  const allSellerQuery = query(
    sellerStatementsRef,
    where('processingMonth', '==', processingMonth)
  );
  const allSellerSnapshot = await getDocs(allSellerQuery);
  
  console.log(`   Found ${allSellerSnapshot.docs.length} total seller statement document(s)`);
  
  // Group by roleGroup
  const roleGroupCounts = new Map<string, number>();
  allSellerSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const rg = data.roleGroup || 'UNKNOWN';
    roleGroupCounts.set(rg, (roleGroupCounts.get(rg) || 0) + 1);
  });
  
  console.log(`   Documents per role group:`);
  roleGroupCounts.forEach((count, rg) => {
    if (count > 1) {
      console.log(`     ${rg}: ${count} documents ⚠️ DUPLICATE!`);
    } else {
      console.log(`     ${rg}: ${count} document(s) ✅`);
    }
  });

  console.log('\n');

  // 4. Calculate totals from matches vs seller statements
  console.log('4. Comparing totals from matches vs seller statements...');
  
  // Calculate totals from matches for RD1/2
  let totalCommissionFromMatches = 0;
  let totalSellerCompFromMatches = 0;
  matchesSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const matchedRow = data.matchedRow || {};
    const roleSplits = matchedRow.roleSplits || {};
    
    // Check if this match contributes to RD1/2
    const rd1 = roleSplits.RD1 || 0;
    const rd2 = roleSplits.RD2 || 0;
    if (rd1 !== 0 || rd2 !== 0) {
      totalCommissionFromMatches += matchedRow.commissionAmount || 0;
      totalSellerCompFromMatches += rd1 + rd2;
    }
  });
  
  // Calculate totals from seller statements
  let totalOtgCompFromStatements = 0;
  let totalSellerCompFromStatements = 0;
  sellerSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    totalOtgCompFromStatements += data.totalOtgComp || 0;
    totalSellerCompFromStatements += data.totalSellerComp || 0;
  });
  
  console.log(`   From Matches:`);
  console.log(`     Total Commission: $${totalCommissionFromMatches.toFixed(2)}`);
  console.log(`     Total Seller Comp (RD1+RD2): $${totalSellerCompFromMatches.toFixed(2)}`);
  console.log(`   From Seller Statements:`);
  console.log(`     Total OTG Comp: $${totalOtgCompFromStatements.toFixed(2)}`);
  console.log(`     Total Seller Comp: $${totalSellerCompFromStatements.toFixed(2)}`);
  
  const ratio = totalSellerCompFromStatements / totalSellerCompFromMatches;
  if (Math.abs(ratio - 2.0) < 0.01) {
    console.log(`   ⚠️ Seller statement total is EXACTLY DOUBLE the match total (ratio: ${ratio.toFixed(2)})`);
  } else if (ratio > 1.5) {
    console.log(`   ⚠️ Seller statement total is significantly higher than match total (ratio: ${ratio.toFixed(2)})`);
  } else if (Math.abs(ratio - 1.0) < 0.01) {
    console.log(`   ✅ Totals match (ratio: ${ratio.toFixed(2)})`);
  } else {
    console.log(`   ⚠️ Totals don't match (ratio: ${ratio.toFixed(2)})`);
  }

  console.log('\n========== DIAGNOSIS COMPLETE ==========\n');
}

diagnoseDoubledValues()
  .then(() => {
    console.log('Diagnosis completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error during diagnosis:', error);
    process.exit(1);
  });
