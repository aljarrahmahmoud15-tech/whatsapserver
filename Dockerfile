FROM ghcr.io/puppeteer/puppeteer:23.11.1

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]

