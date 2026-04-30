FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including Node.js 20
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY python_backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy frontend package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy all source code
COPY . .

# Build frontend
RUN npm run build

# Copy Python backend into the image
COPY python_backend/ ./python_backend/

EXPOSE 8001

# Start unified server (backend serves both API and frontend)
CMD ["python3", "-m", "uvicorn", "python_backend.main:app", "--host", "0.0.0.0", "--port", "8001"]
