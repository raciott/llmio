package limiter

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

// Manager 限流管理器
type Manager struct {
	rpmLimiter  *RPMLimiter
	ipLocker    *IPLocker
	redisClient *redis.Client
	enabled     bool
}

// NewManager 创建新的限流管理器
func NewManager(redisClient *redis.Client) *Manager {
	return &Manager{
		rpmLimiter:  NewRPMLimiter(redisClient),
		ipLocker:    NewIPLocker(redisClient),
		redisClient: redisClient,
		enabled:     true,
	}
}

// SetEnabled 设置限流器是否启用
func (m *Manager) SetEnabled(enabled bool) {
	m.enabled = enabled
}

// IsEnabled 检查限流器是否启用
func (m *Manager) IsEnabled() bool {
	return m.enabled
}

// GetRedisClient 获取Redis客户端
func (m *Manager) GetRedisClient() *redis.Client {
	return m.redisClient
}

// CheckRPMLimit 检查RPM限制
func (m *Manager) CheckRPMLimit(ctx context.Context, providerID uint, rpmLimit int) (bool, error) {
	if !m.enabled {
		return true, nil
	}
	return m.rpmLimiter.CheckRPMLimit(ctx, providerID, rpmLimit)
}

// RecordRPMRequest 记录RPM请求
func (m *Manager) RecordRPMRequest(ctx context.Context, providerID uint) error {
	if !m.enabled {
		return nil
	}
	return m.rpmLimiter.RecordRequest(ctx, providerID)
}

// CheckIPAccess 检查IP访问权限
func (m *Manager) CheckIPAccess(ctx context.Context, providerID uint, clientIP string, lockMinutes int) (bool, error) {
	if !m.enabled {
		return true, nil
	}
	return m.ipLocker.CheckIPAccess(ctx, providerID, clientIP, lockMinutes)
}

// RecordIPAccess 记录IP访问
func (m *Manager) RecordIPAccess(ctx context.Context, providerID uint, clientIP string, lockMinutes int) error {
	if !m.enabled {
		return nil
	}
	return m.ipLocker.RecordIPAccess(ctx, providerID, clientIP, lockMinutes)
}

// GetClientIP 获取客户端IP
func (m *Manager) GetClientIP(c *gin.Context) string {
	return m.ipLocker.GetClientIP(c)
}

// GetRPMStats 获取RPM统计信息
func (m *Manager) GetRPMStats(ctx context.Context) map[string]interface{} {
	if !m.enabled {
		return map[string]interface{}{
			"enabled": false,
		}
	}
	stats := m.rpmLimiter.GetStats(ctx)
	stats["enabled"] = true
	return stats
}

// GetIPLockStatus 获取IP锁定状态
func (m *Manager) GetIPLockStatus(ctx context.Context, providerID uint) (*IPLockRecord, error) {
	if !m.enabled {
		return nil, nil
	}
	return m.ipLocker.GetIPLockStatus(ctx, providerID)
}

// ClearIPLock 清除IP锁定
func (m *Manager) ClearIPLock(ctx context.Context, providerID uint) error {
	if !m.enabled {
		return nil
	}
	return m.ipLocker.ClearIPLock(ctx, providerID)
}

// CheckProviderLimits 检查提供商的所有限制
func (m *Manager) CheckProviderLimits(ctx context.Context, c *gin.Context, providerID uint, rpmLimit, ipLockMinutes int) (bool, string, error) {
	if !m.enabled {
		return true, "", nil
	}

	// 检查RPM限制
	if rpmLimit > 0 {
		canProceed, err := m.CheckRPMLimit(ctx, providerID, rpmLimit)
		if err != nil {
			slog.Warn("RPM limit check failed", "provider_id", providerID, "error", err)
			// RPM检查失败时允许通过，但记录警告
		} else if !canProceed {
			return false, "rpm_limit_exceeded", nil
		}
	}

	// 检查IP锁定
	if ipLockMinutes > 0 {
		clientIP := m.GetClientIP(c)
		canAccess, err := m.CheckIPAccess(ctx, providerID, clientIP, ipLockMinutes)
		if err != nil {
			slog.Warn("IP lock check failed", "provider_id", providerID, "client_ip", clientIP, "error", err)
			// IP检查失败时允许通过，但记录警告
		} else if !canAccess {
			return false, "ip_access_denied", nil
		}
	}

	return true, "", nil
}

// RecordProviderAccess 记录提供商访问
func (m *Manager) RecordProviderAccess(ctx context.Context, c *gin.Context, providerID uint, rpmLimit, ipLockMinutes int) error {
	if !m.enabled {
		return nil
	}

	// 记录RPM请求
	if rpmLimit > 0 {
		if err := m.RecordRPMRequest(ctx, providerID); err != nil {
			slog.Warn("Failed to record RPM request", "provider_id", providerID, "error", err)
		}
	}

	// 记录IP访问
	if ipLockMinutes > 0 {
		clientIP := m.GetClientIP(c)
		if err := m.RecordIPAccess(ctx, providerID, clientIP, ipLockMinutes); err != nil {
			slog.Warn("Failed to record IP access", "provider_id", providerID, "client_ip", clientIP, "error", err)
		}
	}

	return nil
}

// GetCurrentRPMCount 获取当前RPM计数
func (m *Manager) GetCurrentRPMCount(ctx context.Context, providerID uint) (int, error) {
	if !m.enabled {
		return 0, nil
	}
	return m.rpmLimiter.GetCurrentRPMCount(ctx, providerID)
}

// ClearMemoryData 清理内存数据（用于测试）
func (m *Manager) ClearMemoryData() {
	if m.rpmLimiter != nil {
		m.rpmLimiter.ClearMemoryData()
	}
	// IP锁定器的内存清理可以在需要时添加
}
