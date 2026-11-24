# BrainWaves as a hosted web app: the web app plus bw-server, in one image.
#   docker build -t brainwaves .
#   docker run -p 8080:8080 -v brainwaves-data:/data brainwaves
# GitHub Actions publishes it as ghcr.io/raydevxyz/nmuch (see .github/workflows/docker.yml).

# ---- 1. the web app (apps/desktop, built for the browser)
FROM node:22-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/desktop/package.json apps/desktop/
COPY packages/editor/package.json packages/editor/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps/desktop apps/desktop
# The in-app course (Learn BrainWaves) is built from these lessons.
COPY docs/course docs/course
RUN pnpm --filter @brainwaves/desktop build
# Fail here, not in the app, if the course didn't make it into the build.
RUN ls apps/desktop/dist/assets | grep -q '^01-first-page' || (echo 'docs/course is missing from the web build' && exit 1)

# ---- 2. the server
FROM rust:1-bookworm AS server
WORKDIR /src
COPY . .
RUN cargo build --release -p bw-server

# ---- 3. what runs
FROM debian:bookworm-slim
# No packages needed: HTTPS (5etools, Burrow) uses certificates built into the server.
RUN useradd --system --uid 10001 brainwaves && mkdir /data && chown brainwaves /data
COPY --from=server /src/target/release/bw-server /usr/local/bin/bw-server
COPY --from=web /src/apps/desktop/dist /app/web
USER brainwaves
ENV PORT=8080 DATA_DIR=/data WEB_DIR=/app/web
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/${PORT:-8080} && printf "GET /healthz HTTP/1.0\r\n\r\n" >&3 && grep -q ok <&3'
CMD ["bw-server"]
