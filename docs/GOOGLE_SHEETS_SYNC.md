# Google Sheets Sync Setup Guide

This guide explains how to set up and use the Google Sheets sync feature for the Comp Key (Master Data 2).

## Overview

The Sync Test tab allows you to:
1. **Load data** from a Google Sheet exactly as it appears
2. **Sync to database** - Replace your Firebase database with the sheet data
3. **Preserve structure** - Maintains all columns, column order, and account/line item grouping
4. **Simple sync** - Direct replacement: sheet becomes the source of truth

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
   - You can paste the full URL or just the ID
   - The ID will be extracted automatically
2. Enter the **Tab Name** (default: `Sheet1`)
   - This is the name of the tab/sheet within your spreadsheet
3. Enter the **Range** (default: `A1:ZZ`)
   - Cell range to read (e.g., `A1:ZZ`, `A1:Z1000`)
   - The full range will be: `{TabName}!{Range}` (e.g., `Sheet1!A1:ZZ`)
4. Click **"Load Sheet Data"**
5. The system will read all data from the sheet
6. You'll see a status message showing how many records were loaded

### 3. Sync to Database

1. Review the status message - it shows how many records will be synced
2. Click **"Sync to Database"** button
3. Confirm the sync (you'll see a warning about replacing all database records)
4. The sync will:
   - Replace your entire Firebase database with the sheet data
   - Preserve all columns exactly as they appear in the sheet
   - Maintain column order from the sheet headers
   - Preserve existing IDs where records match (same Account **CARRIER** + OTG Comp Billing item)
   - Generate new IDs for new records
   - Maintain account/line item structure (grouped automatically)

## Sync Behavior

### How Sync Works

1. **Load Sheet Data**: Reads all rows from the specified sheet range
2. **Preserve Headers**: Uses the first row as column headers
3. **Create Records**: Converts each row to a `MasterRecord` with all columns preserved
4. **Sync to Database**: Replaces entire Firebase database with sheet data

### Data Preservation

- **All Columns**: Every column from the sheet is preserved
- **Column Order**: Maintains the exact order from sheet headers
- **All Values**: Preserves all cell values exactly as they appear (including empty cells)
- **Data Types**: Numbers, text, percentages all preserved as-is

### ID Preservation

- Records are matched by: **Account **CARRIER** + OTG Comp Billing item**
- If a record in the sheet matches an existing database record (same Account + Billing Item), the existing ID is preserved
- New records get new IDs generated automatically
- This ensures account/line item grouping works correctly after sync

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
2. **Backup**: Export Firebase data before syncing (the sync replaces all data)
3. **Verify sheet structure**: Ensure your sheet has all required columns
4. **Check data**: Review the loaded record count before syncing
5. **One-way sync**: This is Sheet → Database only (sheet is source of truth)

## Account/Line Item Structure

After syncing, records are automatically grouped by:
- **Account **CARRIER** + OTG Comp Billing item** = One Account
- Multiple records with the same Account + Billing Item = Multiple Line Items

This matches the existing Comp Key view structure, so accounts will appear correctly with their line items in the popup.

## Limitations

- **One-way sync**: Sheet → Database only (no Database → Sheet sync)
- **Full replacement**: Syncs replace the entire database (not incremental)
- **No real-time sync**: Manual sync only (no automatic polling)
- **No history**: Changes are not tracked/versioned
- **Sheet size limits**: Google Sheets has row/column limits
- **Rate limits**: Google Sheets API has rate limits (100 requests/100 seconds/user)

## Future Enhancements

Potential improvements:
- Bidirectional sync (Database → Sheet)
- Incremental sync (only changed records)
- Conflict detection and resolution
- Sync history/audit log
- Automatic polling for Sheet changes
