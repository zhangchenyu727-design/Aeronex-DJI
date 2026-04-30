#!/bin/bash
set -e

echo "=== Step 1: Installing Node.js ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "=== Step 2: Installing npm dependencies ==="
npm ci

echo "=== Step 3: Building frontend ==="
npm run build

echo "=== Step 4: Moving Python requirements to root ==="
cp python_backend/requirements.txt requirements.txt

echo "=== Build complete ==="
