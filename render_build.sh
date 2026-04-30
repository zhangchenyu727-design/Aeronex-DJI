#!/bin/bash
set -e

echo "=== Building frontend ==="
npm ci
npm run build

echo "=== Copy Python requirements ==="
cp python_backend/requirements.txt requirements.txt

echo "=== Build complete ==="
