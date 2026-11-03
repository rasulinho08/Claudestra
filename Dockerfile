# Claudestra for a team server (docs/12 "Deploy"). Build: docker compose up -d --build
FROM node:22-bookworm-slim
WORKDIR /app
# git + bash for agents' tools; tini to stop child processes cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends git bash ca-certificates tini python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
RUN npm ci
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PORT=8787 PREVIEW_PORT=8788
EXPOSE 8787 8788
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
