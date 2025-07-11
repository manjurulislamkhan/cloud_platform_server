# ---- Base Node.js Image ----
# Use a specific Node.js LTS (Long Term Support) version on Alpine for a smaller image size.
# Alpine Linux is a security-oriented, lightweight Linux distribution.
FROM node:20-alpine AS base

# Set the working directory in the container.
WORKDIR /usr/src/app

# ---- Dependencies ----
# Copy package.json and package-lock.json (or yarn.lock) first.
# This leverages Docker's cache. If these files don't change,
# Docker won't reinstall dependencies in subsequent builds.
FROM base AS dependencies
COPY package*.json ./
# Install production dependencies only.
RUN npm ci --only=production --ignore-scripts

# ---- Build ----
# In this stage, we'll install all dependencies (including devDependencies)
# and build the TypeScript code.
FROM base AS build
COPY package*.json ./
# Install all dependencies needed for building
RUN npm install --ignore-scripts
# Copy the rest of your application's source code.
COPY . .
# Compile TypeScript to JavaScript.
# Ensure your tsconfig.json has "outDir": "./dist" or similar.
RUN npm run build

# ---- Production ----
# This is the final, lean production image.
FROM base AS production

# Set NODE_ENV to production.
ENV NODE_ENV=production
# Cloud Run specific: PORT environment variable is provided by Cloud Run.
ENV PORT=${PORT:-8080}

# Create a non-root user and group for better security.
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
USER nodejs

# Copy only the necessary artifacts from the previous stages.
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist

# Expose the port the app runs on.
# This is documentation; Cloud Run uses the PORT env var.
EXPOSE ${PORT}

# Command to run the application.
# Use 'node' directly instead of 'npm start' for faster startup and fewer processes.
# Cloud Run expects your application to listen on the port specified by the PORT environment variable.
# Ensure your server.ts (compiled to dist/server.js) respects this.
CMD ["node", "dist/server.js"]