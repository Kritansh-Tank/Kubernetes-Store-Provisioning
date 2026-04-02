const { defineConfig } = require("@medusajs/framework/utils")

module.exports = defineConfig({
  projectConfig: {
    workerMode: process.env.MEDUSA_WORKER_MODE || "shared",
    redisUrl: process.env.REDIS_URL,
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:7001",
      authCors: process.env.AUTH_CORS || "http://localhost:7001,http://localhost:8000",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
    // cookieOptions is at projectConfig level (not inside http)
    // Override secure flag for HTTP-based environments (e.g., local k3d)
    cookieOptions: {
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: process.env.COOKIE_SECURE === "true" ? "none" : "lax",
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL || undefined,
  },
  modules: [
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          redisUrl: process.env.REDIS_URL,
        },
      },
    },
  ],
})
