package main

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/joho/godotenv"
	"github.com/racio/llmio/consts"
	"github.com/racio/llmio/handler"
	"github.com/racio/llmio/limiter"
	"github.com/racio/llmio/middleware"
	"github.com/racio/llmio/models"
	"github.com/racio/llmio/service"
	_ "golang.org/x/crypto/x509roots/fallback"
)

func init() {
	// 加载 .env 文件（如果存在）
	_ = godotenv.Load()

	ctx := context.Background()
	// PostgreSQL 连接串支持两种格式：
	// 1) key=value DSN: host=localhost user=postgres password=postgres dbname=llmio port=5432 sslmode=disable
	// 2) URL: postgres://postgres:postgres@localhost:5432/llmio?sslmode=disable
	dsn := os.Getenv("DATABASE_DSN")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/llmio?sslmode=disable"
	}
	models.Init(ctx, dsn)

	// 初始化首次部署时间（持久化到数据库 configs 表），用于跨重启统计系统总运行时间。
	if _, err := service.GetOrInitFirstDeployTime(ctx); err != nil {
		slog.Warn("Failed to init first deploy time, will fallback at runtime", "error", err)
	}

	// 初始化Redis客户端（可选）
	var redisClient *redis.Client
	redisURL := os.Getenv("REDIS_URL")
	if redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			slog.Warn("Failed to parse Redis URL, using memory storage", "error", err)
		} else {
			redisClient = redis.NewClient(opt)
			// 测试Redis连接
			if err := redisClient.Ping(ctx).Err(); err != nil {
				slog.Warn("Redis connection failed, using memory storage", "error", err)
				redisClient = nil
			} else {
				slog.Info("Redis connected successfully")
			}
		}
	}

	// 初始化限流管理器
	limiterManager := limiter.NewManager(redisClient)
	service.SetLimiterManager(limiterManager)

	slog.Info("TZ", "time.Local", time.Local.String())
}

func main() {
	router := gin.Default()

	router.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{"/openai", "/anthropic", "/gemini", "/v1"})))

	token := os.Getenv("TOKEN")

	// 健康检查接口（无需认证）
	router.GET("/health", handler.HealthCheck)
	router.GET("/health/live", handler.LivenessCheck)
	router.GET("/health/ready", handler.ReadinessCheck)
	router.GET("/health/detail", handler.GetSystemHealthDetail)
	// 兼容性路由
	router.GET("/healthz", handler.HealthCheck)
	router.GET("/livez", handler.LivenessCheck)
	router.GET("/readyz", handler.ReadinessCheck)

	// API健康检查接口（无需认证，为了兼容前端）
	router.GET("/api/health/detail", handler.GetSystemHealthDetail)

	authOpenAI := middleware.AuthOpenAI(token)
	authAnthropic := middleware.AuthAnthropic(token)
	authGemini := middleware.AuthGemini(token)

	// openai
	openai := router.Group("/openai", authOpenAI)
	{
		v1 := openai.Group("/v1")
		{
			v1.GET("/models", handler.OpenAIModelsHandler)
			v1.POST("/chat/completions", handler.ChatCompletionsHandler)
			v1.POST("/responses", handler.ResponsesHandler)
		}
	}

	// anthropic
	anthropic := router.Group("/anthropic", authAnthropic)
	{
		// claude code logging
		anthropic.POST("/api/event_logging/batch", handler.EventLogging)

		v1 := anthropic.Group("/v1")
		{
			v1.GET("/models", handler.AnthropicModelsHandler)
			v1.POST("/messages", handler.Messages)
			v1.POST("/messages/count_tokens", handler.CountTokens)
		}
	}

	// gemini
	gemini := router.Group("/gemini", authGemini)
	{
		v1beta := gemini.Group("/v1beta")
		v1beta.GET("/models", handler.GeminiModelsHandler)
		v1beta.POST("/models/*modelAction", handler.GeminiGenerateContentHandler)
	}

	// 兼容性保留
	v1 := router.Group("/v1")
	{
		v1.GET("/models", authOpenAI, handler.OpenAIModelsHandler)
		v1.POST("/chat/completions", authOpenAI, handler.ChatCompletionsHandler)
		v1.POST("/responses", authOpenAI, handler.ResponsesHandler)
		v1.POST("/messages", authAnthropic, handler.Messages)
		v1.POST("/messages/count_tokens", authAnthropic, handler.CountTokens)
	}

	api := router.Group("/api")
	{
		api.Use(middleware.Auth(token))
		api.GET("/metrics/use/:days", handler.Metrics)
		api.GET("/metrics/counts", handler.Counts)
		api.GET("/metrics/projects", handler.ProjectCounts)

		// Provider management
		api.GET("/providers/template", handler.GetProviderTemplates)
		api.GET("/providers", handler.GetProviders)
		api.GET("/providers/models/:id", handler.GetProviderModels)
		api.POST("/providers", handler.CreateProvider)
		api.PUT("/providers/:id", handler.UpdateProvider)
		api.DELETE("/providers/:id", handler.DeleteProvider)

		// Model management
		api.GET("/models", handler.GetModels)
		api.GET("/models/select", handler.GetModelList)
		api.POST("/models", handler.CreateModel)
		api.PUT("/models/:id", handler.UpdateModel)
		api.DELETE("/models/:id", handler.DeleteModel)

		// Model-provider association management
		api.GET("/model-providers", handler.GetModelProviders)
		api.GET("/model-providers/status", handler.GetModelProviderStatus)
		api.POST("/model-providers", handler.CreateModelProvider)
		api.PUT("/model-providers/:id", handler.UpdateModelProvider)
		api.PATCH("/model-providers/:id/status", handler.UpdateModelProviderStatus)
		api.DELETE("/model-providers/:id", handler.DeleteModelProvider)

		// System status and monitoring
		api.GET("/version", handler.GetVersion)
		api.GET("/logs", handler.GetRequestLogs)
		api.GET("/logs/:id/chat-io", handler.GetChatIO)
		api.GET("/user-agents", handler.GetUserAgents)
		api.POST("/logs/cleanup", handler.CleanLogs)

		// Auth key management
		api.GET("/auth-keys", handler.GetAuthKeys)
		api.GET("/auth-keys/list", handler.GetAuthKeysList)
		api.POST("/auth-keys", handler.CreateAuthKey)
		api.PUT("/auth-keys/:id", handler.UpdateAuthKey)
		api.PATCH("/auth-keys/:id/status", handler.ToggleAuthKeyStatus)
		api.DELETE("/auth-keys/:id", handler.DeleteAuthKey)

		// Config management
		api.GET("/config/:key", handler.GetConfigByKey)
		api.PUT("/config/:key", handler.UpdateConfigByKey)

		// Limiter management and monitoring
		api.GET("/limiter/stats", handler.GetLimiterStats)
		api.GET("/limiter/health", handler.GetLimiterHealth)
		api.GET("/providers/:id/rpm-count", handler.GetProviderRPMCount)
		api.GET("/providers/:id/ip-lock", handler.GetProviderIPLockStatus)
		api.DELETE("/providers/:id/ip-lock", handler.ClearProviderIPLock)

		// Provider connectivity test
		api.GET("/test/:id", handler.ProviderTestHandler)
		api.GET("/test/react/:id", handler.TestReactHandler)
		api.GET("/test/count_tokens", handler.TestCountTokens)
	}
	setwebui(router)

	port := os.Getenv("LLMIO_SERVER_PORT")
	if port == "" {
		port = consts.DefaultPort
	}
	router.Run(":" + port)
}

//go:embed webui/dist
var distFiles embed.FS

//go:embed webui/dist/index.html
var indexHTML []byte

func setwebui(r *gin.Engine) {
	subFS, err := fs.Sub(distFiles, "webui/dist/assets")
	if err != nil {
		panic(err)
	}

	r.StaticFS("/assets", http.FS(subFS))

	r.NoRoute(func(c *gin.Context) {
		if c.Request.Method == http.MethodGet && !strings.HasPrefix(c.Request.URL.Path, "/api/") && !strings.HasPrefix(c.Request.URL.Path, "/v1/") {
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
			return
		}
		c.Data(http.StatusNotFound, "text/html; charset=utf-8", []byte("404 Not Found"))
	})
}
