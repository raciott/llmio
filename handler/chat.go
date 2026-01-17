package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/common"
	"github.com/racio/llmio/consts"
	"github.com/racio/llmio/limiter"
	"github.com/racio/llmio/models"
	"github.com/racio/llmio/service"
)

func ChatCompletionsHandler(c *gin.Context) {
	chatHandler(c, service.BeforerOpenAI, service.ProcesserOpenAI, consts.StyleOpenAI, consts.StyleOpenAI)
}

func ResponsesHandler(c *gin.Context) {
	chatHandler(c, service.BeforerOpenAIRes, service.ProcesserOpenAiRes, consts.StyleOpenAIRes, consts.StyleOpenAIRes)
}

func Messages(c *gin.Context) {
	slog.Info("Request headers captured", "path", c.FullPath(), "headers", formatHeadersJSON(c.Request.Header))
	chatHandler(c, service.BeforerAnthropic, service.ProcesserAnthropic, consts.StyleAnthropic, consts.StyleAnthropic)
}

// EmbeddingsHandler 转发 OpenAI 兼容 embeddings 接口:
// POST /v1/embeddings
func EmbeddingsHandler(c *gin.Context) {
	ctx := context.WithValue(c.Request.Context(), consts.ContextKeyOpenAIEndpoint, "embeddings")
	c.Request = c.Request.WithContext(ctx)
	chatHandler(c, service.BeforerOpenAI, service.ProcesserOpenAI, consts.StyleOpenAI, consts.StyleOpenAIEmbeddings)
}

// GeminiGenerateContentHandler 转发 Gemini 原生接口:
// POST /v1beta/models/{model}:generateContent
func GeminiGenerateContentHandler(c *gin.Context) {
	modelAction := strings.TrimPrefix(c.Param("modelAction"), "/")
	model, method, ok := strings.Cut(modelAction, ":")
	if !ok || model == "" || method == "" {
		common.BadRequest(c, "Invalid Gemini model action")
		return
	}
	stream := false
	logStyle := consts.StyleGemini
	switch method {
	case "generateContent":
		stream = false
	case "streamGenerateContent":
		stream = true
	case "embedContent", "batchEmbedContents":
		// Embeddings 不支持 SSE，这里强制非流式，并在日志中标注为 embeddings
		stream = false
		logStyle = consts.StyleGeminiEmbeddings
	default:
		common.BadRequest(c, "Unsupported Gemini method: "+method)
		return
	}

	ctx := context.WithValue(c.Request.Context(), consts.ContextKeyGeminiStream, stream)
	// 让 provider 端按 method 路由到正确的 Gemini REST 方法（embedContent/batchEmbedContents）
	if logStyle == consts.StyleGeminiEmbeddings {
		ctx = context.WithValue(ctx, consts.ContextKeyGeminiMethod, method)
	}
	c.Request = c.Request.WithContext(ctx)

	chatHandler(c, service.NewBeforerGemini(model, stream), service.ProcesserGemini, consts.StyleGemini, logStyle)
}

func chatHandler(c *gin.Context, preProcessor service.Beforer, postProcessor service.Processer, providerType string, logStyle string) {
	// 读取原始请求体
	reqBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		common.InternalServerError(c, err.Error())
		return
	}
	c.Request.Body.Close()
	// 预处理、提取模型参数
	before, err := preProcessor(reqBody)
	if err != nil {
		common.InternalServerError(c, err.Error())
		return
	}

	ctx := c.Request.Context()
	// 校验 authKey 是否有权限使用该模型
	valid, err := validateAuthKey(ctx, before.Model)
	if err != nil {
		common.InternalServerError(c, err.Error())
		return
	}
	if !valid {
		common.ErrorWithHttpStatus(c, http.StatusForbidden, http.StatusForbidden, "auth key has no permission to use this model")
		return
	}
	// 按模型获取可用 provider
	providersWithMeta, err := service.ProvidersWithMetaBymodelsName(ctx, providerType, logStyle, *before)
	if err != nil {
		common.InternalServerError(c, err.Error())
		return
	}

	startReq := time.Now()
	// 调用负载均衡后的 provider 并转发
	res, log, err := service.BalanceChatWithLimiter(c, startReq, logStyle, *before, providersWithMeta, models.ReqMeta{
		Header:    c.Request.Header,
		RemoteIP:  c.ClientIP(),
		UserAgent: c.Request.UserAgent(),
	})
	if err != nil {
		// 限流/锁定依赖不可用：按 fail-closed 策略直接拒绝
		if errors.Is(err, limiter.ErrLimiterUnavailable) {
			common.ErrorWithHttpStatus(c, http.StatusServiceUnavailable, http.StatusServiceUnavailable, "限流服务不可用，请稍后重试")
			return
		}
		common.InternalServerError(c, err.Error())
		return
	}
	defer res.Body.Close()

	logId, err := service.SaveChatLog(ctx, *log)
	if err != nil {
		common.InternalServerError(c, err.Error())
		return
	}

	pr, pw := io.Pipe()
	tee := io.TeeReader(res.Body, pw)
	// 异步处理输出并记录 tokens
	go service.RecordLog(context.Background(), startReq, pr, postProcessor, logId, *before, providersWithMeta.IOLog)

	writeHeader(c, before.Stream, res.Header)
	if _, err := io.Copy(c.Writer, tee); err != nil {
		pw.CloseWithError(err)
		slog.Error("io copy", "err:", err)
		return
	}

	pw.Close()
}

func writeHeader(c *gin.Context, stream bool, header http.Header) {
	for k, values := range header {
		for _, value := range values {
			c.Writer.Header().Add(k, value)
		}
	}

	if stream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
	}
	c.Writer.Flush()
}

func formatHeadersJSON(header http.Header) string {
	content, err := json.MarshalIndent(header, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(content)
}

// 校验auhtKey的模型使用权限
func validateAuthKey(ctx context.Context, model string) (bool, error) {
	// 验证是否为允许全部模型
	allowAll, ok := ctx.Value(consts.ContextKeyAllowAllModel).(bool)
	if !ok {
		return false, errors.New("invalid auth key")
	}
	if allowAll {
		return true, nil
	}
	// 验证是否有权限使用该模型
	allowedModels, ok := ctx.Value(consts.ContextKeyAllowModels).([]string)
	if !ok {
		return false, errors.New("invalid auth key")
	}
	return slices.Contains(allowedModels, model), nil
}
