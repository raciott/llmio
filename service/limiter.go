package service

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/racio/llmio/limiter"
)

// 全局限流管理器
var globalLimiterManager *limiter.Manager

// SetLimiterManager 设置全局限流管理器
func SetLimiterManager(manager *limiter.Manager) {
	globalLimiterManager = manager
	slog.Info("Limiter manager initialized", "enabled", manager.IsEnabled())
}

// GetLimiterManager 获取全局限流管理器
func GetLimiterManager() *limiter.Manager {
	return globalLimiterManager
}

// GetRedisClient 获取Redis客户端
func GetRedisClient() *redis.Client {
	if globalLimiterManager == nil {
		return nil
	}
	return globalLimiterManager.GetRedisClient()
}

// CheckProviderLimits 检查提供商限制
func CheckProviderLimits(ctx context.Context, c *gin.Context, providerID uint, rpmLimit, ipLockMinutes int, modelWithProviderID uint, tokenID uint) (bool, string, error) {
	if globalLimiterManager == nil {
		return true, "", nil
	}
	return globalLimiterManager.CheckProviderLimits(ctx, c, providerID, rpmLimit, ipLockMinutes, modelWithProviderID, tokenID)
}

// RecordProviderAccess 记录提供商访问
func RecordProviderAccess(ctx context.Context, c *gin.Context, providerID uint, rpmLimit, ipLockMinutes int) error {
	if globalLimiterManager == nil {
		return nil
	}
	return globalLimiterManager.RecordProviderAccess(ctx, c, providerID, rpmLimit, ipLockMinutes)
}

// GetCurrentRPMCount 获取当前RPM计数
func GetCurrentRPMCount(ctx context.Context, providerID uint) (int, error) {
	if globalLimiterManager == nil {
		return 0, nil
	}
	return globalLimiterManager.GetCurrentRPMCount(ctx, providerID)
}

// GetRPMStats 获取RPM统计信息
func GetRPMStats(ctx context.Context) map[string]interface{} {
	if globalLimiterManager == nil {
		return map[string]interface{}{
			"enabled": false,
			"error":   "limiter not initialized",
		}
	}
	return globalLimiterManager.GetRPMStats(ctx)
}

// GetIPLockStatus 获取IP锁定状态
func GetIPLockStatus(ctx context.Context, providerID uint) (*limiter.IPLockRecord, error) {
	if globalLimiterManager == nil {
		return nil, nil
	}
	return globalLimiterManager.GetIPLockStatus(ctx, providerID)
}

// ClearIPLock 清除IP锁定
func ClearIPLock(ctx context.Context, providerID uint) error {
	if globalLimiterManager == nil {
		return nil
	}
	return globalLimiterManager.ClearIPLock(ctx, providerID)
}
