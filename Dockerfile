# The five demo apps: one Node server, no build step. Settings come from the
# environment (the pod's env in Kubernetes), not from a .env file.
FROM node:20-slim

ENV NODE_ENV=production \
    PORT=3333
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY usecases ./usecases
COPY public ./public

USER node
EXPOSE 3333
CMD ["node", "server.js"]
