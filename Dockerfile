FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=false

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates \
     fonts-liberation \
     fonts-noto-color-emoji \
     libasound2 \
     libatk-bridge2.0-0 \
     libatk1.0-0 \
     libc6 \
     libcairo2 \
     libcups2 \
     libdbus-1-3 \
     libdrm2 \
     libgbm1 \
     libglib2.0-0 \
     libgtk-3-0 \
     libnspr4 \
     libnss3 \
     libpango-1.0-0 \
     libu2f-udev \
     libvulkan1 \
     libx11-6 \
     libx11-xcb1 \
     libxcb1 \
     libxcomposite1 \
     libxdamage1 \
     libxext6 \
     libxfixes3 \
     libxkbcommon0 \
     libxrandr2 \
     xdg-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY public ./public

RUN mkdir -p /app/data

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server.js"]
