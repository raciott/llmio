package models

import "gorm.io/gorm"

// ModelPrice 模型价格表
type ModelPrice struct {
	gorm.Model
	ModelID    string  `gorm:"column:model_id;uniqueIndex;size:255"`
	Provider   string  `gorm:"column:provider;size:100"`
	Input      float64 `gorm:"column:input"`
	Output     float64 `gorm:"column:output"`
	CacheRead  float64 `gorm:"column:cache_read"`
	CacheWrite float64 `gorm:"column:cache_write"`
}
