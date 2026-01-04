package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/balancers"
	"github.com/racio/llmio/consts"
	"github.com/racio/llmio/models"
	"github.com/racio/llmio/pkg"
	"github.com/racio/llmio/providers"
	"github.com/samber/lo"
	"gorm.io/gorm"
)

func safeBodyTextForLog(res *http.Response, body []byte) string {
	if len(body) == 0 {
		return ""
	}

	decoded := body
	decodedLabel := ""

	contentEncoding := strings.ToLower(strings.TrimSpace(res.Header.Get("Content-Encoding")))
	isGzip := contentEncoding == "gzip" || (len(body) >= 2 && body[0] == 0x1f && body[1] == 0x8b)
	if isGzip {
		if zr, err := gzip.NewReader(bytes.NewReader(body)); err == nil {
			if b, err := io.ReadAll(zr); err == nil {
				decoded = b
				decodedLabel = " (gzip 解压后)"
			}
			_ = zr.Close()
		}
	}

	const maxBytes = 4096
	truncated := false
	totalBytes := len(decoded)
	if totalBytes > maxBytes {
		decoded = decoded[:maxBytes]
		truncated = true
	}

	if utf8.Valid(decoded) {
		text := string(decoded)
		if truncated {
			return fmt.Sprintf("%s%s...(已截断，总计 %d 字节)", text, decodedLabel, totalBytes)
		}
		return text + decodedLabel
	}

	// 非 UTF-8 内容：用 base64 保存（避免 PostgreSQL UTF8 编码错误）
	b64 := base64.StdEncoding.EncodeToString(decoded)
	if truncated {
		return fmt.Sprintf("base64%s:%s...(已截断，总计 %d 字节)", decodedLabel, b64, totalBytes)
	}
	return fmt.Sprintf("base64%s:%s", decodedLabel, b64)
}

// BalanceChatWithLimiter 带限流功能的聊天负载均衡
func BalanceChatWithLimiter(c *gin.Context, start time.Time, style string, before Before, providersWithMeta *ProvidersWithMeta, reqMeta models.ReqMeta) (*http.Response, *models.ChatLog, error) {
	return balanceChatInternal(c, start, style, before, providersWithMeta, reqMeta, true)
}

func BalanceChat(ctx context.Context, start time.Time, style string, before Before, providersWithMeta *ProvidersWithMeta, reqMeta models.ReqMeta) (*http.Response, *models.ChatLog, error) {
	return balanceChatInternal(nil, start, style, before, providersWithMeta, reqMeta, false)
}

// balanceChatInternal 内部聊天负载均衡实现
func balanceChatInternal(c *gin.Context, start time.Time, style string, before Before, providersWithMeta *ProvidersWithMeta, reqMeta models.ReqMeta, enableLimiter bool) (*http.Response, *models.ChatLog, error) {
	slog.Info("request", "model", before.Model, "stream", before.Stream, "tool_call", before.toolCall, "structured_output", before.structuredOutput, "image", before.image)

	// 获取context
	var ctx context.Context
	if c != nil {
		ctx = c.Request.Context()
	} else {
		ctx = context.Background()
	}

	providerMap := providersWithMeta.ProviderMap

	// 收集重试过程中的err日志
	retryLog := make(chan models.ChatLog, providersWithMeta.MaxRetry)
	defer close(retryLog)

	go RecordRetryLog(context.Background(), retryLog)

	// 选择负载均衡策略
	var balancer balancers.Balancer
	switch providersWithMeta.Strategy {
	case consts.BalancerLottery:
		balancer = balancers.NewLottery(providersWithMeta.WeightItems)
	case consts.BalancerRotor:
		balancer = balancers.NewRotor(providersWithMeta.WeightItems)
	default:
		balancer = balancers.NewLottery(providersWithMeta.WeightItems)
	}

	// 是否开启熔断
	if providersWithMeta.Breaker {
		balancer = balancers.BalancerWrapperBreaker(balancer)
	}

	// 设置请求超时
	responseHeaderTimeout := time.Second * time.Duration(providersWithMeta.TimeOut)
	// 流式超时时间缩短
	if before.Stream {
		responseHeaderTimeout = responseHeaderTimeout / 3
	}
	client := providers.GetClient(responseHeaderTimeout)

	authKeyID, _ := ctx.Value(consts.ContextKeyAuthKeyID).(uint)

	timer := time.NewTimer(time.Second * time.Duration(providersWithMeta.TimeOut))
	defer timer.Stop()
	for retry := range providersWithMeta.MaxRetry {
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-timer.C:
			return nil, nil, errors.New("retry time out")
		default:
			// 加权负载均衡
			id, err := balancer.Pop()
			if err != nil {
				return nil, nil, err
			}

			modelWithProvider, ok := providersWithMeta.ModelWithProviderMap[id]
			if !ok {
				// 数据不一致，移除该模型避免下次重复命中
				balancer.Delete(id)
				continue
			}

			provider := providerMap[modelWithProvider.ProviderID]

			// 限流检查
			if enableLimiter && c != nil {
				canProceed, reason, err := CheckProviderLimits(ctx, c, provider.ID, provider.RpmLimit, provider.IpLockMinutes)
				if err != nil {
					slog.Warn("Limiter check failed", "provider", provider.Name, "error", err)
					// 限流检查失败时继续，但记录警告
				} else if !canProceed {
					slog.Info("Provider blocked by limiter", "provider", provider.Name, "reason", reason)
					balancer.Reduce(id) // 降低权重，但不完全删除
					continue
				}
			}

			chatModel, err := providers.New(provider.Type, provider.Config)
			if err != nil {
				return nil, nil, err
			}

			slog.Info("using provider", "provider", provider.Name, "model", modelWithProvider.ProviderModel)

			// 是否记录IO
			ioLog := 0
			if providersWithMeta.IOLog {
				ioLog = 1
			}

			log := models.ChatLog{
				Name:          before.Model,
				ProviderModel: modelWithProvider.ProviderModel,
				ProviderName:  provider.Name,
				Status:        "success",
				Style:         style,
				UserAgent:     reqMeta.UserAgent,
				RemoteIP:      reqMeta.RemoteIP,
				AuthKeyID:     authKeyID,
				ChatIO:        ioLog,
				Retry:         retry,
				ProxyTimeMs:   int(time.Since(start).Milliseconds()),
			}
			// 根据请求原始请求头 是否透传请求头 自定义请求头 构建新的请求头
			withHeader := modelWithProvider.WithHeader == 1
			// 解析自定义请求头
			customHeaders := make(map[string]string)
			if modelWithProvider.CustomerHeaders != "" {
				if err := json.Unmarshal([]byte(modelWithProvider.CustomerHeaders), &customHeaders); err != nil {
					slog.Error("parse custom headers error", "error", err)
				}
			}
			header := BuildHeaders(reqMeta.Header, withHeader, customHeaders, before.Stream)

			req, err := chatModel.BuildReq(ctx, header, modelWithProvider.ProviderModel, before.raw)
			if err != nil {
				retryLog <- log.WithError(err)
				// 构建请求失败 移除待选
				balancer.Delete(id)
				continue
			}

			res, err := client.Do(req)
			if err != nil {
				retryLog <- log.WithError(err)
				// 请求失败 移除待选
				balancer.Delete(id)
				continue
			}

			if res.StatusCode != http.StatusOK {
				byteBody, err := io.ReadAll(res.Body)
				if err != nil {
					slog.Error("read body error", "error", err)
				}
				retryLog <- log.WithError(fmt.Errorf("status: %d, body: %s", res.StatusCode, safeBodyTextForLog(res, byteBody)))

				if res.StatusCode == http.StatusTooManyRequests {
					// 达到RPM限制 降低权重
					balancer.Reduce(id)
				} else {
					// 非RPM限制 移除待选
					balancer.Delete(id)
				}
				res.Body.Close()
				continue
			}

			balancer.Success(id)

			// 记录限流访问
			if enableLimiter && c != nil {
				if err := RecordProviderAccess(ctx, c, provider.ID, provider.RpmLimit, provider.IpLockMinutes); err != nil {
					slog.Warn("Failed to record provider access", "provider", provider.Name, "error", err)
				}
			}

			return res, &log, nil
		}
	}

	return nil, nil, errors.New("maximum retry attempts reached")
}

func RecordRetryLog(ctx context.Context, retryLog chan models.ChatLog) {
	for log := range retryLog {
		if _, err := SaveChatLog(ctx, log); err != nil {
			slog.Error("save chat log error", "error", err)
		}
	}
}

func RecordLog(ctx context.Context, reqStart time.Time, reader io.ReadCloser, processer Processer, logId uint, before Before, ioLog bool) {
	recordFunc := func() error {
		defer reader.Close()
		if ioLog {
			if err := gorm.G[models.ChatIO](models.DB).Create(ctx, &models.ChatIO{
				Input: string(before.raw),
				LogId: logId,
			}); err != nil {
				return err
			}
		}
		log, output, err := processer(ctx, reader, before.Stream, reqStart)
		if err != nil {
			return err
		}
		if _, err := gorm.G[models.ChatLog](models.DB).Where("id = ?", logId).Updates(ctx, *log); err != nil {
			return err
		}
		if ioLog {
			chatIO := models.ChatIO{}
			if output.OfString != "" {
				chatIO.OutputString = output.OfString
			} else if len(output.OfStringArray) > 0 {
				// 将字符串数组序列化为JSON
				if jsonBytes, err := json.Marshal(output.OfStringArray); err == nil {
					chatIO.OutputStringArray = string(jsonBytes)
				}
			}
			if _, err := gorm.G[models.ChatIO](models.DB).Where("log_id = ?", logId).Updates(ctx, chatIO); err != nil {
				return err
			}
		}
		return nil
	}
	if err := recordFunc(); err != nil {
		slog.Error("record log error", "error", err)
	}
}

func SaveChatLog(ctx context.Context, log models.ChatLog) (uint, error) {
	// chat_logs.uuid 在数据库中是 NOT NULL UNIQUE，必须保证每条记录都有唯一值。
	if log.UUID == "" {
		uuid, err := pkg.GenerateRandomCharsKey(36)
		if err != nil {
			return 0, err
		}
		log.UUID = uuid
	}

	// 极低概率下可能发生 UUID 冲突；若命中唯一约束，生成新 UUID 后重试。
	for attempt := 0; attempt < 3; attempt++ {
		if err := gorm.G[models.ChatLog](models.DB).Create(ctx, &log); err != nil {
			// 兼容不同 driver 的错误类型：这里用 SQLSTATE 文本匹配，不引入额外依赖。
			if strings.Contains(err.Error(), "SQLSTATE 23505") {
				uuid, genErr := pkg.GenerateRandomCharsKey(36)
				if genErr != nil {
					return 0, genErr
				}
				log.UUID = uuid
				continue
			}
			return 0, err
		}
		return log.ID, nil
	}

	return 0, errors.New("failed to generate unique chat log uuid")
}

func BuildHeaders(source http.Header, withHeader bool, customHeaders map[string]string, stream bool) http.Header {
	header := http.Header{}
	if withHeader {
		header = source.Clone()
	}

	if stream {
		header.Set("X-Accel-Buffering", "no")
	}

	header.Del("Authorization")
	header.Del("X-Api-Key")
	header.Del("X-Goog-Api-Key")

	for key, value := range customHeaders {
		header.Set(key, value)
	}

	return header
}

type ProvidersWithMeta struct {
	ModelWithProviderMap map[uint]models.ModelWithProvider
	WeightItems          map[uint]int
	ProviderMap          map[uint]models.Provider
	MaxRetry             int
	TimeOut              int
	IOLog                bool
	Strategy             string // 负载均衡策略
	Breaker              bool   // 是否开启熔断
}

func ProvidersWithMetaBymodelsName(ctx context.Context, style string, before Before) (*ProvidersWithMeta, error) {
	model, err := gorm.G[models.Model](models.DB).Where("name = ?", before.Model).First(ctx)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if _, err := SaveChatLog(ctx, models.ChatLog{
				Name:   before.Model,
				Status: "error",
				Style:  style,
				Error:  err.Error(),
			}); err != nil {
				return nil, err
			}
			return nil, errors.New("not found model " + before.Model)
		}
		return nil, err
	}

	// model_with_providers.status/tool_call/structured_output/image 在数据库中是 0/1（int）
	modelWithProviderChain := gorm.G[models.ModelWithProvider](models.DB).Where("model_id = ?", model.ID).Where("status = ?", 1)

	if before.toolCall {
		modelWithProviderChain = modelWithProviderChain.Where("tool_call = ?", 1)
	}

	if before.structuredOutput {
		modelWithProviderChain = modelWithProviderChain.Where("structured_output = ?", 1)
	}

	if before.image {
		modelWithProviderChain = modelWithProviderChain.Where("image = ?", 1)
	}

	modelWithProviders, err := modelWithProviderChain.Find(ctx)
	if err != nil {
		return nil, err
	}

	if len(modelWithProviders) == 0 {
		return nil, errors.New("not provider for model " + before.Model)
	}

	modelWithProviderMap := lo.KeyBy(modelWithProviders, func(mp models.ModelWithProvider) uint { return mp.ID })

	providers, err := gorm.G[models.Provider](models.DB).
		Where("id IN ?", lo.Map(modelWithProviders, func(mp models.ModelWithProvider, _ int) uint { return mp.ProviderID })).
		Where("type = ?", style).
		Find(ctx)
	if err != nil {
		return nil, err
	}

	providerMap := lo.KeyBy(providers, func(p models.Provider) uint { return p.ID })

	weightItems := make(map[uint]int)
	for _, mp := range modelWithProviders {
		if _, ok := providerMap[mp.ProviderID]; !ok {
			continue
		}
		weightItems[mp.ID] = mp.Weight
	}

	// IOLog 和 Breaker 现在是 int 类型(0/1)
	ioLog := model.IOLog == 1
	breaker := model.Breaker == 1

	return &ProvidersWithMeta{
		ModelWithProviderMap: modelWithProviderMap,
		WeightItems:          weightItems,
		ProviderMap:          providerMap,
		MaxRetry:             model.MaxRetry,
		TimeOut:              model.TimeOut,
		IOLog:                ioLog,
		Strategy:             model.Strategy,
		Breaker:              breaker,
	}, nil
}
