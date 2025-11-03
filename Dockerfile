# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the app
RUN npm run build

# Stage 2: Run
FROM node:20-alpine
WORKDIR /app

# Copy only the build output and necessary files
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm install --omit=dev

# Expose port 4000 for the backend
EXPOSE 4000

# Start the NestJS app
CMD ["node", "dist/main.js"]
