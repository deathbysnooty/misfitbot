FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip && \
    pip3 install --break-system-packages yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["node", "index.mjs"]
