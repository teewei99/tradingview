FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json .
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
COPY server.mjs .
ENV NODE_ENV=production
ENV DATA_DIR=/data
CMD ["node", "server.mjs"]
