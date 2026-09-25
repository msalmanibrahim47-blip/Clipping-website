# LongCut processing worker — FFmpeg, yt-dlp, (optional) faster-whisper, Node job runner.
# Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t longcut-worker .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN npm ci --workspace @longcut/worker --include-workspace-root --no-audit --no-fund
RUN npm run build -w @longcut/worker && npm prune --omit=dev --workspace @longcut/worker --include-workspace-root --no-audit --no-fund

FROM node:22-bookworm-slim
ARG INSTALL_WHISPER=false
ENV NODE_ENV=production \
    WORKER_TMP_DIR=/data/tmp \
    FONTS_DIR=/usr/share/fonts \
    MIGRATIONS_DIR=/app/packages/db/migrations \
    PYTHON_PATH=/opt/venv/bin/python \
    YTDLP_PATH=/opt/venv/bin/yt-dlp
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-venv ca-certificates tini \
      fonts-inter fonts-montserrat fonts-roboto fonts-noto-core fonts-liberation2 \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -U yt-dlp \
 && if [ "$INSTALL_WHISPER" = "true" ]; then /opt/venv/bin/pip install --no-cache-dir faster-whisper; fi \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/python ./apps/worker/python
RUN mkdir -p /data/tmp && chown -R node:node /data
USER node
EXPOSE 8080
ENV PORT=8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
