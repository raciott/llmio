package handler

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/models"
	"github.com/racio/llmio/service"
)

// ComponentStatus 组件状态
type ComponentStatus struct {
	Status         string  `json:"status"`
	Message        *string `json:"message,omitempty"`
	ResponseTimeMs *int    `json:"responseTimeMs,omitempty"`
}

// ModelHealthRequestBlock 模型健康请求块
type ModelHealthRequestBlock struct {
	Success   bool   `json:"success"`
	Timestamp string `json:"timestamp"`
}

// ModelHealth 模型健康状态
type ModelHealth struct {
	ModelName         string                    `json:"modelName"`
	ProviderModel     string                    `json:"providerModel"`
	Status            string                    `json:"status"`
	TotalRequests     int                       `json:"totalRequests"`
	FailedRequests    int                       `json:"failedRequests"`
	SuccessRate       float64                   `json:"successRate"`
	AvgResponseTimeMs float64                   `json:"avgResponseTimeMs"`
	LastCheck         string                    `json:"lastCheck"`
	LastError         *string                   `json:"lastError,omitempty"`
	RequestBlocks     []ModelHealthRequestBlock `json:"requestBlocks"`
}

// ProviderHealth 提供商健康状态
type ProviderHealth struct {
	ID             int           `json:"id"`
	Name           string        `json:"name"`
	Type           string        `json:"type"`
	Status         string        `json:"status"`
	LastCheck      string        `json:"lastCheck"`
	ResponseTimeMs int           `json:"responseTimeMs"`
	ErrorRate      float64       `json:"errorRate"`
	TotalRequests  int           `json:"totalRequests"`
	FailedRequests int           `json:"failedRequests"`
	LastError      *string       `json:"lastError,omitempty"`
	Models         []ModelHealth `json:"models"`
}

// SystemHealth 系统健康状态
type SystemHealth struct {
	Status          string `json:"status"`
	Timestamp       string `json:"timestamp"`
	Uptime          int    `json:"uptime"`
	ProcessUptime   int    `json:"processUptime"`
	FirstDeployTime string `json:"firstDeployTime"`
	Components      struct {
		Database  ComponentStatus `json:"database"`
		Redis     ComponentStatus `json:"redis"`
		Providers struct {
			Status    string           `json:"status"`
			Total     int              `json:"total"`
			Healthy   int              `json:"healthy"`
			Degraded  int              `json:"degraded"`
			Unhealthy int              `json:"unhealthy"`
			Details   []ProviderHealth `json:"details"`
		} `json:"providers"`
	} `json:"components"`
}

// GetSystemHealthDetail 获取系统健康详情
func GetSystemHealthDetail(c *gin.Context) {
	// 获取时间窗口参数（分钟）
	windowStr := c.Query("window")
	windowMinutes := 1440 // 默认24小时
	if windowStr != "" {
		if w, err := strconv.Atoi(windowStr); err == nil && w > 0 {
			windowMinutes = w
		}
	}

	now := time.Now()
	nowUTC := now.UTC()

	firstDeployTime := nowUTC
	if t, err := service.GetOrInitFirstDeployTime(c.Request.Context()); err != nil {
		slog.Warn("failed to get first deploy time from database, fallback to now", "error", err)
	} else {
		firstDeployTime = t
	}

	uptimeSeconds := int(nowUTC.Sub(firstDeployTime).Seconds())
	if uptimeSeconds < 0 {
		uptimeSeconds = 0
	}
	health := SystemHealth{
		Status:          "healthy",
		Timestamp:       nowUTC.Format(time.RFC3339),
		Uptime:          uptimeSeconds,
		ProcessUptime:   int(now.Sub(startTime).Seconds()),
		FirstDeployTime: firstDeployTime.UTC().Format(time.RFC3339),
	}

	// 检查数据库状态
	health.Components.Database = checkDatabaseHealth()

	// 检查Redis状态（如果使用）
	health.Components.Redis = checkRedisHealth()

	// 检查提供商状态
	health.Components.Providers = checkProvidersHealth(windowMinutes)

	// 根据组件状态确定整体状态
	if health.Components.Database.Status == "unhealthy" ||
		health.Components.Providers.Status == "unhealthy" {
		health.Status = "unhealthy"
	} else if health.Components.Database.Status == "degraded" ||
		health.Components.Providers.Status == "degraded" {
		health.Status = "degraded"
	}

	c.JSON(200, health)
}

// checkDatabaseHealth 检查数据库健康状态
func checkDatabaseHealth() ComponentStatus {
	if models.DB == nil {
		return ComponentStatus{
			Status:  "unhealthy",
			Message: stringPtr("Database not initialized"),
		}
	}

	start := time.Now()
	sqlDB, err := models.DB.DB()
	if err != nil {
		return ComponentStatus{
			Status:  "unhealthy",
			Message: stringPtr("Failed to get database connection: " + err.Error()),
		}
	}

	if err := sqlDB.Ping(); err != nil {
		return ComponentStatus{
			Status:  "unhealthy",
			Message: stringPtr("Database ping failed: " + err.Error()),
		}
	}

	responseTime := int(time.Since(start).Milliseconds())

	status := "healthy"
	if responseTime > 1000 {
		status = "degraded"
	}

	return ComponentStatus{
		Status:         status,
		ResponseTimeMs: &responseTime,
	}
}

// checkRedisHealth 检查Redis健康状态
func checkRedisHealth() ComponentStatus {
	redisClient := service.GetRedisClient()
	if redisClient == nil {
		return ComponentStatus{
			Status:  "healthy",
			Message: stringPtr("Redis not configured"),
		}
	}

	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		return ComponentStatus{
			Status:  "unhealthy",
			Message: stringPtr("Redis ping failed: " + err.Error()),
		}
	}

	responseTime := int(time.Since(start).Milliseconds())

	status := "healthy"
	if responseTime > 1000 {
		status = "degraded"
	}

	return ComponentStatus{
		Status:         status,
		ResponseTimeMs: &responseTime,
	}
}

// checkProvidersHealth 检查提供商健康状态
func checkProvidersHealth(windowMinutes int) struct {
	Status    string           `json:"status"`
	Total     int              `json:"total"`
	Healthy   int              `json:"healthy"`
	Degraded  int              `json:"degraded"`
	Unhealthy int              `json:"unhealthy"`
	Details   []ProviderHealth `json:"details"`
} {
	result := struct {
		Status    string           `json:"status"`
		Total     int              `json:"total"`
		Healthy   int              `json:"healthy"`
		Degraded  int              `json:"degraded"`
		Unhealthy int              `json:"unhealthy"`
		Details   []ProviderHealth `json:"details"`
	}{
		Status:  "healthy",
		Details: []ProviderHealth{},
	}

	// 获取所有提供商
	var providers []models.Provider
	if err := models.DB.Where("deleted_at IS NULL").Find(&providers).Error; err != nil {
		result.Status = "unhealthy"
		return result
	}

	result.Total = len(providers)
	windowStart := time.Now().Add(-time.Duration(windowMinutes) * time.Minute)

	for _, provider := range providers {
		providerHealth := checkProviderHealth(provider, windowStart)
		result.Details = append(result.Details, providerHealth)

		switch providerHealth.Status {
		case "healthy":
			result.Healthy++
		case "degraded":
			result.Degraded++
		case "unhealthy":
			result.Unhealthy++
		}
	}

	// 确定整体提供商状态
	if result.Unhealthy > 0 {
		if result.Unhealthy >= result.Total/2 {
			result.Status = "unhealthy"
		} else {
			result.Status = "degraded"
		}
	} else if result.Degraded > 0 {
		result.Status = "degraded"
	}

	return result
}

// checkProviderHealth 检查单个提供商健康状态
func checkProviderHealth(provider models.Provider, windowStart time.Time) ProviderHealth {
	now := time.Now()
	health := ProviderHealth{
		ID:        int(provider.ID),
		Name:      provider.Name,
		Type:      provider.Type,
		Status:    "unknown",
		LastCheck: now.UTC().Format(time.RFC3339),
		Models:    []ModelHealth{},
	}

	// 获取该提供商的模型关联
	var modelProviders []models.ModelWithProvider
	if err := models.DB.Where("provider_id = ? AND deleted_at IS NULL", provider.ID).Find(&modelProviders).Error; err != nil {
		health.Status = "unhealthy"
		health.LastError = stringPtr("Failed to load models: " + err.Error())
		return health
	}

	totalRequests := 0
	failedRequests := 0
	totalResponseTime := 0.0
	requestCount := 0

	// 检查每个模型的健康状态
	for _, mp := range modelProviders {
		// 获取模型信息
		var model models.Model
		if err := models.DB.Where("id = ?", mp.ModelID).First(&model).Error; err != nil {
			continue
		}

		modelHealth := checkModelHealth(model.Name, provider.Name, windowStart)
		health.Models = append(health.Models, modelHealth)

		totalRequests += modelHealth.TotalRequests
		failedRequests += modelHealth.FailedRequests
		if modelHealth.TotalRequests > 0 {
			totalResponseTime += modelHealth.AvgResponseTimeMs
			requestCount++
		}
	}

	health.TotalRequests = totalRequests
	health.FailedRequests = failedRequests

	if totalRequests > 0 {
		health.ErrorRate = float64(failedRequests) / float64(totalRequests) * 100
	}

	if requestCount > 0 {
		health.ResponseTimeMs = int(totalResponseTime / float64(requestCount))
	}

	// 确定提供商状态
	if totalRequests == 0 {
		health.Status = "unknown"
	} else if health.ErrorRate > 50 {
		health.Status = "unhealthy"
	} else if health.ErrorRate > 10 || health.ResponseTimeMs > 5000 {
		health.Status = "degraded"
	} else {
		health.Status = "healthy"
	}

	return health
}

// checkModelHealth 检查单个模型健康状态
func checkModelHealth(modelName, providerName string, windowStart time.Time) ModelHealth {
	now := time.Now()
	health := ModelHealth{
		ModelName:     modelName,
		ProviderModel: modelName, // 简化处理
		Status:        "unknown",
		LastCheck:     now.UTC().Format(time.RFC3339),
		RequestBlocks: []ModelHealthRequestBlock{},
	}

	// 查询该模型在时间窗口内的请求日志
	var logs []models.ChatLog
	err := models.DB.Where("name = ? AND provider_name = ? AND created_at >= ? AND deleted_at IS NULL",
		modelName, providerName, windowStart).
		Order("created_at DESC").
		Limit(100).
		Find(&logs).Error

	if err != nil {
		health.Status = "unhealthy"
		health.LastError = stringPtr("Failed to query logs: " + err.Error())
		return health
	}

	health.TotalRequests = len(logs)
	totalResponseTime := 0.0

	for _, log := range logs {
		isSuccess := log.Status == "success"
		if !isSuccess {
			health.FailedRequests++
		}

		// 添加请求块
		health.RequestBlocks = append(health.RequestBlocks, ModelHealthRequestBlock{
			Success:   isSuccess,
			Timestamp: log.CreatedAt.UTC().Format(time.RFC3339),
		})

		// 计算平均响应时间
		if log.ProxyTimeMs > 0 {
			totalResponseTime += float64(log.ProxyTimeMs)
		}
	}

	if health.TotalRequests > 0 {
		health.SuccessRate = float64(health.TotalRequests-health.FailedRequests) / float64(health.TotalRequests) * 100
		health.AvgResponseTimeMs = totalResponseTime / float64(health.TotalRequests)

		// 确定模型状态
		if health.SuccessRate < 50 {
			health.Status = "unhealthy"
		} else if health.SuccessRate < 90 || health.AvgResponseTimeMs > 10000 {
			health.Status = "degraded"
		} else {
			health.Status = "healthy"
		}
	}

	return health
}

// stringPtr 返回字符串指针
func stringPtr(s string) *string {
	return &s
}
