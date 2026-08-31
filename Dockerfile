FROM ghcr.io/puppeteer/puppeteer:21.11.0
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
