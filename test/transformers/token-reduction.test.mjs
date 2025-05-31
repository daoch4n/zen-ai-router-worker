/**
 * Tests for token reduction integration in request transformers
 */
import { transformMessages } from '../../src/transformers/request.mjs';

describe('Token Reduction Integration', () => {
  describe('transformMessages with token reduction', () => {
    it('should apply token reduction to system messages', async () => {
      const messages = [
        {
          role: "system",
          content: "You are a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics."
        },
        {
          role: "user",
          content: "Hello, how are you?"
        }
      ];

      const result = await transformMessages(messages);

      // Check that system instruction exists and has been reduced
      expect(result.system_instruction).toBeDefined();
      expect(result.system_instruction.parts).toHaveLength(1);
      
      const systemText = result.system_instruction.parts[0].text;
      
      // Verify token reduction was applied (should be shorter than original)
      expect(systemText.length).toBeLessThan(messages[0].content.length);
      
      // Verify specific reductions were applied
      expect(systemText).not.toContain(" a ");
      expect(systemText).not.toContain(" the ");
      expect(systemText).not.toContain(" and ");
      
      // Verify user message was not affected
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[0].parts[0].text).toBe("Hello, how are you?");
    });

    it('should apply token reduction to multi-part system messages', async () => {
      const messages = [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "You are a helpful assistant focused on providing information and answering questions."
            },
            {
              type: "text", 
              text: "Always be polite and provide accurate information to the user."
            }
          ]
        },
        {
          role: "user",
          content: "Test message"
        }
      ];

      const result = await transformMessages(messages);

      expect(result.system_instruction).toBeDefined();
      expect(result.system_instruction.parts).toHaveLength(2);
      
      // Check that both text parts were reduced
      const firstPart = result.system_instruction.parts[0].text;
      const secondPart = result.system_instruction.parts[1].text;
      
      expect(firstPart.length).toBeLessThan(messages[0].content[0].text.length);
      expect(secondPart.length).toBeLessThan(messages[0].content[1].text.length);
      
      // Verify common words were removed
      expect(firstPart).not.toContain(" a ");
      expect(secondPart).not.toContain(" the ");
    });

    it('should not affect non-text parts in multi-part system messages', async () => {
      const messages = [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "You are a helpful assistant and you should provide information."
            },
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,test" }
            }
          ]
        },
        {
          role: "user",
          content: "Test"
        }
      ];

      const result = await transformMessages(messages);

      expect(result.system_instruction).toBeDefined();
      expect(result.system_instruction.parts).toHaveLength(2);
      
      // Text part should be reduced
      const textPart = result.system_instruction.parts[0].text;
      expect(textPart.length).toBeLessThan(messages[0].content[0].text.length);
      
      // Image part should remain unchanged
      const imagePart = result.system_instruction.parts[1];
      expect(imagePart).toHaveProperty('inlineData');
      expect(imagePart.inlineData).toHaveProperty('mimeType', 'image/jpeg');
    });

    it('should not affect user or assistant messages', async () => {
      const messages = [
        {
          role: "user",
          content: "I am a user and I have a question about the system."
        },
        {
          role: "assistant", 
          content: "I am an assistant and I will provide you with the information."
        }
      ];

      const result = await transformMessages(messages);

      expect(result.system_instruction).toBeUndefined();
      expect(result.contents).toHaveLength(2);
      
      // User message should be unchanged
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[0].parts[0].text).toBe(messages[0].content);
      
      // Assistant message should be unchanged (role mapped to "model")
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[1].parts[0].text).toBe(messages[1].content);
    });

    it('should handle empty or null system content gracefully', async () => {
      const messages = [
        {
          role: "system",
          content: ""
        },
        {
          role: "user",
          content: "Hello"
        }
      ];

      const result = await transformMessages(messages);

      expect(result.system_instruction).toBeDefined();
      expect(result.system_instruction.parts[0].text).toBe("");
    });

    it('should preserve system message structure when no reduction is possible', async () => {
      const messages = [
        {
          role: "system",
          content: "Short."
        },
        {
          role: "user", 
          content: "Hi"
        }
      ];

      const result = await transformMessages(messages);

      expect(result.system_instruction).toBeDefined();
      expect(result.system_instruction.parts[0].text).toBe("Short.");
    });
  });
});
