/**
 * Tests for stream transformation functions
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  toOpenAiStreamFlush,
  sseline,
  parseStream,
  parseStreamFlush,
  toOpenAiStream
} from '../../src/transformers/stream.mjs';
import { THINKING_MODES } from '../../src/constants/index.mjs';
import { STREAM_DELIMITER } from '../../src/constants/index.mjs';

describe('Stream Transformers', () => {
  describe('sseline', () => {
    it('should format object as SSE line', () => {
      const obj = {
        id: "test-id",
        object: "chat.completion.chunk",
        choices: []
      };

      const result = sseline(obj);

      expect(result).toMatch(/^data: /);
      expect(result).toMatch(/\n\n$/);

      const parsed = JSON.parse(result.substring(6, result.length - 2));
      expect(parsed.id).toBe("test-id");
      expect(parsed.created).toBeGreaterThan(0);
    });

    it('should add created timestamp', () => {
      const obj = { test: "data" };
      const before = Math.floor(Date.now() / 1000);

      const result = sseline(obj);

      const parsed = JSON.parse(result.substring(6, result.length - 2));
      expect(parsed.created).toBeGreaterThanOrEqual(before);
      expect(parsed.created).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    });
  });

  describe('parseStream', () => {
    let mockController;
    let context;

    beforeEach(() => {
      mockController = {
        enqueue: jest.fn()
      };
      context = {
        buffer: ""
      };
    });

    it('should parse complete data lines', () => {
      const chunk = 'data: {"test": "value"}\n\n';

      parseStream.call(context, chunk, mockController);

      expect(mockController.enqueue).toHaveBeenCalledWith('{"test": "value"}');
      expect(context.buffer).toBe("");
    });

    it('should handle multiple lines in one chunk', () => {
      const chunk = 'data: {"line1": "value1"}\n\ndata: {"line2": "value2"}\n\n';

      parseStream.call(context, chunk, mockController);

      expect(mockController.enqueue).toHaveBeenCalledTimes(2);
      expect(mockController.enqueue).toHaveBeenNthCalledWith(1, '{"line1": "value1"}');
      expect(mockController.enqueue).toHaveBeenNthCalledWith(2, '{"line2": "value2"}');
    });

    it('should buffer incomplete lines', () => {
      const chunk = 'data: {"incomplete": ';

      parseStream.call(context, chunk, mockController);

      expect(mockController.enqueue).not.toHaveBeenCalled();
      expect(context.buffer).toBe('data: {"incomplete": ');
    });

    it('should handle buffered data with new chunk', () => {
      context.buffer = 'data: {"incomplete": ';
      const chunk = '"value"}\n\n';

      parseStream.call(context, chunk, mockController);

      expect(mockController.enqueue).toHaveBeenCalledWith('{"incomplete": "value"}');
      expect(context.buffer).toBe("");
    });
  });

  describe('parseStreamFlush', () => {
    let mockController;
    let context;

    beforeEach(() => {
      mockController = {
        enqueue: jest.fn()
      };
      context = {
        buffer: "",
        shared: {}
      };
    });

    it('should flush remaining buffer', () => {
      context.buffer = "remaining data";

      parseStreamFlush.call(context, mockController);

      expect(mockController.enqueue).toHaveBeenCalledWith("remaining data");
      expect(context.shared.is_buffers_rest).toBe(true);
    });

    it('should not enqueue empty buffer', () => {
      context.buffer = "";

      parseStreamFlush.call(context, mockController);

      expect(mockController.enqueue).not.toHaveBeenCalled();
      expect(context.shared.is_buffers_rest).toBeUndefined();
    });
  });

  describe('toOpenAiStream', () => {
    let mockController;
    let context;

    beforeEach(() => {
      mockController = {
        enqueue: jest.fn()
      };
      context = {
        id: "test-id",
        model: "gemini-2.0-flash",
        last: [],
        thinkingMode: THINKING_MODES.STANDARD,
        streamIncludeUsage: false,
        shared: {}
      };
    });

    it('should transform valid Gemini stream chunk', () => {
      const line = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "Hello" }]
            },
            finishReason: "STOP",
            index: 0
          }
        ]
      });

      toOpenAiStream.call(context, line, mockController);

      expect(mockController.enqueue).toHaveBeenCalled();
      const calls = mockController.enqueue.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      // Parse the first call to check structure
      const firstCall = calls[0][0];
      expect(firstCall).toMatch(/^data: /);
      const parsed = JSON.parse(firstCall.substring(6, firstCall.length - 2));
      expect(parsed.id).toBe("test-id");
      expect(parsed.object).toBe("chat.completion.chunk");
    });

    it('should handle invalid JSON gracefully', () => {
      const line = "invalid json";

      toOpenAiStream.call(context, line, mockController);

      // Due to the bug in line 61: line =+ STREAM_DELIMITER becomes line = +STREAM_DELIMITER
      // which converts "\n\n" to 0 (whitespace strings convert to 0)
      expect(mockController.enqueue).toHaveBeenCalledWith(line + STREAM_DELIMITER);
    });

    it('should handle missing candidates', () => {
      const line = JSON.stringify({
        someOtherField: "value"
      });

      toOpenAiStream.call(context, line, mockController);

      // Same bug as above - line becomes 0
      expect(mockController.enqueue).toHaveBeenCalledWith(line + STREAM_DELIMITER);
    });

    it('should handle first chunk with role', () => {
      const line = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "Hello" }]
            },
            index: 0
          }
        ]
      });

      toOpenAiStream.call(context, line, mockController);

      expect(mockController.enqueue).toHaveBeenCalledTimes(2);

      // First call should include role
      const firstCall = mockController.enqueue.mock.calls[0][0];
      const firstParsed = JSON.parse(firstCall.substring(6, firstCall.length - 2));
      expect(firstParsed.choices[0].delta.role).toBe("assistant");
      expect(firstParsed.choices[0].delta.content).toBe("");
    });

    it('should include usage when streamIncludeUsage is true', () => {
      context.streamIncludeUsage = true;
      const line = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "Hello" }]
            },
            finishReason: "STOP",
            index: 0
          }
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15
        }
      });

      toOpenAiStream.call(context, line, mockController);

      // Check that usage is stored in the context for later use
      expect(context.last[0]).toBeDefined();
      expect(context.last[0].usage).toEqual({
        prompt_tokens: 5,
        completion_tokens: 10,
        total_tokens: 15
      });
    });

    it('should handle thinking mode in stream', () => {
      context.thinkingMode = THINKING_MODES.REFINED;
      const line = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "<thinking>reasoning</thinking>Answer" }]
            },
            index: 0
          }
        ]
      });

      toOpenAiStream.call(context, line, mockController);

      // Should process with thinking mode
      expect(mockController.enqueue).toHaveBeenCalled();
    });

    it('should handle prompt blocks', () => {
      const line = JSON.stringify({
        candidates: [],
        promptFeedback: {
          blockReason: "SAFETY",
          safetyRatings: [
            { category: "HARM_CATEGORY_HATE_SPEECH", blocked: true }
          ]
        }
      });

      toOpenAiStream.call(context, line, mockController);

      expect(mockController.enqueue).toHaveBeenCalledTimes(1);
      const call = mockController.enqueue.mock.calls[0][0];
      const parsed = JSON.parse(call.substring(6, call.length - 2));
      expect(parsed.choices[0].finish_reason).toBe("content_filter");
    });
  });
});

describe('toOpenAiStreamFlush', () => {
    let mockController;
    let context;

    beforeEach(() => {
      mockController = {
        enqueue: jest.fn()
      };
      context = {
        last: []
      };
    });

    it('should send final chunks and DONE signal when last array is not empty', () => {
      const mockObj1 = { id: "chunk1" };
      const mockObj2 = { id: "chunk2" };
      context.last = [mockObj1, mockObj2];

      toOpenAiStreamFlush.call(context, mockController);

      expect(mockController.enqueue).toHaveBeenCalledTimes(3);
      expect(mockController.enqueue).toHaveBeenNthCalledWith(1, sseline(mockObj1));
      expect(mockController.enqueue).toHaveBeenNthCalledWith(2, sseline(mockObj2));
      expect(mockController.enqueue).toHaveBeenNthCalledWith(3, "data: [DONE]\n\n");
    });

    it('should only send DONE signal when last array is empty', () => {
      context.last = [];

      toOpenAiStreamFlush.call(context, mockController);

      expect(mockController.enqueue).toHaveBeenCalledTimes(1);
      expect(mockController.enqueue).toHaveBeenNthCalledWith(1, "data: [DONE]\n\n");
    });
  });
