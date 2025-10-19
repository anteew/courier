FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose ports
EXPOSE 8787 8788

# Default command
CMD ["node", "dist/index.js"]
