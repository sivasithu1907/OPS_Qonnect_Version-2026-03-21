# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Copy package.json first for layer caching
# npm install is cached unless package.json changes
COPY package.json ./
RUN npm install

# Copy source files (separate layer)
COPY . .

# Build the application
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
