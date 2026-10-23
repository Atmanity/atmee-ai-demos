# The demo site: every app on one Node server. server/index.ts runs the fourteen
# mini-apps (pages built with Vite) and mounts the five apps' server.js in the
# same process. Settings come from the environment (the pod's env in
# Kubernetes), not from a .env file.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    SITE_PORT=3333
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js tsconfig.json ./
COPY usecases ./usecases
COPY public ./public
COPY server ./server
COPY src ./src
COPY apps ./apps
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3333
CMD ["node", "--import", "tsx", "server/index.ts"]
