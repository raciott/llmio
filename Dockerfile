# syntax=docker/dockerfile:1.6

############################
# 1) 构建 WebUI（Vite）
############################
FROM node:20-alpine AS webui-builder

WORKDIR /src/webui

# 先拷贝锁文件，利用缓存加速依赖安装
COPY webui/package.json webui/package-lock.json ./
RUN npm ci

# 再拷贝源码并构建
COPY webui/ ./
RUN npm run build

############################
# 2) 构建 Go 后端（包含 embed 的 webui/dist）
############################
FROM golang:1.25-alpine AS go-builder

WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN go mod download

# 拷贝后端源码
COPY . .

# 用最新构建的前端产物覆盖仓库内的 dist（embed 在编译期读取）
COPY --from=webui-builder /src/webui/dist ./webui/dist

RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/llmio .

############################
# 3) 运行镜像
############################
FROM alpine:3.20

RUN apk add --no-cache ca-certificates \
  && adduser -D -H -u 10001 llmio

WORKDIR /app

COPY --from=go-builder /out/llmio ./llmio

USER llmio

# 默认端口（可通过 LLMIO_SERVER_PORT 覆盖）
ENV LLMIO_SERVER_PORT=7070

EXPOSE 7070

ENTRYPOINT ["./llmio"]

