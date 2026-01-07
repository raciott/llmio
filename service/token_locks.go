package service

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/racio/llmio/limiter"
	"github.com/racio/llmio/models"
	"github.com/samber/lo"
	"gorm.io/gorm"
)

type TokenLockItem struct {
	ModelWithProviderID uint      `json:"modelWithProviderId"`
	ModelID             uint      `json:"modelId"`
	ModelName           string    `json:"modelName"`
	ProviderID          uint      `json:"providerId"`
	ProviderName        string    `json:"providerName"`
	ProviderModel       string    `json:"providerModel"`
	TokenID             uint      `json:"tokenId"`
	TTLSeconds          int64     `json:"ttlSeconds"`
	LockedUntil         time.Time `json:"lockedUntil"`
}

func ListTokenLocks(ctx context.Context) ([]TokenLockItem, error) {
	redisClient := GetRedisClient()
	if redisClient == nil {
		return nil, limiter.ErrLimiterUnavailable
	}

	keys, err := scanRedisKeys(ctx, redisClient, "token_lock:mwpp:*")
	if err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return []TokenLockItem{}, nil
	}

	type rawLock struct {
		modelWithProviderID uint
		tokenID             uint
		ttl                 time.Duration
	}

	now := time.Now()
	rawLocks := make([]rawLock, 0, len(keys))

	pipe := redisClient.Pipeline()
	getCmds := make([]*redis.StringCmd, 0, len(keys))
	ttlCmds := make([]*redis.DurationCmd, 0, len(keys))
	for _, k := range keys {
		getCmds = append(getCmds, pipe.Get(ctx, k))
		ttlCmds = append(ttlCmds, pipe.TTL(ctx, k))
	}
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	for i, k := range keys {
		// key: token_lock:mwpp:<id>
		parts := strings.Split(k, ":")
		if len(parts) < 3 {
			continue
		}
		idStr := parts[len(parts)-1]
		mwppID64, err := strconv.ParseUint(idStr, 10, 64)
		if err != nil || mwppID64 == 0 {
			continue
		}

		val, err := getCmds[i].Result()
		if err != nil {
			// key 在 pipeline 阶段可能已过期
			continue
		}
		tokenID64, err := strconv.ParseUint(strings.TrimSpace(val), 10, 64)
		if err != nil || tokenID64 == 0 {
			continue
		}

		ttl, err := ttlCmds[i].Result()
		if err != nil {
			continue
		}
		if ttl <= 0 {
			continue
		}

		rawLocks = append(rawLocks, rawLock{
			modelWithProviderID: uint(mwppID64),
			tokenID:             uint(tokenID64),
			ttl:                 ttl,
		})
	}

	if len(rawLocks) == 0 {
		return []TokenLockItem{}, nil
	}

	mwppIDs := lo.Uniq(lo.Map(rawLocks, func(v rawLock, _ int) uint { return v.modelWithProviderID }))
	modelWithProviders, err := gorm.G[models.ModelWithProvider](models.DB).Where("id IN ?", mwppIDs).Find(ctx)
	if err != nil {
		return nil, err
	}

	mwppMap := lo.KeyBy(modelWithProviders, func(v models.ModelWithProvider) uint { return v.ID })
	modelIDs := lo.Uniq(lo.Map(modelWithProviders, func(v models.ModelWithProvider, _ int) uint { return v.ModelID }))
	providerIDs := lo.Uniq(lo.Map(modelWithProviders, func(v models.ModelWithProvider, _ int) uint { return v.ProviderID }))

	modelsList := []models.Model{}
	if len(modelIDs) > 0 {
		modelsList, err = gorm.G[models.Model](models.DB).Where("id IN ?", modelIDs).Find(ctx)
		if err != nil {
			return nil, err
		}
	}
	providersList := []models.Provider{}
	if len(providerIDs) > 0 {
		providersList, err = gorm.G[models.Provider](models.DB).Where("id IN ?", providerIDs).Find(ctx)
		if err != nil {
			return nil, err
		}
	}

	modelMap := lo.KeyBy(modelsList, func(v models.Model) uint { return v.ID })
	providerMap := lo.KeyBy(providersList, func(v models.Provider) uint { return v.ID })

	items := make([]TokenLockItem, 0, len(rawLocks))
	for _, l := range rawLocks {
		mwpp, ok := mwppMap[l.modelWithProviderID]
		if !ok {
			// 关联可能已删除：仍然返回基础信息，方便排查
			items = append(items, TokenLockItem{
				ModelWithProviderID: l.modelWithProviderID,
				ModelID:             0,
				ModelName:           "未知（关联已删除）",
				ProviderID:          0,
				ProviderName:        "未知（关联已删除）",
				ProviderModel:       "",
				TokenID:             l.tokenID,
				TTLSeconds:          int64(l.ttl.Seconds()),
				LockedUntil:         now.Add(l.ttl),
			})
			continue
		}

		modelName := ""
		if m, ok := modelMap[mwpp.ModelID]; ok {
			modelName = m.Name
		}
		if modelName == "" {
			modelName = "未知"
		}

		providerName := ""
		if p, ok := providerMap[mwpp.ProviderID]; ok {
			providerName = p.Name
		}
		if providerName == "" {
			providerName = "未知"
		}

		items = append(items, TokenLockItem{
			ModelWithProviderID: l.modelWithProviderID,
			ModelID:             mwpp.ModelID,
			ModelName:           modelName,
			ProviderID:          mwpp.ProviderID,
			ProviderName:        providerName,
			ProviderModel:       mwpp.ProviderModel,
			TokenID:             l.tokenID,
			TTLSeconds:          int64(l.ttl.Seconds()),
			LockedUntil:         now.Add(l.ttl),
		})
	}

	sort.Slice(items, func(i, j int) bool {
		// TTL 更短的靠前，方便优先关注即将到期的锁
		if items[i].TTLSeconds != items[j].TTLSeconds {
			return items[i].TTLSeconds < items[j].TTLSeconds
		}
		return items[i].ModelWithProviderID < items[j].ModelWithProviderID
	})

	return items, nil
}

func scanRedisKeys(ctx context.Context, client *redis.Client, pattern string) ([]string, error) {
	var (
		cursor uint64
		keys   []string
	)
	for {
		ks, next, err := client.Scan(ctx, cursor, pattern, 200).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, ks...)
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return keys, nil
}
