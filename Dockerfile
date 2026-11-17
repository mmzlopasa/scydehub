# syntax=docker/dockerfile:1.7
# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY server server
COPY web web
# after the build only the server's own runtime dependencies are kept (the web app is already compiled to static files)
RUN npm run build -w web && npm run build -w server \
 && npm ci --omit=dev --no-audit --no-fund -w server --include-workspace-root=false \
 && mkdir -p server/node_modules

# ---------- runtime ----------
FROM node:22-alpine
ARG VERSION=0.3.1
ARG BUILD_ID=dev
# iputils: real ICMP ping (unprivileged via net.ipv4.ping_group_range), tini: proper signal handling
RUN apk add --no-cache iputils tini ca-certificates tzdata
ENV NODE_ENV=production \
    PORT=8484 \
    SCYDE_DATA_DIR=/data \
    SCYDE_WEB_DIR=/app/web/dist \
    SCYDE_VERSION=$VERSION \
    SCYDE_BUILD_ID=$BUILD_ID
WORKDIR /app/server
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/web/dist /app/web/dist
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
VOLUME /data
EXPOSE 8484
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8484/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
