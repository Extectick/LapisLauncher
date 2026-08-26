FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile

COPY apps/worker apps/worker
COPY apps/api/prisma apps/worker/prisma
RUN pnpm --filter @lapis/worker exec prisma generate --schema prisma/schema.prisma \
  && pnpm --filter @lapis/worker build \
  && pnpm --filter @lapis/worker deploy --prod --legacy /opt/lapis-worker \
  && cp -r apps/worker/prisma /opt/lapis-worker/prisma \
  && cd /opt/lapis-worker \
  && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lapis-worker
COPY --from=build --chown=node:node /opt/lapis-worker ./

USER node
CMD ["node", "dist/main.js"]
