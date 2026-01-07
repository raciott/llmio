package limiter

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
)

// TokenLocker 用于按「token + model_with_provider」进行短时独占锁定：
// - 同一个 token 可复用同一个锁并刷新 TTL
// - 其他 token 在 TTL 内会被拒绝，从而切换到其它提供商
//
// 该锁应当在 IP 锁定之前检查（更符合“同 token 独占”诉求）。
type TokenLocker struct {
	redis   *redis.Client
	memory  *sync.Map // key -> *tokenLockRecord
	ttl     time.Duration
	keyBase string
}

type tokenLockRecord struct {
	TokenID uint
	Expiry  time.Time
}

func NewTokenLocker(redisClient *redis.Client, ttl time.Duration) *TokenLocker {
	if ttl <= 0 {
		ttl = 2 * time.Minute
	}
	return &TokenLocker{
		redis:   redisClient,
		memory:  &sync.Map{},
		ttl:     ttl,
		keyBase: "token_lock",
	}
}

func (l *TokenLocker) getKey(modelWithProviderID uint) string {
	return fmt.Sprintf("%s:mwpp:%d", l.keyBase, modelWithProviderID)
}

// CheckAndTouch 检查并（必要时）写入/续期：
// - key 不存在：写入 token 并设置 ttl
// - key 存在且 token 一致：续期
// - key 存在且 token 不一致：拒绝
func (l *TokenLocker) CheckAndTouch(ctx context.Context, modelWithProviderID uint, tokenID uint) (bool, error) {
	if modelWithProviderID == 0 || tokenID == 0 {
		return true, nil
	}

	if l.redis != nil {
		return l.checkAndTouchRedis(ctx, modelWithProviderID, tokenID)
	}
	return l.checkAndTouchMemory(modelWithProviderID, tokenID), nil
}

func (l *TokenLocker) checkAndTouchRedis(ctx context.Context, modelWithProviderID uint, tokenID uint) (bool, error) {
	key := l.getKey(modelWithProviderID)
	ttlSeconds := int64(l.ttl.Seconds())
	if ttlSeconds <= 0 {
		ttlSeconds = 120
	}

	// Lua 保证原子性：
	// 1) 若不存在，SET 并 EX
	// 2) 若存在且相同，EXPIRE 续期
	// 3) 若存在且不同，返回 0
	script := redis.NewScript(`
local v = redis.call("GET", KEYS[1])
if not v then
  redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
  return 1
end
if v == ARGV[1] then
  redis.call("EXPIRE", KEYS[1], ARGV[2])
  return 1
end
return 0
`)

	res, err := script.Run(ctx, l.redis, []string{key}, strconv.FormatUint(uint64(tokenID), 10), strconv.FormatInt(ttlSeconds, 10)).Int()
	if err != nil {
		return false, fmt.Errorf("%w: redis token lock failed: %v", ErrLimiterUnavailable, err)
	}
	return res == 1, nil
}

func (l *TokenLocker) checkAndTouchMemory(modelWithProviderID uint, tokenID uint) bool {
	key := l.getKey(modelWithProviderID)
	now := time.Now()

	if v, ok := l.memory.Load(key); ok {
		rec, ok := v.(*tokenLockRecord)
		if !ok {
			l.memory.Delete(key)
			return true
		}
		if now.After(rec.Expiry) {
			l.memory.Delete(key)
		} else if rec.TokenID != tokenID {
			return false
		}
	}

	l.memory.Store(key, &tokenLockRecord{
		TokenID: tokenID,
		Expiry:  now.Add(l.ttl),
	})
	return true
}
