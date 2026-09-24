# =========================
# Build stage
# =========================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

# prisma generate + nest build
RUN npm run build


# =========================
# Production stage
# =========================
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

# Prisma schema/migrations
COPY --from=builder /app/prisma ./prisma

# Generated Prisma Client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Compiled NestJS application
COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/main.js"]