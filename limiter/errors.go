package limiter

import "errors"

// ErrLimiterUnavailable 表示限流/锁定所依赖的后端（通常是 Redis）不可用。
// 按用户配置可选择 fail-open 或 fail-closed；本项目当前策略由调用方决定。
var ErrLimiterUnavailable = errors.New("redis 限流不可用！！！")
