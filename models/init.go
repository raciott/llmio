package models

import (
	"context"

	"github.com/racio/llmio/consts"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// Init 初始化数据库连接
// dsn 格式: host=localhost user=postgres password=123456 dbname=llmio port=5432 sslmode=disable
// 注意: 表结构由 schema.sql 管理，请先执行 psql -d llmio -f schema.sql
func Init(ctx context.Context, dsn string) {
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
	if _, err := gorm.G[ChatLog](DB).Where("auth_key_id IS NULL").Update(ctx, "auth_key_id", 0); err != nil {
		// 忽略错误
	}
}
