#!/bin/bash
# Start both frontend (dev server with proxy) and backend

cd "$(dirname "$0")"

echo "Starting Python Backend (port 8001)..."
cd python_backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8001 &
BACKEND_PID=$!
cd ..

echo "Starting Frontend Dev Server (port 3000)..."
npx vite --host 0.0.0.0 --port 3000 &
FRONTEND_PID=$!

echo ""
echo "============================================"
echo "  Hong Kong CI/PL Generator Started!"
echo "============================================"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8001"
echo ""
echo "  Press Ctrl+C to stop both servers"
echo "============================================"

wait $BACKEND_PID $FRONTEND_PID
