/**
 * Tests for specific replacements functionality in TokenReducer
 */
import { TokenReducer } from '../../src/utils/token-reducer.mjs';

describe('TokenReducer - Specific Replacements', () => {
  describe('applySpecificReplacements', () => {
    it('should apply the default OBJECTIVE replacement', () => {
      const reducer = new TokenReducer();
      
      // This is the exact text from the default config that should be replaced
      const textWithObjective = `You are Roo, a knowledgeable technical assistant.

====

OBJECTIVE

You accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.

1. Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.
2. Work through these goals sequentially, utilizing available tools one at a time as necessary. Each goal should correspond to a distinct step in your problem-solving process. You will be informed on the work completed and what's remaining as you go.
3. Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal. Before calling a tool, do some analysis within <thinking></thinking> tags. First, analyze the file structure provided in environment_details to gain context and insights for proceeding effectively. Then, think about which of the provided tools is the most relevant tool to accomplish the user's task. Next, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. If all of the required parameters are present or can be reasonably inferred, close the thinking tag and proceed with the tool use. BUT, if one of the values for a required parameter is missing, DO NOT invoke the tool (not even with fillers for the missing params) and instead, ask the user to provide the missing parameters using the ask_followup_question tool. DO NOT ask for more information on optional parameters if it is not provided.
4. Once you've completed the user's task, you must use the attempt_completion tool to present the result of the task to the user. You may also provide a CLI command to showcase the result of your task; this can be particularly useful for web development tasks, where you can run e.g. \`open index.html\` to show the website you've built.
5. The user may provide feedback, which you can use to make improvements and try again. But DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.


====

Some other content here.`;

      const result = reducer.applySpecificReplacements(textWithObjective);
      
      // The OBJECTIVE section should be completely removed
      expect(result).not.toContain('OBJECTIVE');
      expect(result).not.toContain('You accomplish a given task iteratively');
      expect(result).not.toContain('breaking it down into clear steps');
      
      // But other content should remain
      expect(result).toContain('You are Roo, a knowledgeable technical assistant.');
      expect(result).toContain('Some other content here.');
    });

    it('should handle text without the specific replacement pattern', () => {
      const reducer = new TokenReducer();
      const originalText = 'This is some random text that does not contain the pattern.';
      
      const result = reducer.applySpecificReplacements(originalText);
      
      expect(result).toBe(originalText);
    });

    it('should handle multiple occurrences of the same pattern', () => {
      const reducer = new TokenReducer();
      
      // Create a custom config with a simple pattern for testing
      const customConfig = {
        specificReplacements: [
          {
            original: 'REMOVE_ME',
            replacement: 'REPLACED'
          }
        ],
        commonWordRemovals: [],
        settings: {}
      };
      
      const customReducer = new TokenReducer(customConfig);
      const textWithMultiple = 'Start REMOVE_ME middle REMOVE_ME end';
      
      const result = customReducer.applySpecificReplacements(textWithMultiple);
      
      expect(result).toBe('Start REPLACED middle REPLACED end');
    });

    it('should handle empty replacement (removal)', () => {
      const reducer = new TokenReducer();
      
      const customConfig = {
        specificReplacements: [
          {
            original: 'DELETE_THIS',
            replacement: ''
          }
        ],
        commonWordRemovals: [],
        settings: {}
      };
      
      const customReducer = new TokenReducer(customConfig);
      const textWithDeletion = 'Keep this DELETE_THIS but remove that';
      
      const result = customReducer.applySpecificReplacements(textWithDeletion);
      
      expect(result).toBe('Keep this  but remove that');
    });

    it('should handle special regex characters in the original text', () => {
      const customConfig = {
        specificReplacements: [
          {
            original: 'Text with (parentheses) and [brackets] and {braces} and . dots',
            replacement: 'REPLACED'
          }
        ],
        commonWordRemovals: [],
        settings: {}
      };
      
      const customReducer = new TokenReducer(customConfig);
      const textWithSpecialChars = 'Before Text with (parentheses) and [brackets] and {braces} and . dots After';
      
      const result = customReducer.applySpecificReplacements(textWithSpecialChars);
      
      expect(result).toBe('Before REPLACED After');
    });
  });

  describe('full reduction with specific replacements', () => {
    it('should apply specific replacements before common word removal', () => {
      const customConfig = {
        specificReplacements: [
          {
            original: 'the quick brown fox',
            replacement: 'fast animal'
          }
        ],
        commonWordRemovals: [' the ', ' a '],
        settings: {}
      };
      
      const customReducer = new TokenReducer(customConfig);
      const text = 'I saw the quick brown fox jump over a log';
      
      const result = customReducer.reduce(text);
      
      // Should first replace "the quick brown fox" with "fast animal"
      // Then remove common words like " a "
      expect(result).toContain('fast animal');
      expect(result).not.toContain('the quick brown fox');
      expect(result).not.toContain(' a '); // Should be removed by common word removal
    });
  });
});
