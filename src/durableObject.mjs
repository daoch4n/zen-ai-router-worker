export class ConversationStateDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      let stored = await this.state.storage.get('conversationState');
      this.conversationState = stored || [];
    });
  }

  async fetch(request) {
    let url = new URL(request.url);

    if (url.pathname === '/conversation') {
      if (request.method === 'POST') {
        let newEntry = await request.json();
        this.conversationState.push(newEntry);
        await this.state.storage.put('conversationState', this.conversationState);
        return new Response(JSON.stringify(this.conversationState), { headers: { 'Content-Type': 'application/json' } });
      } else if (request.method === 'GET') {
        return new Response(JSON.stringify(this.conversationState), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response('Not found', { status: 404 });
  }
}