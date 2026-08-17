FROM ghcr.io/puppeteer/puppeteer:23.4.0

USER root
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Ensure data and output directories exist with proper permissions
RUN mkdir -p /app/data /app/output /app/input && chown -R pptruser:pptruser /app

USER pptruser

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
