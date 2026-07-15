FROM apify/actor-node:20

COPY --chown=myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm ci --include=dev --omit=optional \
    && echo "Node.js version:" \
    && node --version

COPY --chown=myuser . ./

RUN npm run build \
    && npm prune --omit=dev

CMD ["node", "dist/main.js"]
