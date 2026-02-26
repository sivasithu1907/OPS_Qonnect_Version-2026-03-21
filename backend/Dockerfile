FROM node:20-alpine

WORKDIR /app

# Install deps first (better caching)
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Copy source
COPY . ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
