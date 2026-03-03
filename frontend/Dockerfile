# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files from the root
COPY package.json ./
RUN npm install

# Copy EVERYTHING to ensure index.css and all components are found
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
