export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const conversationId = request.headers.get('X-Conversation-ID') || `conv_${crypto.randomUUID()}`;

    if (url.pathname === '/conversation') {
      const doId = env.CONVERSATION_STATE.idFromName(conversationId);
      const stub = env.CONVERSATION_STATE.get(doId);
      return stub.fetch(request);
    }
    return new Response('Hello World from Worker!');
  },
};
