# llmio

LLM API 网关（Go + Gin），支持 OpenAI / Anthropic / Gemini 协议的统一代理与管理，并提供内置 WebUI 管理界面（前端产物会被打包进二进制）。

## 项目结构

- `main.go`/`handler/`/`service/`：Go 后端服务
- `models/`：数据库模型与初始化逻辑（支持 PostgreSQL / MySQL 二选一）
- `webui/`：前端管理界面（Vite + React + shadcn/ui），构建后产物位于 `webui/dist/`

## 功能特性

- 多协议代理：OpenAI `/v1/chat/completions`、Anthropic `/v1/messages`、Gemini 原生接口
- 多提供商/多模型管理：按模型关联多个提供商模型，支持权重、开关、能力标签（工具/结构化/视觉/请求头透传）
- 路由与容灾：按策略选择提供商，失败可重试并切换
- 限流与锁定（可选 Redis）：RPM 限流、IP 锁定、Token 独占锁（用于 2 分钟内“同一 Token 固定同一供应商/模型”）
- 可观测性：请求日志、统计、健康检查与健康详情页

## 快速开始

### 1. 环境要求

- Go 1.25+
- PostgreSQL 14+ 或 MySQL 8+（二选一）
- Redis（可选：用于 RPM/IP/Token 锁；不配置则退化为内存实现）
- Node.js 20+（仅在你需要从源码构建 WebUI 时需要）

### 2. 初始化数据库表结构

本项目不自动迁移表结构，请先执行初始化 SQL：

```bash
# PostgreSQL
psql -d llmio -f init_database_production.sql

# MySQL
mysql -u root -p llmio < init_database_mysql.sql
```

### 3. 配置环境变量

复制并编辑根目录的 `.env`：

```bash
cp .env.example .env
```

最小可用配置（PostgreSQL 示例）：

```env
DATABASE_TYPE=postgres
DATABASE_DSN=postgres://postgres:postgres@localhost:5432/llmio?sslmode=disable
TOKEN=your_token_here
```

MySQL 示例：

```env
DATABASE_TYPE=mysql
DATABASE_DSN=root:root@tcp(localhost:3306)/llmio?charset=utf8mb4&parseTime=True&loc=Local
TOKEN=your_token_here
```

Redis（可选）推荐使用标准 URL 格式：

```env
REDIS_URL=redis://localhost:6379/0
```

### 4. 启动

```bash
go run .
```

启动后访问：
- WebUI：`http://127.0.0.1:7070/`
- 健康检查：`http://127.0.0.1:7070/health`
- 健康详情：`http://127.0.0.1:7070/health/detail`（前端兼容路径：`/api/health/detail`）

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
  -e "DATABASE_TYPE=postgres" \
  -e "DATABASE_DSN=postgres://postgres:postgres@host.docker.internal:5432/llmio?sslmode=disable" \
  -e "REDIS_URL=redis://host.docker.internal:6379/0" \
  llmio:latest
```

必需环境变量（建议显式配置）：
- `DATABASE_TYPE`：数据库类型，`postgres` / `mysql`（默认 `postgres`）
- `DATABASE_DSN`：数据库连接串（见 `.env.example`）
- `TOKEN`：管理端与代理接口鉴权 Token（可为空：不鉴权，个人使用不推荐暴露公网）

可选环境变量：
- `REDIS_URL`：Redis URL（用于 RPM/IP/Token 锁；不配置则使用内存）
- `LLMIO_SERVER_PORT`：服务端口（默认 `7070`）
- `TRUSTED_PROXIES`：可信代理 IP/CIDR（反代部署时用于正确获取客户端真实 IP，影响 IP 锁定）

## API 端点

说明：
- 代理接口的鉴权 Key 来自数据库 `auth_keys` 表（可通过 WebUI 创建）。
- 若请求携带的 Key 等于 `TOKEN`（或未设置 `TOKEN`），则视为管理员 Key，可访问全部模型。
- 管理接口统一使用 `/api/*`，鉴权头为 `Authorization: Bearer ${TOKEN}`（WebUI 登录后会自动携带）。

### OpenAI 兼容

```bash
# Chat Completions
curl http://localhost:7070/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'

# Embeddings
curl http://localhost:7070/v1/embeddings \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "text-embedding-3-small", "input": "Hello"}'

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

# Embeddings（Gemini 原生）
curl "http://localhost:7070/gemini/v1beta/models/text-embedding-004:embedContent?key=sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"content": {"parts": [{"text": "Hello"}]}}'
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

从源码构建内置 WebUI（用于 `go build`/Docker 内置页面）：

```bash
npm -C webui install
npm -C webui run build
go build .
```

## License

MIT
