FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @lapis/contracts build \
  && pnpm --filter @lapis/api prisma:generate \
  && pnpm --filter @lapis/api build \
  && pnpm --filter @lapis/api deploy --prod --legacy /opt/lapis-api \
  && cd /opt/lapis-api \
  && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lapis-api
COPY --from=build --chown=node:node /opt/lapis-api ./

USER node
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && exec node dist/src/main.js"]
