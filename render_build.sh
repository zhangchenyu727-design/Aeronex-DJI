#!/bin/bash
set -e

# Ensure virtual env exists and install deps
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "=== Python dependencies installed ==="
