package models

import (
	"context"
	"errors"
	"strings"

	"github.com/racio/llmio/consts"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// Init 初始化数据库连接（仅支持 PostgreSQL）
// postgres:
// - key=value DSN: host=localhost user=postgres password=postgres dbname=llmio port=5432 sslmode=disable
// - URL: postgres://postgres:postgres@localhost:5432/llmio?sslmode=disable
func Init(ctx context.Context, dsn string) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		panic(errors.New("empty DATABASE_DSN"))
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	DB = db

	// 兼容性数据修复
	if _, err := gorm.G[ModelWithProvider](DB).Where("status IS NULL").Update(ctx, "status", true); err != nil {
		// 忽略错误，可能表为空
	}
	if _, err := gorm.G[ModelWithProvider](DB).Where("customer_headers IS NULL OR customer_headers = ''").Update(ctx, "customer_headers", "{}"); err != nil {
		// 忽略错误
	}
	if _, err := gorm.G[Model](DB).Where("strategy = '' OR strategy IS NULL").Update(ctx, "strategy", consts.BalancerDefault); err != nil {
		// 忽略错误
	}
	if _, err := gorm.G[Model](DB).Where("breaker IS NULL").Update(ctx, "breaker", 0); err != nil {
		// 忽略错误
	}
	if _, err := gorm.G[Model](DB).Where("status IS NULL").Update(ctx, "status", 1); err != nil {
		// 忽略错误
	}
	if _, err := gorm.G[ChatLog](DB).Where("auth_key_id IS NULL").Update(ctx, "auth_key_id", 0); err != nil {
		// 忽略错误
	}
}
