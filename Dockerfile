# syntax=docker/dockerfile:1.6

############################
# 1) 构建 WebUI（Vite）
############################
FROM node:20-alpine AS webui-builder

LABEL "language"="nodejs"
LABEL "framework"="golang"

WORKDIR /src/webui

COPY webui/package.json webui/package-lock.json ./
RUN npm ci

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

COPY . .

COPY --from=webui-builder /src/webui/dist ./webui/dist

RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/llmio .

############################
# 3) 运行镜像
############################
FROM alpine:3.20

RUN apk add --no-cache ca-certificates && \
    adduser -D -H -u 10001 llmio

WORKDIR /app

COPY --from=go-builder /out/llmio ./llmio

USER llmio

EXPOSE 7070

ENTRYPOINT ["./llmio"]