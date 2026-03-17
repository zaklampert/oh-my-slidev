FROM node:22.22.0-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/slidev-hub/package.json ./apps/slidev-hub/package.json
COPY packages/shared-types ./packages/shared-types
COPY packages/slidev-hub-editor-addon ./packages/slidev-hub-editor-addon
COPY packages/slidev-agent-runtime ./packages/slidev-agent-runtime
COPY packages/slidev-agent-shared-types ./packages/slidev-agent-shared-types
COPY packages/slidev-addon-agent ./packages/slidev-addon-agent

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN pnpm --dir apps/slidev-hub run build

FROM node:22.22.0-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/slidev-hub/package.json ./apps/slidev-hub/package.json
COPY --from=build /app/apps/slidev-hub/dist ./apps/slidev-hub/dist
COPY --from=build /app/packages ./packages

EXPOSE 4310

CMD ["node", "apps/slidev-hub/dist/server/index.js"]
