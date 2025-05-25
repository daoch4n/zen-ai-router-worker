export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const conversationId = request.headers.get('X-Conversation-ID') || `conv_${crypto.randomUUID()}`;

    if (url.pathname === '/conversation') {
      const doId = env.CONVERSATION_STATE.idFromName(conversationId);
      const stub = env.CONVERSATION_STATE.get(doId);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/v1/conversations/') && url.pathname.endsWith('/terminate') && request.method === 'POST') {
      const parts = url.pathname.split('/');
      const conversationId = parts[3]; // Assuming path is /v1/conversations/{id}/terminate

      if (!conversationId) {
        return new Response('Missing conversationId', { status: 400 });
      }

      try {
        const doId = env.CONVERSATION_STATE.idFromName(conversationId);
        const stub = env.CONVERSATION_STATE.get(doId);
        await stub.fetch('/clear_conversation_state', { method: 'POST' });
        return new Response('Conversation terminated successfully', { status: 200 });
      } catch (error) {
        console.error('Error terminating conversation:', error);
        return new Response(`Error terminating conversation: ${error.message}`, { status: 500 });
      }
    }
    return new Response('Hello World from Worker!');
  },
};
