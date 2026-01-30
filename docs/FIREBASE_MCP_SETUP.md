# Firebase MCP Setup Guide

This guide will help you connect Firebase MCP (Model Context Protocol) server in Cursor IDE and set up Firebase for the project.

## Prerequisites

- Cursor version 0.46.8 or later
- Node.js and npm installed
- Firebase account (create at https://console.firebase.google.com)

## Step 1: Configure Firebase MCP Server in Cursor

1. Open **Cursor Settings** → **Tools & Integrations** → **MCP Servers**
2. Click **"Add custom MCP"** - this will create/update an `mcp.json` file
3. Open the `mcp.json` file (in your project root or `~/.cursor/mcp.json`)
4. Add the Firebase MCP server configuration:

```json
{
  "mcpServers": {
    "firebase": {
      "command": "npx",
      "args": ["-y", "firebase-tools@latest", "mcp"]
    }
  }
}
```

5. Save the file
6. Restart Cursor IDE
7. The Firebase MCP server should now appear in your MCP Servers list and be enabled automatically

## Step 2: Authenticate with Firebase

The Firebase MCP server uses the same credentials as the Firebase CLI. You need to log in:

```bash
npx firebase-tools login
```

This will open a browser window for authentication. Once logged in, the MCP server will use these credentials.

## Step 3: Create Firebase Project (if needed)

1. Go to https://console.firebase.google.com
2. Click "Add project" or select existing project
3. Enable **Firestore Database**:
   - Go to Firestore Database in Firebase Console
   - Click "Create database"
   - Choose "Start in test mode" (we'll add security rules later)
   - Select a location
4. Enable **Cloud Storage**:
   - Go to Storage in Firebase Console
   - Click "Get started"
   - Choose "Start in test mode" (we'll add security rules later)
   - Use same location as Firestore

## Step 4: Get Firebase Configuration

1. In Firebase Console, go to Project Settings (gear icon)
2. Scroll down to "Your apps"
3. Click "Web" icon (`</>`) to add a web app
4. Register app (give it a name)
5. Copy the Firebase configuration object:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

6. Save this config - you'll need it for `services/firebaseClient.ts`

## Step 5: Install Firebase CLI (Optional but Recommended)

```bash
npm install -g firebase-tools
```

Or use locally:
```bash
npx firebase-tools --version
```

## Available Firebase MCP Tools

Once connected, the Firebase MCP server provides access to:

- **`firebase_projects_list`**: List your Firebase projects
- **`firestore_collections_list`**: List Firestore collections
- **`firestore_documents_get`**: Get Firestore documents
- **`firestore_documents_set`**: Create/update Firestore documents
- **`firestore_documents_delete`**: Delete Firestore documents
- **`storage_files_list`**: List Cloud Storage files
- **`storage_files_upload`**: Upload files to Cloud Storage
- **`storage_files_download`**: Download files from Cloud Storage

## Verification

To verify the connection is working:

1. Check that the MCP server shows as "connected" in Cursor Settings
2. Try asking Cursor AI: "List my Firebase projects" or "Show me my Firestore collections"
3. The AI should be able to interact with your Firebase project directly

## Troubleshooting

- **Server not connecting**: 
  - Make sure you've run `npx firebase-tools login`
  - Check that Node.js and npm are installed
  - Restart Cursor IDE

- **Authentication errors**: 
  - Run `npx firebase-tools login` again
  - Check that you have access to the Firebase project

- **MCP server not appearing**: 
  - Check `mcp.json` file is in correct location
  - Verify JSON syntax is correct
  - Restart Cursor IDE

## Next Steps

After setting up Firebase MCP:

1. Install Firebase SDK: `npm install firebase` (already done ✅)
2. Firebase client is configured in `services/firebaseClient.ts`
3. Firestore configuration is in `firestore/` folder
4. Use Firebase MCP tools to interact with your Firebase project

See `docs/FIREBASE_MIGRATION_COMPLETE.md` for migration details.
