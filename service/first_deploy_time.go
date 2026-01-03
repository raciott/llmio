package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/racio/llmio/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GetOrInitFirstDeployTime 获取首次部署时间（持久化在 configs 表），用于跨重启计算系统总运行时间。
// - 若不存在：写入一次并返回写入值
// - 若值格式异常：优先回退到该记录的 created_at，并尝试修正 value
func GetOrInitFirstDeployTime(ctx context.Context) (time.Time, error) {
	cfg, err := gorm.G[models.Config](models.DB).Where("key = ?", models.KeyFirstDeployTime).First(ctx)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return time.Time{}, err
		}

		now := time.Now().UTC()
		// 并发安全：如果多个请求/实例同时初始化，使用 ON CONFLICT DO NOTHING，随后再读回。
		if err := models.DB.WithContext(ctx).
			Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "key"}},
				DoNothing: true,
			}).
			Create(&models.Config{
				Key:   models.KeyFirstDeployTime,
				Value: now.Format(time.RFC3339),
			}).Error; err != nil {
			return time.Time{}, err
		}

		cfg, err = gorm.G[models.Config](models.DB).Where("key = ?", models.KeyFirstDeployTime).First(ctx)
		if err != nil {
			return time.Time{}, err
		}
	}

	if t, err := time.Parse(time.RFC3339, cfg.Value); err == nil {
		return t.UTC(), nil
	}

	// value 不可解析时，回退到 created_at 作为可信来源，并尝试修复 value，避免后续再次失败。
	fallback := cfg.CreatedAt.UTC()
	if fallback.IsZero() {
		return time.Time{}, errors.New("invalid first_deploy_time config value and missing created_at")
	}

	slog.Warn("first_deploy_time config value invalid, fallback to created_at", "key", cfg.Key, "value", cfg.Value)
	fixed := fallback.Format(time.RFC3339)
	if _, err := gorm.G[models.Config](models.DB).
		Where("id = ?", cfg.ID).
		Updates(ctx, models.Config{Value: fixed}); err != nil {
		// 修复失败不影响主流程
		slog.Warn("failed to fix first_deploy_time config value", "error", err)
	}
	return fallback, nil
}
