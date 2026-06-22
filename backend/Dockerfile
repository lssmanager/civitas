FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV RUN_MIGRATIONS_ON_STARTUP=false

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm run start:api"]
