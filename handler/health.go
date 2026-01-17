package handler

import (
	"context"
	"log/slog"
	"slices"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/consts"
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

// HealthCheck 健康检查接口
func HealthCheck(c *gin.Context) {
	health := gin.H{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"version":   consts.Version,
		"service":   "llmio",
	}

	// 检查数据库连接
	if models.DB != nil {
		sqlDB, err := models.DB.DB()
		if err != nil {
			health["status"] = "error"
			health["database"] = "connection_error"
			health["error"] = err.Error()
			c.JSON(503, health)
			return
		}

		if err := sqlDB.Ping(); err != nil {
			health["status"] = "error"
			health["database"] = "ping_failed"
			health["error"] = err.Error()
			c.JSON(503, health)
			return
		}

		health["database"] = "ok"
	} else {
		health["status"] = "error"
		health["database"] = "not_initialized"
		c.JSON(503, health)
		return
	}

	c.JSON(200, health)
}

// ReadinessCheck 就绪检查接口
func ReadinessCheck(c *gin.Context) {
	ready := gin.H{
		"status":    "ready",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"version":   consts.Version,
		"service":   "llmio",
	}

	// 检查数据库连接和基本表是否存在
	if models.DB != nil {
		// 检查关键表是否存在
		var count int64
		// PostgreSQL：限定当前 schema（通常为 public）
		tableCheckSQL := "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('providers', 'models', 'auth_keys')"
		if err := models.DB.Raw(tableCheckSQL).Scan(&count).Error; err != nil {
			ready["status"] = "not_ready"
			ready["database"] = "table_check_failed"
			ready["error"] = err.Error()
			c.JSON(503, ready)
			return
		}

		if count < 3 {
			ready["status"] = "not_ready"
			ready["database"] = "missing_tables"
			ready["error"] = "Required tables not found"
			c.JSON(503, ready)
			return
		}

		ready["database"] = "ready"
	} else {
		ready["status"] = "not_ready"
		ready["database"] = "not_initialized"
		c.JSON(503, ready)
		return
	}

	c.JSON(200, ready)
}

// LivenessCheck 存活检查接口
func LivenessCheck(c *gin.Context) {
	liveness := gin.H{
		"status":    "alive",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"version":   consts.Version,
		"service":   "llmio",
		"uptime":    time.Since(startTime).String(),
	}

	c.JSON(200, liveness)
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

var startTime = time.Now()

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

	now := time.Now()
	windowStart := now.Add(-time.Duration(windowMinutes) * time.Minute)

	// 1) 一次性获取所有提供商
	var providers []models.Provider
	if err := models.DB.Where("deleted_at IS NULL").Find(&providers).Error; err != nil {
		result.Status = "unhealthy"
		return result
	}
	result.Total = len(providers)

	if len(providers) == 0 {
		return result
	}

	providerByID := make(map[uint]models.Provider, len(providers))
	providerNames := make([]string, 0, len(providers))
	for _, p := range providers {
		providerByID[p.ID] = p
		providerNames = append(providerNames, p.Name)
	}

	// 2) 一次性获取所有 model_with_providers 关联（避免 N+1）
	var modelProviders []models.ModelWithProvider
	if err := models.DB.Where("deleted_at IS NULL").Find(&modelProviders).Error; err != nil {
		result.Status = "unhealthy"
		return result
	}

	// 只保留 provider 存在的关联
	filteredMP := make([]models.ModelWithProvider, 0, len(modelProviders))
	modelIDSet := make(map[uint]struct{})
	providerModelSet := make(map[string]struct{})
	for _, mp := range modelProviders {
		if _, ok := providerByID[mp.ProviderID]; !ok {
			continue
		}
		filteredMP = append(filteredMP, mp)
		modelIDSet[mp.ModelID] = struct{}{}
		if mp.ProviderModel != "" {
			providerModelSet[mp.ProviderModel] = struct{}{}
		}
	}

	// 3) 一次性获取模型信息（id->name）
	modelIDs := make([]uint, 0, len(modelIDSet))
	for id := range modelIDSet {
		modelIDs = append(modelIDs, id)
	}
	var modelList []models.Model
	if len(modelIDs) > 0 {
		if err := models.DB.Where("id IN ? AND deleted_at IS NULL", modelIDs).Find(&modelList).Error; err != nil {
			result.Status = "unhealthy"
			return result
		}
	}
	modelNameByID := make(map[uint]string, len(modelList))
	modelNames := make([]string, 0, len(modelList))
	for _, m := range modelList {
		modelNameByID[m.ID] = m.Name
		modelNames = append(modelNames, m.Name)
	}

	providerModels := make([]string, 0, len(providerModelSet))
	for pm := range providerModelSet {
		providerModels = append(providerModels, pm)
	}

	// 4) 批量查询 chat_logs：用窗口函数取每组（provider_name,name,provider_model）最新 100 条
	type logRow struct {
		Name          string    `gorm:"column:name"`
		ProviderName  string    `gorm:"column:provider_name"`
		ProviderModel string    `gorm:"column:provider_model"`
		Status        string    `gorm:"column:status"`
		Error         string    `gorm:"column:error"`
		ProxyTimeMs   int       `gorm:"column:proxy_time_ms"`
		CreatedAt     time.Time `gorm:"column:created_at"`
	}

	type logKey struct {
		providerName  string
		modelName     string
		providerModel string
	}

	logsByKey := make(map[logKey][]logRow)
	if len(providerNames) > 0 && len(modelNames) > 0 && len(providerModels) > 0 {
		sql := `
SELECT name, provider_name, provider_model, status, error, proxy_time_ms, created_at
FROM (
  SELECT name, provider_name, provider_model, status, error, proxy_time_ms, created_at,
         row_number() OVER (PARTITION BY provider_name, name, provider_model ORDER BY created_at DESC) AS rn
  FROM chat_logs
  WHERE created_at >= ? AND deleted_at IS NULL
    AND provider_name IN (?)
    AND name IN (?)
    AND provider_model IN (?)
) t
WHERE rn <= 100
`
		var rows []logRow
		if err := models.DB.Raw(sql, windowStart, providerNames, modelNames, providerModels).Scan(&rows).Error; err != nil {
			// 日志查询失败会严重影响健康统计，直接标记为不健康
			result.Status = "unhealthy"
			return result
		}

		for _, r := range rows {
			k := logKey{
				providerName:  r.ProviderName,
				modelName:     r.Name,
				providerModel: r.ProviderModel,
			}
			logsByKey[k] = append(logsByKey[k], r)
		}
	}

	// 5) 内存聚合生成 ProviderHealth / ModelHealth（不再逐模型查询）
	healthByProviderID := make(map[uint]*ProviderHealth, len(providers))
	for _, p := range providers {
		healthByProviderID[p.ID] = &ProviderHealth{
			ID:        int(p.ID),
			Name:      p.Name,
			Type:      p.Type,
			Status:    "unknown",
			LastCheck: now.UTC().Format(time.RFC3339),
			Models:    []ModelHealth{},
		}
	}

	for _, mp := range filteredMP {
		p := providerByID[mp.ProviderID]
		modelName := modelNameByID[mp.ModelID]
		if modelName == "" {
			// 模型不存在/已删除：跳过
			continue
		}

		k := logKey{
			providerName:  p.Name,
			modelName:     modelName,
			providerModel: mp.ProviderModel,
		}
		rows := logsByKey[k]

		modelHealth := ModelHealth{
			ModelName:     modelName,
			ProviderModel: mp.ProviderModel,
			Status:        "unknown",
			LastCheck:     now.UTC().Format(time.RFC3339),
			RequestBlocks: []ModelHealthRequestBlock{},
		}

		modelHealth.TotalRequests = len(rows)
		totalResponseTime := 0.0
		var latestErrAt time.Time
		var latestErr string

		// blocks 需要从旧到新
		if len(rows) > 0 {
			slices.SortFunc(rows, func(a, b logRow) int {
				if a.CreatedAt.Before(b.CreatedAt) {
					return -1
				}
				if a.CreatedAt.After(b.CreatedAt) {
					return 1
				}
				return 0
			})
		}

		for _, r := range rows {
			isSuccess := r.Status == "success"
			if !isSuccess {
				modelHealth.FailedRequests++
				if latestErrAt.IsZero() || r.CreatedAt.After(latestErrAt) {
					latestErrAt = r.CreatedAt
					latestErr = r.Error
				}
			}
			modelHealth.RequestBlocks = append(modelHealth.RequestBlocks, ModelHealthRequestBlock{
				Success:   isSuccess,
				Timestamp: r.CreatedAt.UTC().Format(time.RFC3339),
			})
			if r.ProxyTimeMs > 0 {
				totalResponseTime += float64(r.ProxyTimeMs)
			}
		}

		if modelHealth.TotalRequests > 0 {
			modelHealth.SuccessRate = float64(modelHealth.TotalRequests-modelHealth.FailedRequests) / float64(modelHealth.TotalRequests) * 100
			modelHealth.AvgResponseTimeMs = totalResponseTime / float64(modelHealth.TotalRequests)

			if modelHealth.SuccessRate < 50 {
				modelHealth.Status = "unhealthy"
			} else if modelHealth.SuccessRate < 90 || modelHealth.AvgResponseTimeMs > 10000 {
				modelHealth.Status = "degraded"
			} else {
				modelHealth.Status = "healthy"
			}
		}
		if latestErrAt.IsZero() == false && latestErr != "" {
			modelHealth.LastError = stringPtr(latestErr)
		}

		ph := healthByProviderID[mp.ProviderID]
		ph.Models = append(ph.Models, modelHealth)
		ph.TotalRequests += modelHealth.TotalRequests
		ph.FailedRequests += modelHealth.FailedRequests
	}

	// 6) 计算每个 provider 的整体状态
	for _, p := range providers {
		ph := healthByProviderID[p.ID]

		// 平均响应时间：取有请求的模型的平均值
		totalAvg := 0.0
		count := 0
		for _, mh := range ph.Models {
			if mh.TotalRequests > 0 {
				totalAvg += mh.AvgResponseTimeMs
				count++
			}
		}
		if count > 0 {
			ph.ResponseTimeMs = int(totalAvg / float64(count))
		}

		if ph.TotalRequests > 0 {
			ph.ErrorRate = float64(ph.FailedRequests) / float64(ph.TotalRequests) * 100
		}

		if ph.TotalRequests == 0 {
			ph.Status = "unknown"
		} else if ph.ErrorRate > 50 {
			ph.Status = "unhealthy"
		} else if ph.ErrorRate > 10 || ph.ResponseTimeMs > 5000 {
			ph.Status = "degraded"
		} else {
			ph.Status = "healthy"
		}

		// 让模型列表输出更稳定（按 modelName+providerModel 排序）
		slices.SortFunc(ph.Models, func(a, b ModelHealth) int {
			if a.ModelName != b.ModelName {
				return stringsCompare(a.ModelName, b.ModelName)
			}
			return stringsCompare(a.ProviderModel, b.ProviderModel)
		})

		result.Details = append(result.Details, *ph)
		switch ph.Status {
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

// stringPtr 返回字符串指针
func stringPtr(s string) *string {
	return &s
}

func stringsCompare(a, b string) int {
	if a == b {
		return 0
	}
	if a < b {
		return -1
	}
	return 1
}
