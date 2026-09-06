FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY LICENSE ./LICENSE
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=8766 DATA_DIR=/app/data
EXPOSE 8766
VOLUME ["/app/data"]
CMD ["node", "--use-env-proxy", "src/server.js"]
