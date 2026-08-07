# Use the exact supported Node 22 release used by local development and CI.
FROM node:22.23.1-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Create app directory
WORKDIR /app

# Install production dependencies from the committed lockfile.
COPY package*.json ./
# Skip lifecycle scripts (like husky prepare) during production install.
RUN npm ci --omit=dev --ignore-scripts --no-audit
# npm is only a build-time installer. Do not retain its CLI dependency tree in
# the runtime image, where it adds attack surface without serving the app.
RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

# Bundle app source
COPY . .

# The public HTML references long-lived static JavaScript. Rewrite the JadeAssist
# script URLs with a release token so browsers cannot keep the pre-close-button
# bundle after a deployment.
RUN node scripts/version-jadeassist-assets.mjs

# Ensure the uploads directory exists and all files are owned by the node user
# (must be done as root before USER node switch)
RUN mkdir -p uploads && chown -R node:node /app

# Run as non-root user for security
USER node

# Default port (Railway will override PORT at runtime)
ENV PORT=3000
# This Dockerfile is for production deployments only.
# NODE_ENV is set at build time; override via Railway/Docker environment variables if needed.
ENV NODE_ENV=production
ENV EVENTFLOW_PROCESS_TYPE=web

# Expose the port for documentation purposes
EXPOSE 3000

# Web and worker processes each expose /api/ready for their own delivery dependencies.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'curl -fsS http://localhost:${PORT:-3000}/api/ready || exit 1'

# The production supervisor runs both the web server and the messaging workers.
# /api/ready intentionally stays unavailable until the worker heartbeat is live.
CMD ["sh", "-c", "node scripts/preflight.mjs && exec node scripts/start-production.js"]
