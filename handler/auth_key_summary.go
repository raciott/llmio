package handler

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/common"
	"github.com/racio/llmio/consts"
	"github.com/racio/llmio/models"
	"gorm.io/gorm"
)

type AuthKeySummaryRes struct {
	Name             string     `json:"name"`
	KeyMasked        string     `json:"keyMasked"`
	ExpiresAt        *time.Time `json:"expiresAt"`
	ExpireInDays     *int       `json:"expireInDays"`
	TotalCost        float64    `json:"totalCost"`
	TotalRequests    int64      `json:"totalRequests"`
	SuccessRequests  int64      `json:"successRequests"`
	FailureRequests  int64      `json:"failureRequests"`
	TotalTimeMs      int64      `json:"totalTimeMs"`
	PromptTokens     int64      `json:"promptTokens"`
	CompletionTokens int64      `json:"completionTokens"`
	TotalTokens      int64      `json:"totalTokens"`
	InputCost        float64    `json:"inputCost"`
	OutputCost       float64    `json:"outputCost"`
	AllowAll         bool       `json:"allowAll"`
	Models           []string   `json:"models"`
}

type authKeyTokenAgg struct {
	Model      string `gorm:"column:model"`
	Prompt     int64  `gorm:"column:prompt"`
	Completion int64  `gorm:"column:completion"`
}

// AuthKeySummary 返回 API Key 视角的概览数据
func AuthKeySummary(c *gin.Context) {
	ctx := c.Request.Context()
	authKeyID, ok := ctx.Value(consts.ContextKeyAuthKeyID).(uint)
	if !ok || authKeyID == 0 {
		common.ErrorWithHttpStatus(c, http.StatusForbidden, http.StatusForbidden, "auth key required")
		return
	}

	authKey, err := gorm.G[models.AuthKey](models.DB).Where("id = ?", authKeyID).First(ctx)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.NotFound(c, "auth key not found")
			return
		}
		common.InternalServerError(c, "Failed to load auth key: "+err.Error())
		return
	}

	base := models.DB.WithContext(ctx).
		Model(&models.ChatLog{}).
		Where("deleted_at IS NULL").
		Where("auth_key_id = ?", authKeyID)

	totalRequests, err := gorm.G[models.ChatLog](models.DB).
		Where("deleted_at IS NULL").
		Where("auth_key_id = ?", authKeyID).
		Count(ctx, "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count requests: "+err.Error())
		return
	}

	successRequests, err := gorm.G[models.ChatLog](models.DB).
		Where("deleted_at IS NULL").
		Where("auth_key_id = ?", authKeyID).
		Where("status = ?", "success").
		Count(ctx, "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count success requests: "+err.Error())
		return
	}
	failureRequests := totalRequests - successRequests

	type tokenAgg struct {
		Prompt     sql.NullInt64 `gorm:"column:prompt"`
		Completion sql.NullInt64 `gorm:"column:completion"`
		Total      sql.NullInt64 `gorm:"column:total"`
	}
	var tokens tokenAgg
	if err := base.Select(
		"COALESCE(SUM(prompt_tokens),0) AS prompt, COALESCE(SUM(completion_tokens),0) AS completion, COALESCE(SUM(total_tokens),0) AS total",
	).Scan(&tokens).Error; err != nil {
		common.InternalServerError(c, "Failed to sum tokens: "+err.Error())
		return
	}

	var totalCost sql.NullFloat64
	if err := base.Select("COALESCE(SUM(total_cost),0) AS total_cost").Scan(&totalCost).Error; err != nil {
		common.InternalServerError(c, "Failed to sum total cost: "+err.Error())
		return
	}

	var totalTime sql.NullInt64
	if err := base.Select("COALESCE(SUM(proxy_time_ms),0) AS total_time").Scan(&totalTime).Error; err != nil {
		common.InternalServerError(c, "Failed to sum proxy time: "+err.Error())
		return
	}

	modelAgg := make([]authKeyTokenAgg, 0)
	if err := base.Select(
		"LOWER(name) AS model, COALESCE(SUM(prompt_tokens),0) AS prompt, COALESCE(SUM(completion_tokens),0) AS completion",
	).Group("LOWER(name)").Scan(&modelAgg).Error; err != nil {
		common.InternalServerError(c, "Failed to aggregate tokens: "+err.Error())
		return
	}

	inputCost := 0.0
	outputCost := 0.0
	if len(modelAgg) > 0 {
		modelIDs := make([]string, 0, len(modelAgg))
		for _, item := range modelAgg {
			if item.Model == "" {
				continue
			}
			modelIDs = append(modelIDs, item.Model)
		}

		if len(modelIDs) > 0 {
			prices := make([]models.ModelPrice, 0, len(modelIDs))
			if err := models.DB.WithContext(ctx).
				Where("model_id IN ?", modelIDs).
				Find(&prices).Error; err != nil {
				common.InternalServerError(c, "Failed to query model prices: "+err.Error())
				return
			}

			priceMap := make(map[string]models.ModelPrice, len(prices))
			for _, price := range prices {
				priceMap[price.ModelID] = price
			}

			for _, item := range modelAgg {
				price, ok := priceMap[item.Model]
				if !ok {
					continue
				}
				inputCost += float64(item.Prompt) * price.Input
				outputCost += float64(item.Completion) * price.Output
			}
		}
	}

	allowAll, _ := ctx.Value(consts.ContextKeyAllowAllModel).(bool)
	allowedModels := make([]string, 0)
	if !allowAll {
		unique := make(map[string]struct{})
		if raw := ctx.Value(consts.ContextKeyAllowModels); raw != nil {
			if list, ok := raw.([]string); ok {
				for _, name := range list {
					name = strings.TrimSpace(name)
					if name != "" {
						if _, exists := unique[name]; exists {
							continue
						}
						unique[name] = struct{}{}
						allowedModels = append(allowedModels, name)
					}
				}
			}
		}
		sort.Strings(allowedModels)
	}

	var expireInDays *int
	if authKey.ExpiresAt != nil {
		days := int(math.Ceil(authKey.ExpiresAt.Sub(time.Now()).Hours() / 24))
		if days < 0 {
			days = 0
		}
		expireInDays = &days
	}

	common.Success(c, AuthKeySummaryRes{
		Name:             authKey.Name,
		KeyMasked:        maskAuthKey(authKey.Key),
		ExpiresAt:        authKey.ExpiresAt,
		ExpireInDays:     expireInDays,
		TotalCost:        totalCost.Float64,
		TotalRequests:    totalRequests,
		SuccessRequests:  successRequests,
		FailureRequests:  failureRequests,
		TotalTimeMs:      totalTime.Int64,
		PromptTokens:     tokens.Prompt.Int64,
		CompletionTokens: tokens.Completion.Int64,
		TotalTokens:      tokens.Total.Int64,
		InputCost:        inputCost,
		OutputCost:       outputCost,
		AllowAll:         allowAll,
		Models:           allowedModels,
	})
}

func maskAuthKey(key string) string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return "--"
	}
	if len(trimmed) <= 12 {
		return trimmed
	}
	prefix := trimmed[:8]
	suffix := trimmed[len(trimmed)-4:]
	return fmt.Sprintf("%s****%s", prefix, suffix)
}
