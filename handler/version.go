package handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/common"
	"github.com/racio/llmio/consts"
	"github.com/racio/llmio/models"
)

func GetVersion(c *gin.Context) {
	common.Success(c, consts.Version)
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
		if err := models.DB.Raw("SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('providers', 'models', 'auth_keys')").Scan(&count).Error; err != nil {
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

var startTime = time.Now()
