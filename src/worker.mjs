export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/conversation') {
      const id = env.CONVERSATION_STATE.idFromName('test');
      const stub = env.CONVERSATION_STATE.get(id);
      return stub.fetch(request);
    }
    return new Response('Hello World from Worker!');
  },
};
