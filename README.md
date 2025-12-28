# llmio

LLM API 网关，支持 OpenAI、Anthropic、Gemini 协议的统一代理和管理。

## 项目结构

- `llmio-node/`：Node.js 后端服务（Hono + PostgreSQL + Redis）
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

- Node.js 18+
- PostgreSQL 14+
- Redis（可选，用于缓存和日志队列）
- pnpm

### 2. 安装依赖

```bash
# 后端
cd llmio-node
pnpm install

# 前端
cd ../webui
pnpm install
```

### 3. 配置环境变量

```bash
cd llmio-node
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 服务器配置
PORT=7070
HOST=0.0.0.0

# 静态资源目录（前端构建产物）
STATIC_DIR=./dist

# 管理员 API Key
API_KEY=sk-your-admin-key

# PostgreSQL 配置
DATABASE_URL=postgresql://user:password@localhost:5432/llmio

# Redis 配置（可选）
REDIS_URL=redis://:password@localhost:6379
REDIS_PREFIX=llmio
REDIS_DEFAULT_TTL_SECONDS=1800
```

### 4. 初始化数据库

```bash
# 连接 PostgreSQL 执行建表脚本
psql $DATABASE_URL < schema.sql
```

### 5. 构建前端

```bash
cd webui
pnpm build

# 复制构建产物到后端
cp -r dist ../llmio-node/
```

### 6. 启动服务

```bash
cd llmio-node
pnpm run dev
```

访问 `http://localhost:7070/login`，使用 `API_KEY` 登录管理界面。

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
cd llmio-node
pnpm run dev

# 前端开发模式（另开终端）
cd webui
pnpm dev
```

前端开发服务器会自动代理 `/api` 请求到 `http://localhost:7070`。

## License

MIT
