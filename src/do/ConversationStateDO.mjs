export default class ConversationStateDO {
    constructor(state, env) {
        this.state = state;
    }

    async fetch(request) {
        return new Response("Durable Object for ConversationStateDO");
    }
}