#!/bin/bash
set -e

echo "=== Building frontend ==="
npm ci
npm run build

echo "=== Installing Python dependencies ==="
pip install fastapi uvicorn python-multipart pdfplumber openpyxl Pillow pandas

echo "=== Build complete ==="
