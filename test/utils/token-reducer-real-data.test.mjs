/**
 * Test TokenReducer with real data from the example request
 */
import { TokenReducer, reduceSystemMessage } from '../../src/utils/token-reducer.mjs';
import fs from 'fs';
import path from 'path';

describe('TokenReducer - Real Data Test', () => {
  let exampleRequestData;

  beforeAll(() => {
    // Load the example request data
    const requestPath = path.join(process.cwd(), 'docs', 'req_roo_2.json');
    const requestContent = fs.readFileSync(requestPath, 'utf8');
    exampleRequestData = JSON.parse(requestContent);
  });

  it('should apply specific replacements to the system message from req_roo_2.json', () => {
    const systemMessage = exampleRequestData.messages.find(msg => msg.role === 'system');
    expect(systemMessage).toBeDefined();

    const originalContent = systemMessage.content;
    const reducedContent = reduceSystemMessage(originalContent);

    // The content should be reduced (shorter)
    expect(reducedContent.length).toBeLessThan(originalContent.length);

    // The specific OBJECTIVE section should be removed
    expect(originalContent).toContain('====\n\nOBJECTIVE\n\n');
    expect(reducedContent).not.toContain('====\n\nOBJECTIVE\n\n');
    expect(reducedContent).not.toContain('You accomplish a given task iteratively');

    // Other content should still be present (but may have common words removed)
    expect(reducedContent).toContain('You Roo, knowledgeable technical assistant'); // "are" and "a" removed
    expect(reducedContent).toContain('MARKDOWN RULES');
    expect(reducedContent).toContain('TOOL USE');

    console.log('Original length:', originalContent.length);
    console.log('Reduced length:', reducedContent.length);
    console.log('Reduction:', originalContent.length - reducedContent.length, 'characters');
    console.log('Percentage saved:', ((originalContent.length - reducedContent.length) / originalContent.length * 100).toFixed(1) + '%');
  });

  it('should show reduction statistics', () => {
    const reducer = new TokenReducer();
    const systemMessage = exampleRequestData.messages.find(msg => msg.role === 'system');
    const originalContent = systemMessage.content;
    const reducedContent = reducer.reduce(originalContent);

    const stats = reducer.getStats(originalContent, reducedContent);

    expect(stats.originalLength).toBeGreaterThan(0);
    expect(stats.reducedLength).toBeLessThan(stats.originalLength);
    expect(stats.savings).toBeGreaterThan(0);
    expect(stats.percentage).toBeGreaterThan(0);

    console.log('Reduction stats:', stats);
  });
});
