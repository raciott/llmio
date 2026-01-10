package consts

type ContextKey string

const (
	ContextKeyAllowAllModel ContextKey = "allow_all_model"
	ContextKeyAllowModels   ContextKey = "allow_models"
	ContextKeyAuthKeyID     ContextKey = "auth_key_id"
)

const (
	ContextKeyGeminiStream ContextKey = "gemini_stream"
	// ContextKeyGeminiMethod 用于覆盖 Gemini 目标方法（如 embedContent/batchEmbedContents）
	ContextKeyGeminiMethod ContextKey = "gemini_method"

	// ContextKeyOpenAIEndpoint 用于选择 OpenAI 目标 endpoint（如 chat_completions/embeddings）
	ContextKeyOpenAIEndpoint ContextKey = "openai_endpoint"
)
