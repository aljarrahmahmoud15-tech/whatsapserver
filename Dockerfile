FROM ghcr.io/puppeteer/puppeteer:21.11.0
USER root
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/session && chown -R pptruser:pptruser /app
USER pptruser
EXPOSE 3000
CMD ["node", "server.js"]
