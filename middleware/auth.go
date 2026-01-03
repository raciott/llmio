package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/common"
	"github.com/racio/llmio/consts"
	"github.com/racio/llmio/service"
)

// 用于系统数据操作相关鉴权
func Auth(token string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 不设置token，则不进行验证
		if token == "" {
			return
		}
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			common.ErrorWithHttpStatus(c, http.StatusUnauthorized, http.StatusUnauthorized, "Authorization header is missing")
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			common.ErrorWithHttpStatus(c, http.StatusUnauthorized, http.StatusUnauthorized, "Invalid authorization header")
			c.Abort()
			return
		}

		tokenString := parts[1]
		if tokenString != token {
			common.ErrorWithHttpStatus(c, http.StatusUnauthorized, http.StatusUnauthorized, "Invalid token")
			c.Abort()
			return
		}
	}
}

// 用于OpenAI接口鉴权
func AuthOpenAI(adminToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		parts := strings.SplitN(authHeader, " ", 2)

		var tokenString string
		if len(parts) == 2 && parts[0] == "Bearer" {
			tokenString = parts[1]
		}
		checkAuthKey(c, tokenString, adminToken)
	}
}

// 用于Anthropic接口鉴权
func AuthAnthropic(adminToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("x-api-key")
		checkAuthKey(c, authHeader, adminToken)
	}
}

// 用于Gemini原生接口鉴权
func AuthGemini(adminToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.GetHeader("x-goog-api-key")
		checkAuthKey(c, key, adminToken)
	}
}

func checkAuthKey(c *gin.Context, key string, adminToken string) {
	ctx := c.Request.Context()
	// 如果系统中未配置Token 或者使用的是最高权限的token 则允许访问所有模型
	if adminToken == "" || key == adminToken {
		ctx = context.WithValue(ctx, consts.ContextKeyAllowAllModel, true)
		c.Request = c.Request.WithContext(ctx)
		return
	}
	// 如果key为空 则拒绝访问
	if key == "" {
		common.ErrorWithHttpStatus(c, http.StatusUnauthorized, http.StatusUnauthorized, "Authorization key is missing")
		c.Abort()
		return
	}
	authKey, err := service.GetAuthKey(ctx, key)
	if err != nil {
		common.ErrorWithHttpStatus(c, http.StatusUnauthorized, http.StatusUnauthorized, "Invalid token")
		c.Abort()
		return
	}
	// 检查是否过期
	if authKey.ExpiresAt != nil && authKey.ExpiresAt.Before(time.Now()) {
		common.ErrorWithHttpStatus(c, http.StatusUnauthorized, http.StatusUnauthorized, "Token has expired")
		c.Abort()
		return
	}
	// 异步更新使用次数
	go service.KeyUpdate(authKey.ID, time.Now())

	allowAll := authKey.AllowAll == 1
	ctx = context.WithValue(ctx, consts.ContextKeyAuthKeyID, authKey.ID)
	ctx = context.WithValue(ctx, consts.ContextKeyAllowAllModel, allowAll)
	// 如果不允许所有模型 则设置允许的模型列表
	if !allowAll {
		// 解析 JSON 格式的 models
		var modelsList []string
		if authKey.Models != "" && authKey.Models != "[]" {
			_ = json.Unmarshal([]byte(authKey.Models), &modelsList)
		}
		ctx = context.WithValue(ctx, consts.ContextKeyAllowModels, modelsList)
	}

	c.Request = c.Request.WithContext(ctx)
}
