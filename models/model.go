package models

import (
	"net/http"
	"time"

	"gorm.io/gorm"
)

type Provider struct {
	gorm.Model
	Name          string
	Type          string
	Config        string
	Console       string // 控制台地址
	RpmLimit      int    // 每分钟请求数限制
	IpLockMinutes int    // IP 锁定时间（分钟）
}

type AnthropicConfig struct {
	BaseUrl string `json:"base_url"`
	ApiKey  string `json:"api_key"`
	Version string `json:"version"`
}

type Model struct {
	gorm.Model
	Name     string
	Remark   string
	MaxRetry int    // 重试次数限制
	TimeOut  int    // 超时时间 单位秒
	IOLog    int    // 是否记录IO (0/1)
	Strategy string // 负载均衡策略 默认 lottery
	Breaker  int    // 是否开启熔断 (0/1)
}

type ModelWithProvider struct {
	gorm.Model
	ModelID          uint
	ProviderModel    string
	ProviderID       uint
	ToolCall         int    // 能否接受带有工具调用的请求 (0/1)
	StructuredOutput int    // 能否接受带有结构化输出的请求 (0/1)
	Image            int    // 能否接受带有图片的请求(视觉) (0/1)
	WithHeader       int    // 是否透传header (0/1)
	Status           int    // 是否启用 (0/1)
	CustomerHeaders  string // 自定义headers (JSON)
	Weight           int
}

type ChatLog struct {
	gorm.Model
	UUID          string `gorm:"column:uuid"`
	Name          string `gorm:"index"`
	ProviderModel string `gorm:"index"`
	ProviderName  string `gorm:"index"`
	Status        string `gorm:"index"` // error or success
	Style         string // 类型
	UserAgent     string `gorm:"index"` // 用户代理
	RemoteIP      string // 访问ip
	AuthKeyID     uint   `gorm:"index"` // 使用的AuthKey ID
	ChatIO        int    // 是否开启IO记录 (0/1)

	Error            string // if status is error, this field will be set
	Retry            int    // 重试次数
	ProxyTimeMs      int    `gorm:"column:proxy_time_ms"`       // 代理耗时(毫秒)
	FirstChunkTimeMs int    `gorm:"column:first_chunk_time_ms"` // 首个chunk耗时(毫秒)
	ChunkTimeMs      int    `gorm:"column:chunk_time_ms"`       // chunk耗时(毫秒)
	Tps              float64
	Size             int // 响应大小 字节
	Usage
}

// TableName 指定表名
func (ChatLog) TableName() string {
	return "chat_logs"
}

func (l ChatLog) WithError(err error) ChatLog {
	l.Error = err.Error()
	l.Status = "error"
	return l
}

type Usage struct {
	PromptTokens        int64  `json:"prompt_tokens" gorm:"column:prompt_tokens"`
	CompletionTokens    int64  `json:"completion_tokens" gorm:"column:completion_tokens"`
	TotalTokens         int64  `json:"total_tokens" gorm:"column:total_tokens"`
	PromptTokensDetails string `json:"prompt_tokens_details" gorm:"column:prompt_tokens_details"` // JSON 字符串
}

type PromptTokensDetails struct {
	CachedTokens int64 `json:"cached_tokens"`
	AudioTokens  int64 `json:"audio_tokens"`
}

type ChatIO struct {
	gorm.Model
	LogId             uint `gorm:"column:log_id"`
	Input             string
	OutputString      string `gorm:"column:output_string"`
	OutputStringArray string `gorm:"column:output_string_array"` // JSON 数组字符串
}

// TableName 指定表名
func (ChatIO) TableName() string {
	return "chat_io"
}

type OutputUnion struct {
	OfString      string
	OfStringArray []string `gorm:"serializer:json"`
}

type ReqMeta struct {
	UserAgent string // 用户代理
	RemoteIP  string // 访问ip
	Header    http.Header
}

type AuthKey struct {
	gorm.Model
	Name       string // 项目名称
	Key        string
	Status     int        // 是否启用 (0/1)
	AllowAll   int        // 是否允许所有模型 (0/1)
	Models     string     // 允许的模型列表 (JSON 数组字符串)
	ExpiresAt  *time.Time // nil=永不过期，有值=具体过期时间
	UsageCount int64      // 使用次数统计
	LastUsedAt *time.Time // 最后使用时间
}

// TableName 指定表名
func (AuthKey) TableName() string {
	return "auth_keys"
}
