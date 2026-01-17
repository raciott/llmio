package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/racio/llmio/common"
	"github.com/racio/llmio/consts"
)

func GetVersion(c *gin.Context) {
	common.Success(c, consts.Version)
}
