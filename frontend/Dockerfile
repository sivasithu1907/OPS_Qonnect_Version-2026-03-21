# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Copy BOTH package files first — this allows Docker to cache the npm install layer.
# The cache is only invalidated when package.json or package-lock.json actually changes.
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Copy source files (separate layer — doesn't invalidate npm cache)
COPY . .

# Build the application
RUN npm run build

# Serve stage
FROM nginx:alpine
# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html
# Copy the fixed Nginx config from Step 1
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
