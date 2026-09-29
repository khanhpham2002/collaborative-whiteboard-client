# ==============================================================================
# STAGE 1: Build ReactJS Frontend với Node.js
# ==============================================================================
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

# ==============================================================================
# STAGE 2: Serve static files với Nginx
# ==============================================================================
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build output
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
