/**
 * Tests for response transformation functions
 */
import { describe, it, expect } from '@jest/globals';
import {
  transformUsage,
  transformCandidates,
  transformCandidatesDelta,
  checkPromptBlock,
  processCompletionsResponse
} from '../../src/transformers/response.mjs';
import { THINKING_MODES } from '../../src/constants/index.mjs';

describe('Response Transformers', () => {
  describe('transformUsage', () => {
    it('should transform usage data correctly', () => {
      const data = {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30
      };

      const result = transformUsage(data);

      expect(result).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      });
    });

    it('should handle missing fields', () => {
      const data = {
        promptTokenCount: 5
      };

      const result = transformUsage(data);

      expect(result).toEqual({
        prompt_tokens: 5,
        completion_tokens: undefined,
        total_tokens: undefined
      });
    });
  });

  describe('transformCandidates', () => {
    it('should transform basic text candidate', () => {
      const candidate = {
        content: {
          parts: [
            { text: "Hello, how can I help you?" }
          ]
        },
        finishReason: "STOP",
        index: 0
      };

      const result = transformCandidates("message", candidate);

      expect(result).toEqual({
        index: 0,
        message: {
          role: "assistant",
          content: "Hello, how can I help you?"
        },
        logprobs: null,
        finish_reason: "stop"
      });
    });

    it('should transform candidate with multiple text parts', () => {
      const candidate = {
        content: {
          parts: [
            { text: "First part" },
            { text: "Second part" }
          ]
        },
        finishReason: "STOP"
      };

      const result = transformCandidates("message", candidate);

      expect(result.message.content).toBe("First part\n\n|>Second part");
    });

    it('should transform candidate with function call', () => {
      const candidate = {
        content: {
          parts: [
            {
              functionCall: {
                name: "get_weather",
                args: { location: "New York" }
              }
            }
          ]
        },
        finishReason: "STOP"
      };

      const result = transformCandidates("message", candidate);

      expect(result.message.tool_calls).toHaveLength(1);
      expect(result.message.tool_calls[0]).toEqual({
        id: expect.stringMatching(/^call_/),
        type: "function",
        function: {
          name: "get_weather",
          arguments: '{"location":"New York"}'
        }
      });
      expect(result.finish_reason).toBe("tool_calls");
    });

    it('should handle thinking mode - standard', () => {
      const candidate = {
        content: {
          parts: [
            { text: "<thinking>This is internal reasoning</thinking>The answer is 42." }
          ]
        },
        finishReason: "STOP"
      };

      const result = transformCandidates("message", candidate, THINKING_MODES.STANDARD);

      expect(result.message.content).toBe("<thinking>This is internal reasoning</thinking>The answer is 42.");
    });

    it('should handle thinking mode - refined', () => {
      const candidate = {
        content: {
          parts: [
            { text: "<thinking>This is internal reasoning</thinking>The answer is 42." }
          ]
        },
        finishReason: "STOP"
      };

      const result = transformCandidates("message", candidate, THINKING_MODES.REFINED);

      expect(result.message.content).toBe("The answer is 42.");
    });

    it('should handle empty content', () => {
      const candidate = {
        content: {
          parts: []
        },
        finishReason: "STOP"
      };

      const result = transformCandidates("message", candidate);

      expect(result.message.content).toBeNull();
    });

    it('should handle missing content', () => {
      const candidate = {
        finishReason: "STOP"
      };

      const result = transformCandidates("message", candidate);

      expect(result.message.content).toBeNull();
    });

    it('should default index to 0 when missing', () => {
      const candidate = {
        content: {
          parts: [{ text: "test" }]
        },
        finishReason: "STOP"
      };

      const result = transformCandidates("message", candidate);

      expect(result.index).toBe(0);
    });
  });

  describe('transformCandidatesDelta', () => {
    it('should transform delta candidate', () => {
      const candidate = {
        content: {
          parts: [
            { text: "Hello" }
          ]
        },
        finishReason: "STOP",
        index: 0
      };

      const result = transformCandidatesDelta(candidate);

      expect(result).toEqual({
        index: 0,
        delta: {
          role: "assistant",
          content: "Hello"
        },
        logprobs: null,
        finish_reason: "stop"
      });
    });

    it('should handle function call in delta', () => {
      const candidate = {
        content: {
          parts: [
            {
              functionCall: {
                name: "get_weather",
                args: { location: "NYC" }
              }
            }
          ]
        },
        finishReason: "STOP"
      };

      const result = transformCandidatesDelta(candidate);

      expect(result.delta.tool_calls).toHaveLength(1);
      expect(result.finish_reason).toBe("tool_calls");
    });
  });

  describe('checkPromptBlock', () => {
    it('should return undefined when choices exist', () => {
      const choices = [{ index: 0, message: { content: "test" } }];
      const promptFeedback = { blockReason: "SAFETY" };

      const result = checkPromptBlock(choices, promptFeedback, "message");

      expect(result).toBeUndefined();
      expect(choices).toHaveLength(1);
    });

    it('should add content_filter choice when blocked', () => {
      const choices = [];
      const promptFeedback = {
        blockReason: "SAFETY",
        safetyRatings: [
          { category: "HARM_CATEGORY_HATE_SPEECH", blocked: true }
        ]
      };

      const result = checkPromptBlock(choices, promptFeedback, "message");

      expect(result).toBe(true);
      expect(choices).toHaveLength(1);
      expect(choices[0]).toEqual({
        index: 0,
        message: null,
        finish_reason: "content_filter"
      });
    });

    it('should handle no block reason', () => {
      const choices = [];
      const promptFeedback = {};

      const result = checkPromptBlock(choices, promptFeedback, "message");

      expect(result).toBe(true);
      expect(choices).toHaveLength(0);
    });
  });

  describe('processCompletionsResponse', () => {
    it('should process complete response', () => {
      const data = {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello!" }]
            },
            finishReason: "STOP",
            index: 0
          }
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15
        },
        modelVersion: "gemini-2.0-flash-001"
      };

      const result = JSON.parse(processCompletionsResponse(data, "gemini-2.0-flash", "test-id"));

      expect(result).toEqual({
        id: "test-id",
        object: "chat.completion",
        created: expect.any(Number),
        model: "gemini-2.0-flash-001",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello!"
            },
            logprobs: null,
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 10,
          total_tokens: 15
        }
      });
    });

    it('should handle response with no candidates', () => {
      const data = {
        candidates: [],
        promptFeedback: {
          blockReason: "SAFETY",
          safetyRatings: [
            { category: "HARM_CATEGORY_HATE_SPEECH", blocked: true }
          ]
        }
      };

      const result = JSON.parse(processCompletionsResponse(data, "gemini-2.0-flash", "test-id"));

      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].finish_reason).toBe("content_filter");
    });

    it('should handle thinking mode', () => {
      const data = {
        candidates: [
          {
            content: {
              parts: [{ text: "<thinking>reasoning</thinking>Answer" }]
            },
            finishReason: "STOP"
          }
        ]
      };

      const result = JSON.parse(processCompletionsResponse(data, "gemini-2.0-flash", "test-id", THINKING_MODES.REFINED));

      expect(result.choices[0].message.content).toBe("Answer");
    });
  });
});
