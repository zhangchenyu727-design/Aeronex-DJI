#!/bin/bash
set -e

echo "=== Building frontend ==="
npm ci
npm run build

echo "=== Build complete ==="
