package models

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/racio/llmio/consts"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// Init 初始化数据库连接
// dbType 支持：postgres/mysql
// postgres:
// - key=value DSN: host=localhost user=postgres password=postgres dbname=llmio port=5432 sslmode=disable
// - URL: postgres://postgres:postgres@localhost:5432/llmio?sslmode=disable
// mysql:
// - DSN: user:pass@tcp(host:3306)/llmio?charset=utf8mb4&parseTime=True&loc=Local
// - URL: mysql://user:pass@host:3306/llmio?charset=utf8mb4&parseTime=true&loc=Local
func Init(ctx context.Context, dbType string, dsn string) {
	dbType = strings.TrimSpace(strings.ToLower(dbType))
	if dbType == "" {
		dbType = "postgres"
	}

	var dialector gorm.Dialector
	switch dbType {
	case "postgres", "pg", "postgresql":
		dialector = postgres.Open(dsn)
	case "mysql":
		mysqlDSN, err := normalizeMySQLDSN(dsn)
		if err != nil {
			panic(err)
		}
		dialector = mysql.Open(mysqlDSN)
	default:
		panic(fmt.Errorf("unsupported DATABASE_TYPE: %s", dbType))
	}

	db, err := gorm.Open(dialector, &gorm.Config{})
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

func DialectName() string {
	if DB == nil || DB.Dialector == nil {
		return ""
	}
	return DB.Dialector.Name()
}

// normalizeMySQLDSN 兼容 mysql:// URL 写法，转换为 driver 可接受的 DSN。
func normalizeMySQLDSN(in string) (string, error) {
	s := strings.TrimSpace(in)
	if s == "" {
		return "", fmt.Errorf("empty mysql dsn")
	}
	if strings.HasPrefix(strings.ToLower(s), "mysql://") {
		u, err := url.Parse(s)
		if err != nil {
			return "", fmt.Errorf("invalid mysql url: %w", err)
		}

		user := ""
		pass := ""
		if u.User != nil {
			user = u.User.Username()
			pass, _ = u.User.Password()
		}
		host := u.Host
		dbName := strings.TrimPrefix(u.Path, "/")
		if dbName == "" {
			return "", fmt.Errorf("mysql url missing database name")
		}
		q := u.Query()
		if q.Get("charset") == "" {
			q.Set("charset", "utf8mb4")
		}
		if q.Get("parseTime") == "" && q.Get("parsetime") == "" {
			q.Set("parseTime", "True")
		}
		if q.Get("loc") == "" {
			q.Set("loc", "Local")
		}
		u.RawQuery = q.Encode()

		auth := user
		if pass != "" {
			auth = auth + ":" + pass
		}
		return fmt.Sprintf("%s@tcp(%s)/%s?%s", auth, host, dbName, u.RawQuery), nil
	}
	return s, nil
}
