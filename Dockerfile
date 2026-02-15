FROM node:20-slim

# Install git for git integration
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Default env
ENV HOST=0.0.0.0
ENV PORT=4000
ENV PROJECT_ROOT=/workspace

# Create workspace directory
RUN mkdir -p /workspace

EXPOSE 4000

CMD ["npx", "tsx", "server/index.ts"]
