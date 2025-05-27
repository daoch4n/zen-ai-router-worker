// orchestrator/src/routerCounter.mjs
export class RouterCounter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.initialized = false; // To ensure counter is loaded once
  }

  async fetch(request) {
    if (!this.initialized) {
      this.counter = (await this.state.storage.get("counter")) || 0;
      this.initialized = true;
    }

    const url = new URL(request.url);
    switch (url.pathname) {
      case "/increment":
        this.counter++;
        await this.state.storage.put("counter", this.counter);
        return new Response(String(this.counter));
      case "/get":
        return new Response(String(this.counter));
      default:
        return new Response("Not Found", { status: 404 });
    }
  }
}