FROM ghcr.io/puppeteer/puppeteer:23.11.1
USER root
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
COPY package*.json ./
RUN npm install
COPY . .
RUN mkdir -p /app/session && chown -R pptruser:pptruser /app
EXPOSE 3000
CMD ["sh", "-c", "chown -R pptruser:pptruser /app/session && su -s /bin/sh pptruser -c 'node server.js'"]
