FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4021
EXPOSE 4021
CMD ["node", "src/server.js"]
