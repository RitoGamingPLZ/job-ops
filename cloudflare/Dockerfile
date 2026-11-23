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
ENV DATA_DIR=/app/data
ENV INTERNAL_SYNC_SECRET=jobops-internal-d1-sync

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /app

# ============================================================================
# TARGET-PLATFORM PRODUCTION NODE DEPS (COMPILES better-sqlite3 FOR TARGETARCH)
# ============================================================================
FROM runtime-base AS runtime-node-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-minimal \
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
COPY extractors/gradcracker/package*.json ./extractors/gradcracker/
COPY extractors/jobindex/package*.json ./extractors/jobindex/
COPY extractors/naukri/package*.json ./extractors/naukri/
COPY extractors/startupjobs/package*.json ./extractors/startupjobs/
COPY extractors/workingnomads/package*.json ./extractors/workingnomads/
COPY extractors/golangjobs/package*.json ./extractors/golangjobs/
COPY extractors/ukvisajobs/package*.json ./extractors/ukvisajobs/
COPY extractors/seek/package*.json ./extractors/seek/
COPY extractors/fiveamsat/package*.json ./extractors/fiveamsat/
COPY extractors/wazzuf/package*.json ./extractors/wazzuf/
COPY extractors/freehire/package*.json ./extractors/freehire/
COPY extractors/browser-utils/package*.json ./extractors/browser-utils/

RUN npm install --workspaces --include-workspace-root --omit=dev \
    --no-audit --no-fund --progress=false \
    && npm cache clean --force \
    && apt-get purge -y --auto-remove build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

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

# ============================================================================
# FINAL LEAN PRODUCTION IMAGE
# ============================================================================
FROM runtime-node-deps AS production

COPY --from=typst /usr/local/bin/typst /usr/local/bin/typst

COPY shared ./shared
COPY orchestrator ./orchestrator
COPY career-boards/bamboohr ./career-boards/bamboohr
COPY career-boards/greenhouse ./career-boards/greenhouse
COPY career-boards/workday ./career-boards/workday
COPY extractors/adzuna ./extractors/adzuna
COPY extractors/hiringcafe ./extractors/hiringcafe
COPY extractors/gradcracker ./extractors/gradcracker
COPY extractors/jobindex ./extractors/jobindex
COPY extractors/jobspy ./extractors/jobspy
COPY extractors/naukri ./extractors/naukri
COPY extractors/startupjobs ./extractors/startupjobs
COPY extractors/workingnomads ./extractors/workingnomads
COPY extractors/golangjobs ./extractors/golangjobs
COPY extractors/ukvisajobs ./extractors/ukvisajobs
COPY extractors/seek ./extractors/seek
COPY extractors/fiveamsat ./extractors/fiveamsat
COPY extractors/wazzuf ./extractors/wazzuf
COPY extractors/freehire ./extractors/freehire
COPY extractors/browser-utils ./extractors/browser-utils

COPY cloudflare/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/data/pdfs /app/data/cloudflare-cookies

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:3001/health || exit 1

WORKDIR /app/orchestrator
ENTRYPOINT ["/app/entrypoint.sh"]
