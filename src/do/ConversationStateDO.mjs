export default class ConversationStateDO {
    constructor(state) {
        this.state = state;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const key = url.pathname.slice(1); // Get key from path, e.g., /conversation-id

        switch (request.method) {
            case "PUT":
            case "POST": {
                const value = await request.json();
                await this.state.storage.put(key, value);
                return new Response(`Stored ${key} with value ${JSON.stringify(value)}`);
            }
            case "GET": {
                const value = await this.state.storage.get(key);
                return new Response(JSON.stringify(value), {
                    headers: { "Content-Type": "application/json" }
                });
            }
            case "DELETE": {
                await this.state.storage.delete(key);
                return new Response(`Deleted ${key}`);
            }
            default:
                return new Response("Method Not Allowed", { status: 405 });
        }
    }
}