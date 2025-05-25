import { handleOPTIONS, fixCors } from './utils/cors.mjs';
import { errorHandler } from './utils/error.mjs';
export default {
  async fetch(request, env, context) {
    // Helper function to report metrics asynchronously using context.waitUntil
    // This ensures that metric reporting does not block the main response.
    const reportMetric = async (metricData) => {
      try {
        // In a real application, you would send this to a dedicated metrics endpoint, e.g.:
        // await fetch('https://your-metrics-service.com/api/metrics', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify(metricData),
        // });
        // For this example, we'll log it with a clear prefix.
        console.log(`[METRIC] ${JSON.stringify(metricData)}`);
      } catch (e) {
        console.error(`Failed to report metric: ${e.message}`, metricData);
      }
    };
    // Ensure the metric reporting is awaited and does not block the main response.
    context.waitUntil(reportMetric(metricData));

    if (request.method === 'OPTIONS') {
      return handleOPTIONS(request);
    }

    try {
      const url = new URL(request.url);
      const conversationId = request.headers.get('X-Conversation-ID') || `conv_${crypto.randomUUID()}`;

      if (url.pathname === '/conversation') {
        const doId = env.CONVERSATION_STATE.idFromName(conversationId);
        const stub = env.CONVERSATION_STATE.get(doId);
        return fixCors(request, await stub.fetch(request));
      }

      if (url.pathname.startsWith('/v1/conversations/') && url.pathname.endsWith('/terminate') && request.method === 'POST') {
        const match = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/terminate$/);
        const conversationId = match ? match[1] : null;

        if (!conversationId) {
          return fixCors(request, new Response('Missing conversationId', { status: 400 }));
        }

        try {
          const doId = env.CONVERSATION_STATE.idFromName(conversationId);
          const stub = env.CONVERSATION_STATE.get(doId);
          await stub.fetch('/clear_conversation_state', { method: 'POST' });
          return fixCors(request, new Response('Conversation terminated successfully', { status: 200 }));
        } catch (error) {
          console.error('Error terminating conversation:', error);
          // Report total error count asynchronously
          reportMetric({
            timestamp: new Date().toISOString(),
            metric_name: 'do_error_count_total',
            value: 1,
            level: 'ERROR',
            conversation_id: conversationId,
            error_type: error.name,
            error_message: `Error terminating conversation: ${error.message}`,
            stack_trace: error.stack,
          });
          // Report specific error for failed termination asynchronously
          reportMetric({
            timestamp: new Date().toISOString(),
            metric_name: 'do_error_count_clear_failed', // As termination involves clearing state
            value: 1,
            level: 'ERROR',
            conversation_id: conversationId,
            error_type: error.name,
            error_message: `Failed to terminate conversation: ${error.message}`,
            stack_trace: error.stack,
          });
          return fixCors(request, new Response(`Error terminating conversation: ${error.message}`, { status: 500 }));
        }
      }
      return fixCors(request, new Response('Hello World from Worker!'));
    } catch (error) {
      console.error('Unhandled error in Worker:', error);
      reportMetric({
        timestamp: new Date().toISOString(),
        metric_name: 'worker_unhandled_error',
        value: 1,
        level: 'CRITICAL',
        error_type: error.name,
        error_message: `Unhandled error: ${error.message}`,
        stack_trace: error.stack,
      });
      return errorHandler(error, request);
    }
  },
};
