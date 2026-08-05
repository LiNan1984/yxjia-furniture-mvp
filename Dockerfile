# 银杏家具 MVP - Dockerfile
# 用 node:22-alpine 单容器部署（数据上传目录写入外挂 volume）
FROM node:22-alpine

WORKDIR /app

# 先拷贝依赖描述以利用缓存
COPY package*.json ./

RUN npm install --omit=dev --no-audit --no-fund

# 拷贝源码
COPY src/ ./src/
COPY public/ ./public/
COPY data/ ./data/
COPY README.md ./

# 上传文件目录（运行时由 server 自动创建，确保存在）
RUN mkdir -p uploads/products uploads/rooms uploads/compositions

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
