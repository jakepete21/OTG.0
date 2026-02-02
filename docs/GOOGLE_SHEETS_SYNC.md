# Google Sheets Sync Setup Guide

This guide explains how to set up and use the bidirectional sync between the Comp Key (Master Data 2) and Google Sheets.

## Overview

The Sync Test tab allows you to:
1. **Compare** your Firebase master data with a Google Sheet
2. **Review differences** before syncing (added, modified, deleted records)
3. **Selectively sync** changes from Sheet → App or App → Sheet
4. **Bidirectional sync** - keep both sides in sync

## Prerequisites

1. **Google Cloud Project** with Sheets API enabled
2. **OAuth 2.0 Credentials** (Client ID and API Key)
3. **Google Sheet** with Comp Key data (same structure as Firebase)

## Setup Steps

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **Google Sheets API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

### 2. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Configure OAuth consent screen (if not done):
   - User Type: External
   - App name: OTG.0 Commission Auditor
   - Scopes: Add `https://www.googleapis.com/auth/spreadsheets`
   - Test users: Add your Google account
4. Create OAuth client ID:
   - Application type: **Web application**
   - Name: OTG.0 Web Client
   - Authorized JavaScript origins: `http://localhost:3000` (for dev) or your production URL
   - Authorized redirect URIs: `http://localhost:3000` (for dev) or your production URL
5. **Save the Client ID** - you'll need this

### 3. Create API Key

1. Still in "Credentials" page
2. Click "Create Credentials" > "API key"
3. **Restrict the API key** (recommended):
   - Application restrictions: HTTP referrers
   - Add your domain: `http://localhost:3000/*` (for dev)
   - API restrictions: Restrict to "Google Sheets API"
4. **Save the API Key** - you'll need this

### 4. Prepare Your Google Sheet

1. Create a new Google Sheet or use existing Comp Key sheet
2. **First row must be headers** - should match your Firebase columns:
   - `ST`, `Account **CARRIER**`, `OTG Comp Billing item`, etc.
   - All 62 columns should be present
3. **Share the sheet** with the Google account you'll authenticate with
4. **Get the Spreadsheet ID** from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit`
   - Copy the `[SPREADSHEET_ID]` part

## Using Sync Test

### 1. Authenticate

1. Go to **Sync Test** tab
2. Enter your **Google API Key** and **Google Client ID**
3. Click **"Authenticate with Google"**
4. A popup will open - sign in with your Google account
5. Grant permissions to access Google Sheets
6. You should see "Authenticated" status

### 2. Configure Sheet

1. Enter your **Spreadsheet ID** (from the Google Sheet URL)
2. Enter the **Range** (default: `Sheet1!A1:ZZ`)
   - Format: `SheetName!A1:ZZ` (adjust based on your sheet)
3. Click **"Load Sheet Data"**
4. The system will read the sheet and compare with Firebase data

### 3. Review Differences

The Sync Test tab shows:
- **Added**: Records in Sheet but not in App (green)
- **Modified**: Records in both but with different values (yellow)
- **Deleted**: Records in App but not in Sheet (red)
- **Unchanged**: Records that match (gray)

Each difference shows:
- Account **CARRIER** name
- OTG Comp Billing item
- For modified records: field-by-field changes

### 4. Select Changes to Sync

1. **Check/uncheck** individual differences using the checkbox
2. Use **"Select All"** or **"Deselect All"** buttons
3. Only selected differences will be synced

### 5. Sync Changes

**Sync Selected to App** (Sheet → App):
- Adds new records from Sheet to Firebase
- Updates existing records with Sheet values
- Keeps Firebase IDs (doesn't delete records)

**Sync All to Sheet** (App → Sheet):
- Writes all Firebase records to the Sheet
- **Overwrites** the entire sheet range
- Use with caution - this replaces Sheet data

## Sync Behavior

### Comparison Logic

Records are matched using:
- **Account **CARRIER** + OTG Comp Billing item** (unique key)

If both match, records are compared field-by-field.

### Conflict Resolution

- **Sheet → App**: Sheet values take precedence
- **App → Sheet**: App values take precedence
- **Manual selection**: You choose which changes to accept

### Data Mapping

The sync service automatically:
- Maps Firebase `MasterRecord` structure to Sheet rows
- Handles all 62 columns dynamically
- Preserves data types (numbers, text, percentages)
- Generates IDs for new records

## Environment Variables (Optional)

You can set these in `.env.local` to pre-fill credentials:

```env
VITE_GOOGLE_API_KEY=your_api_key_here
VITE_GOOGLE_CLIENT_ID=your_client_id_here
```

Otherwise, enter them manually in the Sync Test tab (they'll be saved to localStorage).

## Troubleshooting

### "Authentication failed"
- Check that API Key and Client ID are correct
- Verify OAuth consent screen is configured
- Ensure your Google account is added as a test user
- Check browser console for detailed error

### "Failed to load sheet"
- Verify Spreadsheet ID is correct
- Check that the sheet is shared with your Google account
- Verify the range is correct (e.g., `Sheet1!A1:ZZ`)
- Ensure Google Sheets API is enabled in Cloud Console

### "Failed to sync to sheet"
- Check that you have write permissions on the Sheet
- Verify the range doesn't exceed sheet limits
- Check browser console for detailed error

### Data not matching
- Ensure Sheet headers match Firebase column names exactly
- Check that Account **CARRIER** and OTG Comp Billing item are present
- Verify data types match (numbers vs text)

## Security Notes

- **API Key**: Can be exposed in client code (restrict by domain)
- **OAuth Token**: Stored in browser memory (cleared on sign out)
- **Credentials**: Saved to localStorage (not encrypted)
- **Production**: Use environment variables, restrict API key by domain

## Best Practices

1. **Test first**: Use a test sheet before syncing production data
2. **Backup**: Export Firebase data before syncing
3. **Review changes**: Always review differences before accepting
4. **Incremental sync**: Sync small batches first
5. **One-way sync**: Prefer Sheet → App for initial import, then App → Sheet for updates

## Limitations

- **No real-time sync**: Manual sync only (no automatic polling)
- **No conflict detection**: Last write wins (manual selection helps)
- **No history**: Changes are not tracked/versioned
- **Sheet size limits**: Google Sheets has row/column limits
- **Rate limits**: Google Sheets API has rate limits (100 requests/100 seconds/user)

## Future Enhancements

Potential improvements:
- Automatic polling for Sheet changes
- Conflict resolution UI (side-by-side comparison)
- Sync history/audit log
- Batch operations for large datasets
- Webhook support for real-time updates
