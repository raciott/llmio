# llmio

LLM API 网关（Go + Gin），支持 OpenAI、Anthropic、Gemini 协议的统一代理与管理，并提供 WebUI 管理界面。

## 项目结构

- `main.go`/`handler/`/`service/`：Go 后端服务
- `webui/`：前端管理界面（Vite + React + shadcn/ui）

## 功能特性

- 多协议支持：OpenAI `/v1/chat/completions`、Anthropic `/v1/messages`、Gemini
- 多提供商负载均衡（加权轮询、抽签策略）
- 熔断器模式，自动剔除故障节点
- API Key 管理，支持模型白名单
- 请求日志与统计
- Redis 缓存加速

## 快速开始

### 1. 环境要求

- Go 1.25+
- PostgreSQL 14+
- Redis（可选，用于 RPM 限流和 IP 锁定）

### 2. 配置环境变量

复制并编辑根目录的 `.env`：

```bash
cp .env.example .env
```

PostgreSQL 推荐使用 URL 形式（更直观，也和 Redis 一致）：

```env
DATABASE_DSN=postgres://postgres:postgres@localhost:5432/llmio?sslmode=disable
```

其中 Redis 推荐使用标准 URL 格式（你提到的传统写法）：

```env
REDIS_URL=redis://localhost:6379/0
```

### 3. 启动

```bash
go run .
```

## Docker 部署

构建镜像：

```bash
docker build -t llmio:latest .
```

启动容器（示例）：

```bash
docker run --rm -p 7070:7070 \
  -e "LLMIO_SERVER_PORT=7070" \
  -e "TOKEN=your_token_here" \
  -e "DATABASE_DSN=postgres://postgres:postgres@host.docker.internal:5432/llmio?sslmode=disable" \
  -e "REDIS_URL=redis://host.docker.internal:6379/0" \
  llmio:latest
```

必需环境变量：
- `DATABASE_DSN`：PostgreSQL 连接串（推荐 URL 形式）
- `TOKEN`：管理端与代理接口鉴权 Token

可选环境变量：
- `REDIS_URL`：Redis URL（用于 RPM 限流与 IP 锁定；不配置则使用内存）
- `LLMIO_SERVER_PORT`：服务端口（默认 `7070`）

## API 端点

### OpenAI 兼容

```bash
# Chat Completions
curl http://localhost:7070/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'

# Models
curl http://localhost:7070/v1/models \
  -H "Authorization: Bearer sk-your-key"
```

### Anthropic 兼容

```bash
curl http://localhost:7070/v1/messages \
  -H "x-api-key: sk-your-key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-3-opus", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}]}'
```

### Gemini 兼容

```bash
curl "http://localhost:7070/gemini/v1beta/models/gemini-pro:generateContent?key=sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"contents": [{"parts": [{"text": "Hello"}]}]}'
```

## 开发

```bash
# 后端开发模式
go run .

# 前端开发模式（另开终端）
npm -C webui install
npm -C webui run dev
```

前端开发服务器会通过 `/api` 访问后端接口（确保后端已启动在 `7070`）。

## License

MIT
