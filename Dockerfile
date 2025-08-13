# 使用 Node 官方镜像，避免 Alpine 构建依赖冲突
FROM node:16-alpine

# 设置工作目录
WORKDIR /app

# 先复制 package.json 和 package-lock.json
COPY package*.json ./

# 使用腾讯 npm 源（提升安装速度）
RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ \
 && npm install --production

# 复制代码到容器
COPY . .

# 暴露端口（需与微信云托管配置一致）
EXPOSE 80

# 启动应用
CMD ["node", "index.js"]
