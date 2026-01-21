package models

import "gorm.io/gorm"

type Config struct {
	gorm.Model
	Key   string // 配置类型
	Value string // 配置内容
}

const (
	KeyAnthropicCountTokens = "anthropic_count_tokens"
	// KeyAnthropicProxyIP Claude 代理 IP 配置（用于覆盖 X-Forwarded-For/X-Real-IP）
	KeyAnthropicProxyIP = "anthropic_proxy_ip"
	// KeyFirstDeployTime 首次部署时间（用于跨重启统计系统总运行时间），值为 RFC3339 时间字符串（UTC）。
	KeyFirstDeployTime = "first_deploy_time"
)

type AnthropicCountTokens struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	Version string `json:"version"`
}

type AnthropicProxyIPConfig struct {
	Enabled bool   `json:"enabled"`
	ProxyIP string `json:"proxy_ip"`
}
