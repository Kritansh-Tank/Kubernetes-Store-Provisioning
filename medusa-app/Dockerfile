# Single-stage build: install deps, build admin, run from project root
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install

COPY medusa-config.js tsconfig.json ./
RUN mkdir -p src/api src/subscribers src/workflows src/jobs src/modules src/links

# Create a placeholder TypeScript file so the compiler has an input
RUN echo "export {}" > src/index.ts

# Build the Medusa admin dashboard (needs extra memory for Vite)
# NOTE: If the Vite build silently fails during docker build (OOM), use the
# docker exec workaround: run container, exec the build, then docker commit.
ENV DISABLE_MEDUSA_ADMIN=false
RUN NODE_OPTIONS="--max-old-space-size=4096" npx medusa build

# Medusa builds admin to dist/public/admin/ but serves from public/admin/
RUN mkdir -p /app/public && ln -s /app/dist/public/admin /app/public/admin

# Clean up build tools to reduce image size
RUN apk del python3 make g++ 2>/dev/null || true

# NODE_ENV is intentionally NOT set here — set it per-environment via Helm chart.
# Setting NODE_ENV=production forces Medusa to use secure-only session cookies,
# which breaks login when accessing via HTTP (e.g., local k3d).

RUN addgroup -g 1001 -S nodejs && adduser -S medusa -u 1001
RUN chown -R medusa:nodejs /app
USER medusa

EXPOSE 9000

# Run directly — CLI + medusa + all deps are all in the same node_modules
CMD ["npx", "medusa", "start"]
