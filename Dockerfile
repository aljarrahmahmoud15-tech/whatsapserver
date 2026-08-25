FROM ghcr.io/puppeteer/puppeteer:21.11.0
USER root
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PORT=10000
RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache && chown -R pptruser:pptruser /app
USER pptruser
EXPOSE 10000
CMD ["node", "server.js"]
