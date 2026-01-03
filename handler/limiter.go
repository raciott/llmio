package handler

import (
	"strconv"

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

// GetProviderRPMCount 获取指定提供商的当前RPM计数
func GetProviderRPMCount(c *gin.Context) {
	providerIDStr := c.Param("id")
	providerID, err := strconv.ParseUint(providerIDStr, 10, 32)
	if err != nil {
		common.BadRequest(c, "Invalid provider ID")
		return
	}

	ctx := c.Request.Context()
	count, err := service.GetCurrentRPMCount(ctx, uint(providerID))
	if err != nil {
		common.InternalServerError(c, "Failed to get RPM count: "+err.Error())
		return
	}

	common.Success(c, gin.H{
		"provider_id": providerID,
		"rpm_count":   count,
	})
}

// GetProviderIPLockStatus 获取指定提供商的IP锁定状态
func GetProviderIPLockStatus(c *gin.Context) {
	providerIDStr := c.Param("id")
	providerID, err := strconv.ParseUint(providerIDStr, 10, 32)
	if err != nil {
		common.BadRequest(c, "Invalid provider ID")
		return
	}

	ctx := c.Request.Context()
	status, err := service.GetIPLockStatus(ctx, uint(providerID))
	if err != nil {
		common.InternalServerError(c, "Failed to get IP lock status: "+err.Error())
		return
	}

	if status == nil {
		common.Success(c, gin.H{
			"provider_id": providerID,
			"locked":      false,
		})
		return
	}

	common.Success(c, gin.H{
		"provider_id":       providerID,
		"locked":            true,
		"first_access_ip":   status.FirstAccessIP,
		"first_access_time": status.FirstAccessTime,
		"lock_until":        status.LockUntil,
	})
}

// ClearProviderIPLock 清除指定提供商的IP锁定
func ClearProviderIPLock(c *gin.Context) {
	providerIDStr := c.Param("id")
	providerID, err := strconv.ParseUint(providerIDStr, 10, 32)
	if err != nil {
		common.BadRequest(c, "Invalid provider ID")
		return
	}

	ctx := c.Request.Context()
	if err := service.ClearIPLock(ctx, uint(providerID)); err != nil {
		common.InternalServerError(c, "Failed to clear IP lock: "+err.Error())
		return
	}

	common.SuccessWithMessage(c, "IP lock cleared", gin.H{
		"provider_id": providerID,
	})
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
