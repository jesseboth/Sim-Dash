#!/bin/bash

# Package SimDash UDP Plugin for Assetto Corsa
# Creates a zip file that can be drag-dropped into Content Manager

PLUGIN_DIR="SimDashUDP"
OUTPUT_FILE="SimDashUDP.zip"

echo "Packaging AC Plugin..."

# Remove old zip if exists
if [ -f "$OUTPUT_FILE" ]; then
    echo "Removing old $OUTPUT_FILE"
    rm "$OUTPUT_FILE"
fi

# Create zip
cd "$(dirname "$0")"
zip -r "$OUTPUT_FILE" "$PLUGIN_DIR/" -x "*.pyc" -x "__pycache__/*" -x "*.DS_Store"

if [ $? -eq 0 ]; then
    echo "✓ Successfully created $OUTPUT_FILE"
    echo "  Drag and drop this file into Content Manager to install"
else
    echo "✗ Failed to create zip file"
    exit 1
fi
