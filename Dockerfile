FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# La base de datos vive en /app/data: monta ahí un volumen para no perderla.
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "start"]
