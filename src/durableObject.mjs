import { executeWithRetry } from '../utils/retry.mjs';
import { createErrorResponse } from '../utils/error.mjs';

export class ConversationStateDO extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.storage = this.state.storage;
    this.retryOptions = {
      maxRetries: 5, // Increased retries for DO operations
      initialDelay: 200, // Initial delay of 200ms
      backoffFactor: 2, // Exponential backoff
      onRetry: (attempt, error, delay) => {
        console.warn(`DO operation retry attempt ${attempt} after ${delay}ms due to: ${error.message}`);
      }
    };
  }
 
  // Define inactivity timeout (5 minutes)
  static INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
 
  // Helper to set or reset the inactivity alarm
  async setInactivityAlarm() {
    await this.state.storage.setAlarm(Date.now() + ConversationStateDO.INACTIVITY_TIMEOUT_MS);
  }
 
  async handleRequest(request) {
    // Reset the inactivity alarm on any activity
    await this.setInactivityAlarm();
 
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case '/store':
        return this.handleStore(request);
      case '/retrieve':
        return this.handleRetrieve(request);
      case '/delete_mapping':
        return this.handleDeleteMapping(request);
      case '/clear_conversation_state':
        return this.handleClearConversationState(request);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  async handleStore(request) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const { tool_use_id, tool_name } = await request.json();
      if (!tool_use_id || !tool_name) {
        return new Response('Missing tool_use_id or tool_name', { status: 400 });
      }

      await executeWithRetry(
        async () => this.storage.put(tool_use_id, tool_name),
        this.retryOptions
      );
      return new Response('Mapping stored successfully', { status: 200 });
    } catch (error) {
      console.error(`Error storing mapping after retries: ${error.message}`, error.stack);
      return createErrorResponse(error, 'Error storing conversation state', 500);
    }
  }

  async handleRetrieve(request) {
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const tool_use_id = url.searchParams.get('tool_use_id');

    if (!tool_use_id) {
      return new Response('Missing tool_use_id query parameter', { status: 400 });
    }

    try {
      const tool_name = await executeWithRetry(
        async () => this.storage.get(tool_use_id),
        this.retryOptions
      );
      if (tool_name === undefined) {
        return new Response('Mapping not found', { status: 404 });
      }
      return new Response(JSON.stringify({ tool_use_id, tool_name }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (error) {
      console.error(`Error retrieving mapping after retries: ${error.message}`, error.stack);
      return createErrorResponse(error, 'Error retrieving conversation state', 500);
    }
  }

  async handleDeleteMapping(request) {
    if (request.method !== 'DELETE') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const tool_use_id = url.searchParams.get('tool_use_id');

    if (!tool_use_id) {
      return new Response('Missing tool_use_id query parameter', { status: 400 });
    }

    try {
      await executeWithRetry(
        async () => this.storage.delete(tool_use_id),
        this.retryOptions
      );
      return new Response('Mapping deleted successfully', { status: 200 });
    } catch (error) {
      console.error(`Error deleting mapping after retries: ${error.message}`, error.stack);
      return createErrorResponse(error, 'Error deleting conversation state', 500);
    }
  }

  async handleClearConversationState(request) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      await executeWithRetry(
        async () => this.storage.deleteAll(),
        this.retryOptions
      );
      await executeWithRetry(
        async () => this.storage.deleteAlarm(),
        this.retryOptions
      );
      return new Response('Conversation state cleared successfully', { status: 200 });
    } catch (error) {
      console.error(`Error clearing conversation state after retries: ${error.message}`, error.stack);
      return createErrorResponse(error, 'Error clearing conversation state', 500);
    }
  }
 
  async alarm() {
    // Alarm triggered due to inactivity, clear the conversation state
    console.log('Inactivity alarm triggered. Clearing conversation state.');
    // Create a dummy request as handleClearConversationState expects one
    await this.handleClearConversationState(new Request('http://dummy-url/clear_conversation_state', { method: 'POST' }));
  }
}