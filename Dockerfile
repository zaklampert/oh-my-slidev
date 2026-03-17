FROM node:22.22.0-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY packages/shared-types ./packages/shared-types

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

FROM node:22.22.0-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 4310

CMD ["node", "dist/server/index.js"]
