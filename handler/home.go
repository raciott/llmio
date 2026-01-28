package handler

import (
	"database/sql"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/common"
	"github.com/racio/llmio/models"
	"gorm.io/gorm"
)

type MetricsRes struct {
	Reqs   int64 `json:"reqs"`
	Tokens int64 `json:"tokens"`
}

type MetricsSummaryRes struct {
	TotalReqs        int64   `json:"totalReqs"`
	SuccessRate      float64 `json:"successRate"`
	PromptTokens     int64   `json:"promptTokens"`
	CompletionTokens int64   `json:"completionTokens"`
	TodayReqs        int64   `json:"todayReqs"`
	TodaySuccessRate float64 `json:"todaySuccessRate"`
	TodaySuccessReqs int64   `json:"todaySuccessReqs"`
	TodayFailureReqs int64   `json:"todayFailureReqs"`
	TotalSuccessReqs int64   `json:"totalSuccessReqs"`
	TotalFailureReqs int64   `json:"totalFailureReqs"`
}

type RequestAmountPoint struct {
	Hour     int     `json:"hour"`
	Requests int64   `json:"requests"`
	Amount   float64 `json:"amount"`
}

type RequestAmountRes struct {
	TotalRequests int64                `json:"total_requests"`
	TotalAmount   float64              `json:"total_amount"`
	Range         string               `json:"range"`
	Points        []RequestAmountPoint `json:"points"`
}

func Metrics(c *gin.Context) {
	days, err := strconv.Atoi(c.Param("days"))
	if err != nil {
		common.BadRequest(c, "Invalid days parameter")
		return
	}

	now := time.Now()
	year, month, day := now.Date()
	chain := gorm.G[models.ChatLog](models.DB).Where("created_at >= ?", time.Date(year, month, day, 0, 0, 0, 0, now.Location()).AddDate(0, 0, -days))

	reqs, err := chain.Count(c.Request.Context(), "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count requests: "+err.Error())
		return
	}
	var tokens sql.NullInt64
	if err := chain.Select("sum(total_tokens) as tokens").Scan(c.Request.Context(), &tokens); err != nil {
		common.InternalServerError(c, "Failed to sum tokens: "+err.Error())
		return
	}
	common.Success(c, MetricsRes{
		Reqs:   reqs,
		Tokens: tokens.Int64,
	})
}

// MetricsSummary 返回系统概览用的汇总指标：
// 1) 请求总数（全量）
// 2) 请求成功率（全量）
// 3) 输入/输出 token 总数（全量）
// 4) 今日请求数（从当天 00:00 开始）
func MetricsSummary(c *gin.Context) {
	ctx := c.Request.Context()

	base := models.DB.Model(&models.ChatLog{}).Where("deleted_at IS NULL")

	totalReqs, err := gorm.G[models.ChatLog](models.DB).Where("deleted_at IS NULL").Count(ctx, "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count requests: "+err.Error())
		return
	}

	totalSuccess, err := gorm.G[models.ChatLog](models.DB).Where("deleted_at IS NULL").Where("status = ?", "success").Count(ctx, "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count success requests: "+err.Error())
		return
	}
	totalFailure := totalReqs - totalSuccess

	type tokenAgg struct {
		Prompt     sql.NullInt64 `gorm:"column:prompt"`
		Completion sql.NullInt64 `gorm:"column:completion"`
	}
	var agg tokenAgg
	if err := base.Select("COALESCE(SUM(prompt_tokens),0) AS prompt, COALESCE(SUM(completion_tokens),0) AS completion").Scan(&agg).Error; err != nil {
		common.InternalServerError(c, "Failed to sum tokens: "+err.Error())
		return
	}

	now := time.Now()
	year, month, day := now.Date()
	startOfDay := time.Date(year, month, day, 0, 0, 0, 0, now.Location())

	todayReqs, err := gorm.G[models.ChatLog](models.DB).Where("deleted_at IS NULL").Where("created_at >= ?", startOfDay).Count(ctx, "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count today requests: "+err.Error())
		return
	}
	todaySuccess, err := gorm.G[models.ChatLog](models.DB).Where("deleted_at IS NULL").Where("created_at >= ?", startOfDay).Where("status = ?", "success").Count(ctx, "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count today success requests: "+err.Error())
		return
	}
	todayFailure := todayReqs - todaySuccess

	successRate := 0.0
	if totalReqs > 0 {
		successRate = float64(totalSuccess) / float64(totalReqs) * 100
	}

	todaySuccessRate := 0.0
	if todayReqs > 0 {
		todaySuccessRate = float64(todaySuccess) / float64(todayReqs) * 100
	}

	common.Success(c, MetricsSummaryRes{
		TotalReqs:        totalReqs,
		SuccessRate:      successRate,
		PromptTokens:     agg.Prompt.Int64,
		CompletionTokens: agg.Completion.Int64,
		TodayReqs:        todayReqs,
		TodaySuccessRate: todaySuccessRate,
		TodaySuccessReqs: todaySuccess,
		TodayFailureReqs: todayFailure,
		TotalSuccessReqs: totalSuccess,
		TotalFailureReqs: totalFailure,
	})
}

// RequestAmountTrend 返回今日请求次数与金额的小时分布
func RequestAmountTrend(c *gin.Context) {
	ctx := c.Request.Context()
	now := time.Now()
	year, month, day := now.Date()
	startOfDay := time.Date(year, month, day, 0, 0, 0, 0, now.Location())
	endOfDay := startOfDay.Add(24 * time.Hour)

	base := models.DB.Model(&models.ChatLog{}).
		Where("deleted_at IS NULL").
		Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay)

	totalRequests, err := gorm.G[models.ChatLog](models.DB).Where("deleted_at IS NULL").Where("created_at >= ? AND created_at < ?", startOfDay, endOfDay).Count(ctx, "id")
	if err != nil {
		common.InternalServerError(c, "Failed to count requests: "+err.Error())
		return
	}

	var totalAmount sql.NullFloat64
	if err := base.Select("COALESCE(SUM(total_cost),0) AS amount").Scan(&totalAmount).Error; err != nil {
		common.InternalServerError(c, "Failed to sum amount: "+err.Error())
		return
	}

	type hourRow struct {
		HourBucket time.Time `gorm:"column:hour_bucket"`
		Requests   int64     `gorm:"column:requests"`
		Amount     float64   `gorm:"column:amount"`
	}
	rows := make([]hourRow, 0)
	if err := models.DB.Raw(
		`SELECT date_trunc('hour', created_at) AS hour_bucket,
		        COUNT(*) AS requests,
		        COALESCE(SUM(total_cost),0) AS amount
		   FROM chat_logs
		  WHERE deleted_at IS NULL
		    AND created_at >= ? AND created_at < ?
		  GROUP BY hour_bucket
		  ORDER BY hour_bucket`,
		startOfDay,
		endOfDay,
	).Scan(&rows).Error; err != nil {
		common.InternalServerError(c, "Failed to query trend: "+err.Error())
		return
	}

	hourMap := make(map[int]hourRow, len(rows))
	for _, row := range rows {
		hourMap[row.HourBucket.In(now.Location()).Hour()] = row
	}

	points := make([]RequestAmountPoint, 0, 24)
	for hour := 0; hour < 24; hour++ {
		if row, ok := hourMap[hour]; ok {
			points = append(points, RequestAmountPoint{
				Hour:     hour,
				Requests: row.Requests,
				Amount:   row.Amount,
			})
		} else {
			points = append(points, RequestAmountPoint{
				Hour:     hour,
				Requests: 0,
				Amount:   0,
			})
		}
	}

	common.Success(c, RequestAmountRes{
		TotalRequests: totalRequests,
		TotalAmount:   totalAmount.Float64,
		Range:         "today",
		Points:        points,
	})
}

type Count struct {
	Model string `json:"model"`
	Calls int64  `json:"calls"`
}

func Counts(c *gin.Context) {
	results := make([]Count, 0)
	if err := models.DB.
		Model(&models.ChatLog{}).
		Select("name as model, COUNT(*) as calls").
		Group("name").
		Order("calls DESC").
		Scan(&results).Error; err != nil {
		common.InternalServerError(c, err.Error())
		return
	}
	const topN = 5
	if len(results) > topN {
		var othersCalls int64
		for _, item := range results[topN:] {
			othersCalls += item.Calls
		}
		othersCount := Count{
			Model: "others",
			Calls: othersCalls,
		}
		results = append(results[:topN], othersCount)
	}

	common.Success(c, results)
}

type ProjectCount struct {
	Project string `json:"project"`
	Calls   int64  `json:"calls"`
}

func ProjectCounts(c *gin.Context) {
	type authKeyCount struct {
		AuthKeyID uint  `gorm:"column:auth_key_id"`
		Calls     int64 `gorm:"column:calls"`
	}

	rows := make([]authKeyCount, 0)
	if err := models.DB.
		Model(&models.ChatLog{}).
		Select("auth_key_id, COUNT(*) as calls").
		Group("auth_key_id").
		Order("calls DESC").
		Scan(&rows).Error; err != nil {
		common.InternalServerError(c, err.Error())
		return
	}

	ids := make([]uint, 0)
	for _, row := range rows {
		if row.AuthKeyID == 0 {
			continue
		}
		ids = append(ids, row.AuthKeyID)
	}

	keys := make([]models.AuthKey, 0)
	if len(ids) > 0 {
		if err := models.DB.
			Model(&models.AuthKey{}).
			Where("id IN ?", ids).
			Find(&keys).Error; err != nil {
			common.InternalServerError(c, err.Error())
			return
		}
	}

	keyMap := make(map[uint]string, len(keys))
	for _, key := range keys {
		keyMap[key.ID] = strings.TrimSpace(key.Name)
	}

	projectCalls := make(map[string]int64)
	for _, row := range rows {
		project := "-"
		if row.AuthKeyID == 0 {
			project = "admin"
		} else if name, ok := keyMap[row.AuthKeyID]; ok && name != "" {
			project = name
		}
		projectCalls[project] += row.Calls
	}

	results := make([]ProjectCount, 0, len(projectCalls))
	for project, calls := range projectCalls {
		results = append(results, ProjectCount{
			Project: project,
			Calls:   calls,
		})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Calls > results[j].Calls })

	const topN = 5
	if len(results) > topN {
		var othersCalls int64
		for _, item := range results[topN:] {
			othersCalls += item.Calls
		}
		othersCount := ProjectCount{
			Project: "others",
			Calls:   othersCalls,
		}
		results = append(results[:topN], othersCount)
	}

	common.Success(c, results)
}
