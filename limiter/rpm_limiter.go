package limiter

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
)

// RPMLimiter RPM限流器
type RPMLimiter struct {
	redis  *redis.Client
	memory *sync.Map // 内存存储，当Redis不可用时使用
}

// RequestRecord 请求记录
type RequestRecord struct {
	Timestamps []int64 `json:"timestamps"`
}

// NewRPMLimiter 创建新的RPM限流器
func NewRPMLimiter(redisClient *redis.Client) *RPMLimiter {
	return &RPMLimiter{
		redis:  redisClient,
		memory: &sync.Map{},
	}
}

// CheckRPMLimit 检查是否达到RPM限制
func (r *RPMLimiter) CheckRPMLimit(ctx context.Context, providerID uint, rpmLimit int) (bool, error) {
	// 0表示无限制
	if rpmLimit <= 0 {
		return true, nil
	}

	now := time.Now().Unix()
	windowStart := now - 60 // 1分钟前

	if r.redis != nil {
		return r.checkRPMLimitRedis(ctx, providerID, rpmLimit, now, windowStart)
	}

	return r.checkRPMLimitMemory(providerID, rpmLimit, now, windowStart), nil
}

// RecordRequest 记录一次请求
func (r *RPMLimiter) RecordRequest(ctx context.Context, providerID uint) error {
	now := time.Now().Unix()

	if r.redis != nil {
		return r.recordRequestRedis(ctx, providerID, now)
	}

	r.recordRequestMemory(providerID, now)
	return nil
}

// GetCurrentRPMCount 获取当前RPM计数
func (r *RPMLimiter) GetCurrentRPMCount(ctx context.Context, providerID uint) (int, error) {
	now := time.Now().Unix()
	windowStart := now - 60

	if r.redis != nil {
		return r.getCurrentRPMCountRedis(ctx, providerID, windowStart, now)
	}

	return r.getCurrentRPMCountMemory(providerID, windowStart), nil
}

// getRPMKey 获取RPM存储键
func (r *RPMLimiter) getRPMKey(providerID uint) string {
	return fmt.Sprintf("rpm:provider:%d", providerID)
}

// ==================== Redis实现 ====================

func (r *RPMLimiter) checkRPMLimitRedis(ctx context.Context, providerID uint, rpmLimit int, now, windowStart int64) (bool, error) {
	key := r.getRPMKey(providerID)

	// 使用Redis事务确保原子性
	pipe := r.redis.TxPipeline()

	// 移除过期的请求记录
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart, 10))

	// 获取当前窗口内的请求数
	countCmd := pipe.ZCard(ctx, key)

	_, err := pipe.Exec(ctx)
	if err != nil {
		// Redis出错时降级为允许
		return true, fmt.Errorf("redis rpm check failed: %w", err)
	}

	count := countCmd.Val()
	return count < int64(rpmLimit), nil
}

func (r *RPMLimiter) recordRequestRedis(ctx context.Context, providerID uint, now int64) error {
	key := r.getRPMKey(providerID)

	// 使用有序集合存储请求时间戳
	// score和member都使用时间戳，确保唯一性
	member := fmt.Sprintf("%d-%d", now, time.Now().UnixNano()%1000000)

	pipe := r.redis.TxPipeline()
	pipe.ZAdd(ctx, key, &redis.Z{
		Score:  float64(now),
		Member: member,
	})

	// 设置过期时间为2分钟
	pipe.Expire(ctx, key, 2*time.Minute)

	_, err := pipe.Exec(ctx)
	return err
}

func (r *RPMLimiter) getCurrentRPMCountRedis(ctx context.Context, providerID uint, windowStart, now int64) (int, error) {
	key := r.getRPMKey(providerID)

	pipe := r.redis.TxPipeline()

	// 移除过期的请求记录
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart, 10))

	// 获取当前窗口内的请求数
	countCmd := pipe.ZCard(ctx, key)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, err
	}

	return int(countCmd.Val()), nil
}

// ==================== 内存实现 ====================

func (r *RPMLimiter) checkRPMLimitMemory(providerID uint, rpmLimit int, now, windowStart int64) bool {
	key := r.getRPMKey(providerID)

	value, exists := r.memory.Load(key)
	if !exists {
		return true
	}

	record, ok := value.(*RequestRecord)
	if !ok {
		return true
	}

	// 过滤出窗口内的请求
	validTimestamps := make([]int64, 0, len(record.Timestamps))
	for _, ts := range record.Timestamps {
		if ts > windowStart {
			validTimestamps = append(validTimestamps, ts)
		}
	}

	// 更新存储
	record.Timestamps = validTimestamps
	r.memory.Store(key, record)

	return len(validTimestamps) < rpmLimit
}

func (r *RPMLimiter) recordRequestMemory(providerID uint, now int64) {
	key := r.getRPMKey(providerID)

	value, exists := r.memory.Load(key)
	var record *RequestRecord

	if exists {
		record, _ = value.(*RequestRecord)
	}

	if record == nil {
		record = &RequestRecord{
			Timestamps: make([]int64, 0),
		}
	}

	// 添加新的时间戳
	record.Timestamps = append(record.Timestamps, now)

	// 清理过期数据（保留最近2分钟的）
	windowStart := now - 120
	validTimestamps := make([]int64, 0, len(record.Timestamps))
	for _, ts := range record.Timestamps {
		if ts > windowStart {
			validTimestamps = append(validTimestamps, ts)
		}
	}

	record.Timestamps = validTimestamps
	r.memory.Store(key, record)
}

func (r *RPMLimiter) getCurrentRPMCountMemory(providerID uint, windowStart int64) int {
	key := r.getRPMKey(providerID)

	value, exists := r.memory.Load(key)
	if !exists {
		return 0
	}

	record, ok := value.(*RequestRecord)
	if !ok {
		return 0
	}

	// 过滤出窗口内的请求
	count := 0
	for _, ts := range record.Timestamps {
		if ts > windowStart {
			count++
		}
	}

	return count
}

// ClearMemoryData 清理内存数据（用于测试）
func (r *RPMLimiter) ClearMemoryData() {
	r.memory = &sync.Map{}
}

// GetStats 获取限流器统计信息
func (r *RPMLimiter) GetStats(ctx context.Context) map[string]interface{} {
	stats := map[string]interface{}{
		"storage_type": "memory",
		"providers":    make(map[string]int),
	}

	if r.redis != nil {
		stats["storage_type"] = "redis"

		// 获取Redis中的RPM键
		keys, err := r.redis.Keys(ctx, "rpm:provider:*").Result()
		if err == nil {
			providerStats := make(map[string]int)
			for _, key := range keys {
				count, err := r.redis.ZCard(ctx, key).Result()
				if err == nil {
					providerStats[key] = int(count)
				}
			}
			stats["providers"] = providerStats
		}
	} else {
		// 内存统计
		providerStats := make(map[string]int)
		r.memory.Range(func(key, value interface{}) bool {
			if keyStr, ok := key.(string); ok {
				if record, ok := value.(*RequestRecord); ok {
					providerStats[keyStr] = len(record.Timestamps)
				}
			}
			return true
		})
		stats["providers"] = providerStats
	}

	return stats
}
