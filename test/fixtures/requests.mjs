/**
 * Test fixtures for API requests
 */

export const chatCompletionRequest = {
  model: "gemini-2.0-flash",
  messages: [
    {
      role: "user",
      content: "Hello, how are you?"
    }
  ],
  temperature: 0.7,
  max_tokens: 100,
  stream: false
};

export const chatCompletionStreamRequest = {
  ...chatCompletionRequest,
  stream: true
};

export const chatCompletionWithThinkingRequest = {
  model: "gemini-2.0-flash-thinking-high",
  messages: [
    {
      role: "user",
      content: "Solve this complex math problem: What is the derivative of x^3 + 2x^2 - 5x + 1?"
    }
  ],
  temperature: 0.3,
  max_tokens: 500
};

export const chatCompletionWithImageRequest = {
  model: "gemini-2.0-flash",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "What's in this image?"
        },
        {
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
          }
        }
      ]
    }
  ]
};

export const embeddingsRequest = {
  model: "text-embedding-004",
  input: [
    "Hello world",
    "This is a test"
  ],
  dimensions: 768
};

export const modelsRequest = {};

export const invalidRequests = {
  noModel: {
    messages: [
      {
        role: "user",
        content: "Hello"
      }
    ]
  },
  invalidModel: {
    model: 123,
    messages: [
      {
        role: "user",
        content: "Hello"
      }
    ]
  },
  noMessages: {
    model: "gemini-2.0-flash"
  },
  emptyMessages: {
    model: "gemini-2.0-flash",
    messages: []
  }
};
