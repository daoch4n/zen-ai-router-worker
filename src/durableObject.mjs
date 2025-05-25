import { executeWithRetry } from '../utils/retry.mjs';
import { createErrorResponse } from '../utils/error.mjs';

export class ConversationStateDO extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.storage = this.state.storage;

    // Helper function to report metrics asynchronously using this.state.waitUntil
    // This ensures that metric reporting does not block the main DO logic.
    this.reportMetric = (metricData) => {
      this.state.waitUntil(Promise.resolve(console.log(JSON.stringify(metricData))));
    };

    // Log DO instance creation event
    this.reportMetric({
      timestamp: new Date().toISOString(),
      metric_name: 'do_instance_creation_events',
      value: 1,
      level: 'INFO',
    });

    this.retryOptions = {
      maxRetries: 5, // Increased retries for DO operations
      initialDelay: 200, // Initial delay of 200ms
      backoffFactor: 2, // Exponential backoff
      onRetry: (attempt, error, delay) => {
        // Report retry attempts asynchronously
        this.reportMetric({
          timestamp: new Date().toISOString(),
          metric_name: 'do_retry_attempt_count',
          value: 1,
          level: 'WARN',
          error_type: error.name,
          error_message: `DO operation retry attempt ${attempt} after ${delay}ms due to: ${error.message}`,
          stack_trace: error.stack,
        });
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

    const start = Date.now();
    let tool_use_id = 'N/A'; // Initialize with N/A, update if parsed

    try {
      const { tool_use_id: parsed_tool_use_id, tool_name } = await request.json();
      tool_use_id = parsed_tool_use_id || 'N/A'; // Update tool_use_id

      // Report store request count asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_request_count_store',
        value: 1,
        level: 'INFO',
        conversation_id: tool_use_id,
      });

      if (!parsed_tool_use_id || !tool_name) {
        // Report missing parameter error asynchronously
        this.reportMetric({
          timestamp: new Date().toISOString(),
          metric_name: 'do_tool_name_mapping_failures',
          value: 1,
          level: 'ERROR',
          conversation_id: tool_use_id,
          error_type: 'MissingParameterError',
          error_message: 'Missing tool_use_id or tool_name in store request',
        });
        return new Response('Missing tool_use_id or tool_name', { status: 400 });
      }

      await executeWithRetry(
        async () => this.storage.put(tool_use_id, tool_name),
        this.retryOptions
      );

      const latency = Date.now() - start;
      // Report store latency asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_latency_store_ms',
        value: latency,
        level: 'INFO',
        conversation_id: tool_use_id,
      });

      return new Response('Mapping stored successfully', { status: 200 });
    } catch (error) {
      console.error(`Error storing mapping after retries: ${error.message}`, error.stack);
      // Report total error count asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_total',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: error.name,
        error_message: `Error storing mapping: ${error.message}`,
        stack_trace: error.stack,
      });
      // Report specific store failure error asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_store_failed',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: error.name,
        error_message: `Failed to store mapping: ${error.message}`,
        stack_trace: error.stack,
      });
      return createErrorResponse(error, 'Error storing conversation state', 500);
    }
  }

  async handleRetrieve(request) {
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const start = Date.now();
    const url = new URL(request.url);
    const tool_use_id = url.searchParams.get('tool_use_id');

    // Report retrieve request count asynchronously
    this.reportMetric({
      timestamp: new Date().toISOString(),
      metric_name: 'do_request_count_retrieve',
      value: 1,
      level: 'INFO',
      conversation_id: tool_use_id,
    });

    if (!tool_use_id) {
      // Report missing parameter error asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_tool_name_mapping_failures',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: 'MissingParameterError',
        error_message: 'Missing tool_use_id query parameter for retrieve',
      });
      return new Response('Missing tool_use_id query parameter', { status: 400 });
    }

    try {
      const tool_name = await executeWithRetry(
        async () => this.storage.get(tool_use_id),
        this.retryOptions
      );

      const latency = Date.now() - start;
      // Report retrieve latency asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_latency_retrieve_ms',
        value: latency,
        level: 'INFO',
        conversation_id: tool_use_id,
      });

      if (tool_name === undefined) {
        // Report mapping not found warning asynchronously
        this.reportMetric({
          timestamp: new Date().toISOString(),
          metric_name: 'do_tool_name_mapping_failures',
          value: 1,
          level: 'WARN', // Using WARN as it's not an error in DO operation, but mapping not found
          conversation_id: tool_use_id,
          error_type: 'MappingNotFoundError',
          error_message: `Mapping not found for tool_use_id: ${tool_use_id}`,
        });
        return new Response('Mapping not found', { status: 404 });
      }
      return new Response(JSON.stringify({ tool_use_id, tool_name }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (error) {
      console.error(`Error retrieving mapping after retries: ${error.message}`, error.stack);
      // Report total error count asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_total',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: error.name,
        error_message: `Error retrieving mapping: ${error.message}`,
        stack_trace: error.stack,
      });
      // Report specific retrieve failure error asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_retrieve_failed',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: error.name,
        error_message: `Failed to retrieve mapping: ${error.message}`,
        stack_trace: error.stack,
      });
      return createErrorResponse(error, 'Error retrieving conversation state', 500);
    }
  }

  async handleDeleteMapping(request) {
    if (request.method !== 'DELETE') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const start = Date.now();
    const url = new URL(request.url);
    const tool_use_id = url.searchParams.get('tool_use_id');

    // Report delete request count asynchronously
    this.reportMetric({
      timestamp: new Date().toISOString(),
      metric_name: 'do_request_count_delete_mapping',
      value: 1,
      level: 'INFO',
      conversation_id: tool_use_id,
    });

    if (!tool_use_id) {
      // Report missing parameter error asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_tool_name_mapping_failures',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: 'MissingParameterError',
        error_message: 'Missing tool_use_id query parameter for delete',
      });
      return new Response('Missing tool_use_id query parameter', { status: 400 });
    }

    try {
      await executeWithRetry(
        async () => this.storage.delete(tool_use_id),
        this.retryOptions
      );

      const latency = Date.now() - start;
      // Report delete latency asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_latency_delete_mapping_ms',
        value: latency,
        level: 'INFO',
        conversation_id: tool_use_id,
      });

      return new Response('Mapping deleted successfully', { status: 200 });
    } catch (error) {
      console.error(`Error deleting mapping after retries: ${error.message}`, error.stack);
      // Report total error count asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_total',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: error.name,
        error_message: `Error deleting mapping: ${error.message}`,
        stack_trace: error.stack,
      });
      // Report specific delete failure error asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_delete_failed',
        value: 1,
        level: 'ERROR',
        conversation_id: tool_use_id,
        error_type: error.name,
        error_message: `Failed to delete mapping: ${error.message}`,
        stack_trace: error.stack,
      });
      return createErrorResponse(error, 'Error deleting conversation state', 500);
    }
  }

  async clearConversationState() {
    let conversation_id = 'N/A'; // Since this is a general clear, conversation_id might not be directly available

    try {
      await executeWithRetry(
        async () => this.storage.deleteAll(),
        this.retryOptions
      );
      await executeWithRetry(
        async () => this.storage.deleteAlarm(),
        this.retryOptions
      );
    } catch (error) {
      console.error(`Error clearing conversation state after retries: ${error.message}`, error.stack);
      // Report total error count asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_total',
        value: 1,
        level: 'ERROR',
        conversation_id: conversation_id,
        error_type: error.name,
        error_message: `Error clearing conversation state: ${error.message}`,
        stack_trace: error.stack,
      });
      // Report specific clear failure error asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_clear_failed',
        value: 1,
        level: 'ERROR',
        conversation_id: conversation_id,
        error_type: error.name,
        error_message: `Failed to clear conversation state: ${error.message}`,
        stack_trace: error.stack,
      });
      throw error;
    }
  }

  async handleClearConversationState(request) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const start = Date.now();
    let conversation_id = 'N/A'; // No direct conversation_id from request params, so N/A

    // Report API request count for clear conversation state asynchronously
    this.reportMetric({
      timestamp: new Date().toISOString(),
      metric_name: 'do_request_count_clear_conversation_state_api',
      value: 1,
      level: 'INFO',
      conversation_id: conversation_id,
    });
    // Report cleanup API triggered count asynchronously
    this.reportMetric({
      timestamp: new Date().toISOString(),
      metric_name: 'do_cleanup_api_triggered_count',
      value: 1,
      level: 'INFO',
      conversation_id: conversation_id,
    });

    try {
      await this.clearConversationState();

      const latency = Date.now() - start;
      // Report clear conversation state latency asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_latency_clear_conversation_state_ms',
        value: latency,
        level: 'INFO',
        conversation_id: conversation_id,
      });

      return new Response('Conversation state cleared successfully', { status: 200 });
    } catch (error) {
      // Report total error count asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_total',
        value: 1,
        level: 'ERROR',
        conversation_id: conversation_id,
        error_type: error.name,
        error_message: `Error handling clear conversation state: ${error.message}`,
        stack_trace: error.stack,
      });
      // Report specific clear failure error asynchronously
      this.reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'do_error_count_clear_failed',
        value: 1,
        level: 'ERROR',
        conversation_id: conversation_id,
        error_type: error.name,
        error_message: `Failed to handle clear conversation state: ${error.message}`,
        stack_trace: error.stack,
      });
      return createErrorResponse(error, 'Error clearing conversation state', 500);
    }
  }
 
  async alarm() {
    // Alarm triggered due to inactivity, clear the conversation state
    // Report cleanup alarm triggered count asynchronously
    this.reportMetric({
      timestamp: new Date().toISOString(),
      metric_name: 'do_cleanup_alarm_triggered_count',
      value: 1,
      level: 'INFO',
      conversation_id: 'N/A', // No conversation_id in alarm context
      message: 'Inactivity alarm triggered. Clearing conversation state.',
    });
    await this.clearConversationState();
  }
}