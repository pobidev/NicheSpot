FROM node:20-alpine AS frontend
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=frontend /app/client/dist ./client/dist
RUN mkdir -p data
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
