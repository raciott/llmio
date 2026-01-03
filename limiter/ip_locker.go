package limiter

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

// IPLocker IP锁定器
type IPLocker struct {
	redis  *redis.Client
	memory *sync.Map // 内存存储，当Redis不可用时使用
}

// IPLockRecord IP锁定记录
type IPLockRecord struct {
	FirstAccessIP   string    `json:"first_access_ip"`
	FirstAccessTime time.Time `json:"first_access_time"`
	LockUntil       time.Time `json:"lock_until"`
}

// NewIPLocker 创建新的IP锁定器
func NewIPLocker(redisClient *redis.Client) *IPLocker {
	return &IPLocker{
		redis:  redisClient,
		memory: &sync.Map{},
	}
}

// CheckIPAccess 检查IP是否允许访问
func (l *IPLocker) CheckIPAccess(ctx context.Context, providerID uint, clientIP string, lockMinutes int) (bool, error) {
	// 0表示不启用IP锁定
	if lockMinutes <= 0 {
		return true, nil
	}

	// 标准化IP地址
	normalizedIP := l.normalizeIP(clientIP)
	if normalizedIP == "" {
		return false, fmt.Errorf("invalid IP address: %s", clientIP)
	}

	if l.redis != nil {
		return l.checkIPAccessRedis(ctx, providerID, normalizedIP, lockMinutes)
	}

	return l.checkIPAccessMemory(providerID, normalizedIP, lockMinutes), nil
}

// RecordIPAccess 记录IP访问
func (l *IPLocker) RecordIPAccess(ctx context.Context, providerID uint, clientIP string, lockMinutes int) error {
	// 0表示不启用IP锁定
	if lockMinutes <= 0 {
		return nil
	}

	normalizedIP := l.normalizeIP(clientIP)
	if normalizedIP == "" {
		return fmt.Errorf("invalid IP address: %s", clientIP)
	}

	if l.redis != nil {
		return l.recordIPAccessRedis(ctx, providerID, normalizedIP, lockMinutes)
	}

	l.recordIPAccessMemory(providerID, normalizedIP, lockMinutes)
	return nil
}

// GetIPLockStatus 获取IP锁定状态
func (l *IPLocker) GetIPLockStatus(ctx context.Context, providerID uint) (*IPLockRecord, error) {
	key := l.getIPLockKey(providerID)

	if l.redis != nil {
		return l.getIPLockStatusRedis(ctx, key)
	}

	return l.getIPLockStatusMemory(key), nil
}

// ClearIPLock 清除IP锁定
func (l *IPLocker) ClearIPLock(ctx context.Context, providerID uint) error {
	key := l.getIPLockKey(providerID)

	if l.redis != nil {
		return l.redis.Del(ctx, key).Err()
	}

	l.memory.Delete(key)
	return nil
}

// getIPLockKey 获取IP锁定存储键
func (l *IPLocker) getIPLockKey(providerID uint) string {
	return fmt.Sprintf("ip_lock:provider:%d", providerID)
}

// normalizeIP 标准化IP地址
func (l *IPLocker) normalizeIP(clientIP string) string {
	// 处理X-Forwarded-For等代理头
	if clientIP == "" {
		return ""
	}

	// 解析IP地址
	ip := net.ParseIP(clientIP)
	if ip == nil {
		return ""
	}

	return ip.String()
}

// getClientIP 从Gin上下文中获取客户端IP
func (l *IPLocker) GetClientIP(c *gin.Context) string {
	// 优先从X-Forwarded-For获取
	if xff := c.GetHeader("X-Forwarded-For"); xff != "" {
		// X-Forwarded-For可能包含多个IP，取第一个
		if ips := parseXForwardedFor(xff); len(ips) > 0 {
			return ips[0]
		}
	}

	// 从X-Real-IP获取
	if xri := c.GetHeader("X-Real-IP"); xri != "" {
		return xri
	}

	// 从RemoteAddr获取
	return c.ClientIP()
}

// parseXForwardedFor 解析X-Forwarded-For头
func parseXForwardedFor(xff string) []string {
	var ips []string
	for _, ip := range strings.Split(xff, ",") {
		ip = strings.TrimSpace(ip)
		if normalizedIP := net.ParseIP(ip); normalizedIP != nil {
			ips = append(ips, normalizedIP.String())
		}
	}
	return ips
}

// ==================== Redis实现 ====================

func (l *IPLocker) checkIPAccessRedis(ctx context.Context, providerID uint, clientIP string, lockMinutes int) (bool, error) {
	key := l.getIPLockKey(providerID)

	// 获取当前锁定记录
	data, err := l.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		// 没有锁定记录，允许访问
		return true, nil
	}
	if err != nil {
		// Redis错误，降级为允许访问
		return true, err
	}

	var record IPLockRecord
	if err := json.Unmarshal([]byte(data), &record); err != nil {
		// 数据格式错误，清除并允许访问
		l.redis.Del(ctx, key)
		return true, nil
	}

	// 检查锁定是否过期
	if time.Now().After(record.LockUntil) {
		// 锁定已过期，清除记录
		l.redis.Del(ctx, key)
		return true, nil
	}

	// 检查是否是首次访问的IP
	return record.FirstAccessIP == clientIP, nil
}

func (l *IPLocker) recordIPAccessRedis(ctx context.Context, providerID uint, clientIP string, lockMinutes int) error {
	key := l.getIPLockKey(providerID)
	now := time.Now()
	lockUntil := now.Add(time.Duration(lockMinutes) * time.Minute)

	// 检查是否已有记录
	exists, err := l.redis.Exists(ctx, key).Result()
	if err != nil {
		return err
	}

	if exists == 0 {
		// 创建新的锁定记录
		record := IPLockRecord{
			FirstAccessIP:   clientIP,
			FirstAccessTime: now,
			LockUntil:       lockUntil,
		}

		data, err := json.Marshal(record)
		if err != nil {
			return err
		}

		return l.redis.Set(ctx, key, data, time.Duration(lockMinutes)*time.Minute).Err()
	}

	return nil
}

func (l *IPLocker) getIPLockStatusRedis(ctx context.Context, key string) (*IPLockRecord, error) {
	data, err := l.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var record IPLockRecord
	if err := json.Unmarshal([]byte(data), &record); err != nil {
		return nil, err
	}

	return &record, nil
}

// ==================== 内存实现 ====================

func (l *IPLocker) checkIPAccessMemory(providerID uint, clientIP string, lockMinutes int) bool {
	key := l.getIPLockKey(providerID)

	value, exists := l.memory.Load(key)
	if !exists {
		return true
	}

	record, ok := value.(*IPLockRecord)
	if !ok {
		l.memory.Delete(key)
		return true
	}

	// 检查锁定是否过期
	if time.Now().After(record.LockUntil) {
		l.memory.Delete(key)
		return true
	}

	// 检查是否是首次访问的IP
	return record.FirstAccessIP == clientIP
}

func (l *IPLocker) recordIPAccessMemory(providerID uint, clientIP string, lockMinutes int) {
	key := l.getIPLockKey(providerID)
	now := time.Now()

	// 检查是否已有记录
	if _, exists := l.memory.Load(key); !exists {
		record := &IPLockRecord{
			FirstAccessIP:   clientIP,
			FirstAccessTime: now,
			LockUntil:       now.Add(time.Duration(lockMinutes) * time.Minute),
		}
		l.memory.Store(key, record)
	}
}

func (l *IPLocker) getIPLockStatusMemory(key string) *IPLockRecord {
	value, exists := l.memory.Load(key)
	if !exists {
		return nil
	}

	record, ok := value.(*IPLockRecord)
	if !ok {
		l.memory.Delete(key)
		return nil
	}

	return record
}
