#!/bin/bash

# Configure Firebase Storage CORS for browser access
# This allows the browser to download files directly from Firebase Storage

BUCKET_NAME="otg0-109bd.firebasestorage.app"
CORS_CONFIG_FILE="firestore/storage.cors.json"

echo "Configuring CORS for Firebase Storage bucket: $BUCKET_NAME"
echo "Using CORS config from: $CORS_CONFIG_FILE"

# Check if gsutil is installed
if ! command -v gsutil &> /dev/null; then
    echo "Error: gsutil is not installed. Please install Google Cloud SDK:"
    echo "  https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if CORS config file exists
if [ ! -f "$CORS_CONFIG_FILE" ]; then
    echo "Error: CORS config file not found: $CORS_CONFIG_FILE"
    exit 1
fi

# Apply CORS configuration
echo "Applying CORS configuration..."
gsutil cors set "$CORS_CONFIG_FILE" "gs://$BUCKET_NAME"

if [ $? -eq 0 ]; then
    echo "✅ CORS configuration applied successfully!"
    echo ""
    echo "You can now download files from Firebase Storage directly in the browser."
else
    echo "❌ Failed to apply CORS configuration"
    exit 1
fi
