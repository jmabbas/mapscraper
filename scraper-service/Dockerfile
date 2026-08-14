# Official Puppeteer image: Chromium + all system deps already set up correctly.
# npm install below will NOT re-download Chromium because its cache is
# pre-seeded and PUPPETEER_CACHE_DIR is already configured in this image.
#
# Running as root: we already launch Chromium with --no-sandbox, so the
# base image's non-root "pptruser" buys us nothing here and only causes
# permission conflicts with mounted volumes (data/, state/).
FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /usr/src/app

COPY package.json ./
RUN npm install

COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
