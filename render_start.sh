#!/bin/bash
PORT=${PORT:-8001}
python3 -m uvicorn python_backend.main:app --host 0.0.0.0 --port $PORT
