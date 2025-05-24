/**
 * Test fixtures for API responses
 */

export const geminiChatResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: "Hello! I'm doing well, thank you for asking. How can I help you today?"
          }
        ],
        role: "model"
      },
      finishReason: "STOP",
      index: 0,
      safetyRatings: [
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          probability: "NEGLIGIBLE"
        }
      ]
    }
  ],
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    totalTokenCount: 30
  }
};

export const openaiChatResponse = {
  id: "chatcmpl-test123",
  object: "chat.completion",
  created: 1234567890,
  model: "gemini-2.0-flash",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Hello! I'm doing well, thank you for asking. How can I help you today?"
      },
      finish_reason: "stop"
    }
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30
  }
};

export const geminiEmbeddingsResponse = {
  embeddings: [
    {
      values: new Array(768).fill(0).map(() => Math.random())
    },
    {
      values: new Array(768).fill(0).map(() => Math.random())
    }
  ]
};

export const openaiEmbeddingsResponse = {
  object: "list",
  data: [
    {
      object: "embedding",
      index: 0,
      embedding: new Array(768).fill(0).map(() => Math.random())
    },
    {
      object: "embedding",
      index: 1,
      embedding: new Array(768).fill(0).map(() => Math.random())
    }
  ],
  model: "text-embedding-004",
  usage: {
    prompt_tokens: 8,
    total_tokens: 8
  }
};

export const geminiModelsResponse = {
  models: [
    {
      name: "models/gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      description: "Fast and versatile multimodal model",
      inputTokenLimit: 1000000,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
    },
    {
      name: "models/gemini-pro",
      displayName: "Gemini Pro",
      description: "Best model for scaling across a wide range of tasks",
      inputTokenLimit: 30720,
      outputTokenLimit: 2048,
      supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
    }
  ]
};

export const openaiModelsResponse = {
  object: "list",
  data: [
    {
      id: "gemini-2.0-flash",
      object: "model",
      created: 1234567890,
      owned_by: "google"
    },
    {
      id: "gemini-pro",
      object: "model",
      created: 1234567890,
      owned_by: "google"
    }
  ]
};
