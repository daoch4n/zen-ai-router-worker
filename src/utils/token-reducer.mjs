/**
 * Token reduction utility for optimizing system message content.
 * Applies hardcoded replacements and removes common words to reduce token usage.
 */

/**
 * Default configuration for token reduction
 */
const DEFAULT_CONFIG = {
  specificReplacements: [
    {
      original: "====\n\nOBJECTIVE\n\nYou accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.\n\n1. Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.\n2. Work through these goals sequentially, utilizing available tools one at a time as necessary. Each goal should correspond to a distinct step in your problem-solving process. You will be informed on the work completed and what's remaining as you go.\n3. Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal. Before calling a tool, do some analysis within <thinking></thinking> tags. First, analyze the file structure provided in environment_details to gain context and insights for proceeding effectively. Then, think about which of the provided tools is the most relevant tool to accomplish the user's task. Next, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. If all of the required parameters are present or can be reasonably inferred, close the thinking tag and proceed with the tool use. BUT, if one of the values for a required parameter is missing, DO NOT invoke the tool (not even with fillers for the missing params) and instead, ask the user to provide the missing parameters using the ask_followup_question tool. DO NOT ask for more information on optional parameters if it is not provided.\n4. Once you've completed the user's task, you must use the attempt_completion tool to present the result of the task to the user. You may also provide a CLI command to showcase the result of your task; this can be particularly useful for web development tasks, where you can run e.g. `open index.html` to show the website you've built.\n5. The user may provide feedback, which you can use to make improvements and try again. But DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.\n\n\n====",
      replacement: ""
    },
    // {
    //   original: "XYZXYZ",
    //   replacement: "XYZXYZ"
    // }
  ],
  commonWordRemovals: [
    " a ", " an ", " the ", " and ", " or ", " but ", " so ", " yet ", " for ", " nor ",
    " at ", " by ", " in ", " of ", " on ", " to ", " up ", " as ", " is ", " are ",
    " was ", " were ", " be ", " been ", " being ", " have ", " has ", " had ",
    " do ", " does ", " did ", " will ", " would ", " could ", " should ", " may ",
    " might ", " must ", " can ", " shall "
  ],
  settings: {
    preserveStartOfSentences: false,
    preserveEndOfSentences: false,
    minimumWordLength: 2
  }
};

/**
 * TokenReducer class for optimizing system message content
 */
export class TokenReducer {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Apply specific replacements from the config
   * @param {string} text - Input text to process
   * @returns {string} Text with specific replacements applied
   */
  applySpecificReplacements(text) {
    let result = text;
    
    for (const replacement of this.config.specificReplacements) {
      result = result.replace(new RegExp(replacement.original, 'g'), replacement.replacement);
    }
    
    return result;
  }

  /**
   * Remove common words while preserving sentence structure
   * @param {string} text - Input text to process
   * @returns {string} Text with common words removed
   */
  removeCommonWords(text) {
    let result = text;
    
    // Split into sentences to preserve sentence boundaries
    const sentences = result.split(/([.!?]+)/);
    
    for (let i = 0; i < sentences.length; i += 2) { // Process only sentence content, not punctuation
      if (sentences[i]) {
        let sentence = sentences[i];
        
        // Apply common word removals, but preserve first and last words of sentences
        for (const word of this.config.commonWordRemovals) {
          // Don't remove if it's at the start of a sentence (after whitespace/punctuation)
          const startPattern = new RegExp(`^(\\s*)${word.trim()}\\s+`, 'gi');
          // Don't remove if it's at the end of a sentence (before punctuation)
          const endPattern = new RegExp(`\\s+${word.trim()}(\\s*[.!?]*)$`, 'gi');
          
          // Remove from middle of sentences
          const middlePattern = new RegExp(word, 'gi');
          
          // First preserve start and end, then remove from middle
          if (!startPattern.test(sentence) && !endPattern.test(sentence)) {
            sentence = sentence.replace(middlePattern, ' ');
          }
        }
        
        // Clean up multiple spaces
        sentence = sentence.replace(/\s+/g, ' ').trim();
        sentences[i] = sentence;
      }
    }
    
    return sentences.join('');
  }

  /**
   * Clean up extra whitespace and formatting
   * @param {string} text - Input text to process
   * @returns {string} Text with cleaned formatting
   */
  cleanupFormatting(text) {
    return text
      .replace(/\s+/g, ' ')  // Multiple spaces to single space
      .replace(/\s*\n\s*/g, '\n')  // Clean up line breaks
      .replace(/\s*\.\s*/g, '. ')  // Standardize period spacing
      .replace(/\s*,\s*/g, ', ')   // Standardize comma spacing
      .trim();
  }

  /**
   * Main reduction function
   * @param {string} text - Input text to reduce
   * @returns {string} Optimized text with reduced token count
   */
  reduce(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    // Step 1: Apply specific replacements
    let result = this.applySpecificReplacements(text);
    
    // Step 2: Remove common words
    result = this.removeCommonWords(result);
    
    // Step 3: Clean up formatting
    result = this.cleanupFormatting(result);
    
    return result;
  }

  /**
   * Get reduction statistics
   * @param {string} original - Original text
   * @param {string} reduced - Reduced text
   * @returns {Object} Statistics about the reduction
   */
  getStats(original, reduced) {
    const originalLength = original?.length || 0;
    const reducedLength = reduced?.length || 0;
    const savings = originalLength - reducedLength;
    const percentage = originalLength > 0 ? (savings / originalLength * 100).toFixed(1) : 0;
    
    return {
      originalLength,
      reducedLength,
      savings,
      percentage: parseFloat(percentage)
    };
  }
}

/**
 * Default token reducer instance
 */
export const defaultTokenReducer = new TokenReducer();

/**
 * Convenience function to reduce system message content
 * @param {string} content - System message content to reduce
 * @returns {string} Reduced content
 */
export const reduceSystemMessage = (content) => {
  return defaultTokenReducer.reduce(content);
};
