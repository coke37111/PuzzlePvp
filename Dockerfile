FROM node:20-alpine

WORKDIR /app

# 루트 및 각 패키지의 package.json 복사 (레이어 캐싱 활용)
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm install

# 소스 전체 복사
COPY . .

# 빌드
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/server/dist/index.js"]
