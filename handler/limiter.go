package handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/common"
	"github.com/racio/llmio/service"
)

// GetLimiterStats 获取限流器统计信息
func GetLimiterStats(c *gin.Context) {
	ctx := c.Request.Context()
	stats := service.GetRPMStats(ctx)
	common.Success(c, stats)
}

type ProviderStatsRequest struct {
	ProviderIDs []uint `json:"provider_ids"`
}

type ProviderStatsItem struct {
	ProviderID   uint       `json:"provider_id"`
	RPMCount     int        `json:"rpm_count"`
	RPMLoaded    bool       `json:"rpm_loaded"`
	Locked       bool       `json:"locked"`
	IPLockLoaded bool       `json:"ip_lock_loaded"`
	LockUntil    *time.Time `json:"lock_until,omitempty"`
}

// GetProvidersStats 批量获取提供商 RPM/IP 锁定状态
func GetProvidersStats(c *gin.Context) {
	var req ProviderStatsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.BadRequest(c, "Invalid request body: "+err.Error())
		return
	}
	if len(req.ProviderIDs) == 0 {
		common.Success(c, []ProviderStatsItem{})
		return
	}

	ctx := c.Request.Context()
	results := make([]ProviderStatsItem, 0, len(req.ProviderIDs))
	for _, providerID := range req.ProviderIDs {
		rpmCount, rpmErr := service.GetCurrentRPMCount(ctx, providerID)
		rpmLoaded := rpmErr == nil
		if rpmErr != nil {
			rpmCount = 0
		}

		status, ipErr := service.GetIPLockStatus(ctx, providerID)
		ipLoaded := ipErr == nil
		locked := false
		var lockUntil *time.Time
		if ipErr == nil && status != nil {
			locked = true
			lock := status.LockUntil
			lockUntil = &lock
		}

		results = append(results, ProviderStatsItem{
			ProviderID:   providerID,
			RPMCount:     rpmCount,
			RPMLoaded:    rpmLoaded,
			Locked:       locked,
			IPLockLoaded: ipLoaded,
			LockUntil:    lockUntil,
		})
	}

	common.Success(c, results)
}

// GetLimiterHealth 获取限流器健康状态
func GetLimiterHealth(c *gin.Context) {
	ctx := c.Request.Context()
	stats := service.GetRPMStats(ctx)

	health := gin.H{
		"status":    "healthy",
		"timestamp": gin.H{},
		"limiter":   stats,
	}

	// 检查限流器是否启用
	if enabled, ok := stats["enabled"].(bool); ok && !enabled {
		health["status"] = "disabled"
	}

	common.Success(c, health)
}
