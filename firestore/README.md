# Firestore Configuration

This folder contains all Firestore and Cloud Storage configuration files for the Firebase backend.

## Files

- **`firestore.rules`** - Firestore security rules (currently in test mode)
- **`firestore.indexes.json`** - Firestore composite indexes definition
- **`storage.rules`** - Cloud Storage security rules (currently in test mode)

## Deployment

These files are referenced by `firebase.json` in the project root. To deploy:

```bash
# Deploy Firestore rules and indexes
npx firebase-tools deploy --only firestore

# Deploy Storage rules
npx firebase-tools deploy --only storage

# Deploy everything
npx firebase-tools deploy
```

## Security Rules

⚠️ **Current rules are in test mode** - they allow read/write access to all collections. For production, update the rules to include proper authentication and authorization.

## Indexes

The indexes defined here are required for efficient queries:
- `carrierStatements`: Composite index on `carrier` + `processingMonth`
- `sellerStatements`: Composite index on `roleGroup` + `processingMonth`
- Single-field indexes are auto-configured by Firestore
