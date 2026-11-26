# syntax=docker/dockerfile:1.6
#
# Lean production image for Cloudflare Containers (linux/amd64).
# Built from the repository root context with pre-built server, client, and docs
# under `orchestrator/dist` produced by `.github/workflows/deploy-cloudflare.yml`.

# ============================================================================
# SHARED BASE IMAGE
# ============================================================================
FROM --platform=$TARGETPLATFORM node:22-slim AS runtime-base

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=3001
ENV PYTHON_PATH=/usr/bin/python3
ENV DATA_DIR=/app/data

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    libgtk-3-0 libgtk-3-common \
    libdbus-glib-1-2 libxt6 libx11-xcb1 libasound2 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /app

# ============================================================================
# TARGET-PLATFORM PRODUCTION NODE DEPS (COMPILES better-sqlite3 FOR TARGETARCH)
# ============================================================================
FROM runtime-base AS runtime-node-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-minimal python3-pip \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY package*.json ./
COPY docs-site/package*.json ./docs-site/
COPY shared/package*.json ./shared/
COPY orchestrator/package*.json ./orchestrator/
COPY career-boards/bamboohr/package*.json ./career-boards/bamboohr/
COPY career-boards/greenhouse/package*.json ./career-boards/greenhouse/
COPY career-boards/workday/package*.json ./career-boards/workday/
COPY extractors/adzuna/package*.json ./extractors/adzuna/
COPY extractors/hiringcafe/package*.json ./extractors/hiringcafe/
COPY extractors/jobindex/package*.json ./extractors/jobindex/
COPY extractors/freehire/package*.json ./extractors/freehire/
COPY extractors/browser-utils/package*.json ./extractors/browser-utils/
COPY extractors/jobspy/requirements.txt ./extractors/jobspy/

RUN npm install --workspaces --include-workspace-root --omit=dev \
    --no-audit --no-fund --progress=false \
    && npm cache clean --force \
    && pip3 install --no-cache-dir --break-system-packages -r ./extractors/jobspy/requirements.txt \
    && apt-get purge -y --auto-remove build-essential pkg-config python3-pip \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# ============================================================================
# CAMOUFOX BROWSER CACHE (HIRING CAFE RUNS ITS BROWSER INSIDE THE CONTAINER)
# ============================================================================
FROM runtime-node-deps AS camoufox-cache

COPY scripts/camoufox-fetch.mjs ./scripts/camoufox-fetch.mjs
# GitHub's unauthenticated API allows only 60 requests/hour per runner IP and CI builds
# regularly hit it. Pass `--secret id=github_token,...` to authenticate. A secret mount is
# never written to a layer, the image history or the build cache; without the secret (local
# builds, Wrangler's own build reusing the warmed cache) the step runs unauthenticated.
RUN --mount=type=secret,id=github_token,required=false \
    if [ -f /run/secrets/github_token ]; then GITHUB_TOKEN="$(cat /run/secrets/github_token)"; export GITHUB_TOKEN; fi; \
    node ./scripts/camoufox-fetch.mjs

# ============================================================================
# TYPST BINARY STAGE (LIGHTWEIGHT LOCAL RESUME PDF RENDERING)
# ============================================================================
FROM runtime-base AS typst

ARG TARGETARCH
ENV TYPST_VERSION=0.14.2

RUN apt-get update && apt-get install -y --no-install-recommends xz-utils \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) typst_arch="x86_64-unknown-linux-musl" ;; \
        arm64) typst_arch="aarch64-unknown-linux-musl" ;; \
        *) echo "Unsupported TARGETARCH for Typst: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl --proto '=https' --tlsv1.2 -fsSL \
        "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${typst_arch}.tar.xz" \
        -o /tmp/typst.tar.xz; \
    mkdir -p /tmp/typst; \
    tar -xJf /tmp/typst.tar.xz -C /tmp/typst --strip-components=1; \
    install -m 0755 /tmp/typst/typst /usr/local/bin/typst; \
    rm -rf /tmp/typst.tar.xz /tmp/typst

RUN printf '%s\n' '#import "@preview/clean-print-cv:0.1.0": *' > /tmp/warm.typ \
    && XDG_CACHE_HOME=/root/.cache /usr/local/bin/typst compile /tmp/warm.typ /tmp/warm.pdf \
    && rm -f /tmp/warm.typ /tmp/warm.pdf

# ============================================================================
# FINAL LEAN PRODUCTION IMAGE
# ============================================================================
FROM runtime-node-deps AS production

# Chromium headless shell for careers-site crawling (watchlist sources that render in a browser).
# The app server inside the Durable Object has no browser, so it delegates those crawls here.
# `--with-deps` also installs the system libraries it needs, which is why it runs in this stage.
# The crawler finds the browser through PLAYWRIGHT_BROWSERS_PATH (see careers-site/fetch.ts).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium-headless-shell \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /root/.npm

COPY --from=typst /usr/local/bin/typst /usr/local/bin/typst
COPY --from=camoufox-cache /root/.cache/camoufox /root/.cache/camoufox
COPY --from=typst /root/.cache/typst /root/.cache/typst

COPY shared ./shared
COPY orchestrator ./orchestrator

# The PDF renderer starts from this prebuilt bundle (ScraperContainer sets it as the entrypoint).
# Fail the build rather than ship an image whose renderer exits with MODULE_NOT_FOUND.
RUN test -f /app/orchestrator/dist/pdf-worker/pdf-worker.mjs \
    || { echo "orchestrator/dist/pdf-worker/pdf-worker.mjs is missing from the build context; run build:pdf-worker and check .dockerignore" >&2; exit 1; }
COPY career-boards/bamboohr ./career-boards/bamboohr
COPY career-boards/greenhouse ./career-boards/greenhouse
COPY career-boards/workday ./career-boards/workday
COPY extractors/adzuna ./extractors/adzuna
COPY extractors/hiringcafe ./extractors/hiringcafe
COPY extractors/jobindex ./extractors/jobindex
COPY extractors/jobspy ./extractors/jobspy
COPY extractors/freehire ./extractors/freehire
COPY extractors/browser-utils ./extractors/browser-utils

COPY cloudflare/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/data/pdfs /app/data/cloudflare-cookies

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:3001/health || exit 1

WORKDIR /app/orchestrator
ENTRYPOINT ["/app/entrypoint.sh"]
