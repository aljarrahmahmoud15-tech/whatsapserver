FROM ghcr.io/puppeteer/puppeteer:23.11.1

USER root

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/session

EXPOSE 3000
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
# Stay as root at container start, fix permissions, then drop to pptruser to actually run the app
CMD ["sh", "-c", "chown -R pptruser:pptruser /app/session && su -s /bin/sh pptruser -c 'node server.js'"]
