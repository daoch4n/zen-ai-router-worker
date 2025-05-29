export class TTSStateDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.text = "";
        this.voiceId = "";
        this.currentSentenceIndex = 0;
        this.audioChunks = [];
        this.lastError = null;
        this.errorTimestamp = null;
        this.initialised = false; // Initialise to false

        // Store the promise returned by loadState()
        this.loadStatePromise = this.loadState(); // Removed .then() and .catch() here
    }

    async initialise(text, voiceId) {
        // Ensure initial load from storage is complete before proceeding
        await this.loadStatePromise;

        if (this.initialised && this.text === text && this.voiceId === voiceId) {
            console.log("TTSStateDurableObject already initialised with same parameters.");
            return;
        }

        this.text = text;
        this.voiceId = voiceId;
        this.currentSentenceIndex = 0;
        this.audioChunks = [];
        this.lastError = null; // Clear errors on initialization
        this.errorTimestamp = null; // Clear errors on initialization
        this.initialised = true; // Set local flag as we are explicitly initializing

        await this.state.storage.put("text", text);
        await this.state.storage.put("voiceId", voiceId);
        await this.state.storage.put("currentSentenceIndex", 0);
        await this.state.storage.put("audioChunks", []);
        await this.state.storage.put("initialised", true); // Persist initialised status
        await this.state.storage.put("lastError", null);
        await this.state.storage.put("errorTimestamp", null);
        console.log("TTSStateDurableObject initialised and state persisted.");
    }

    async loadState() {
        // Always attempt to load from storage. The race condition is handled by awaiting loadStatePromise.
        const [text, voiceId, currentSentenceIndex, audioChunks, initialised, lastError, errorTimestamp] = await this.state.storage.get([
            "text",
            "voiceId",
            "currentSentenceIndex",
            "audioChunks",
            "initialised",
            "lastError",
            "errorTimestamp"
        ]);

        this.text = text || "";
        this.voiceId = voiceId || "";
        this.currentSentenceIndex = currentSentenceIndex || 0;
        this.audioChunks = audioChunks || [];
        this.initialised = initialised || false; // Assign loaded initialised status
        this.lastError = lastError || null;
        this.errorTimestamp = errorTimestamp || null;
        console.log("TTSStateDurableObject state loaded.");
    }

    async updateProgress(sentenceIndex, audioChunkBase64, error = null) {
        this.currentSentenceIndex = sentenceIndex;
        this.audioChunks[sentenceIndex] = audioChunkBase64;

        if (error) {
            this.lastError = error;
            this.errorTimestamp = Date.now();
        } else {
            this.lastError = null;
            this.errorTimestamp = null;
        }

        await this.state.storage.put("currentSentenceIndex", this.currentSentenceIndex);
        await this.state.storage.put("audioChunks", this.audioChunks);
        await this.state.storage.put("lastError", this.lastError);
        await this.state.storage.put("errorTimestamp", this.errorTimestamp);
        console.log(`TTSStateDurableObject progress updated for sentence ${sentenceIndex}.`);
    }

    async getJobState() {
        return {
            initialised: this.initialised,
            text: this.text,
            voiceId: this.voiceId,
            currentSentenceIndex: this.currentSentenceIndex,
            audioChunks: this.audioChunks,
            lastError: this.lastError,
            errorTimestamp: this.errorTimestamp
        };
    }

    async fetch(request) {
        // Await the initial state load from the constructor
        await this.loadStatePromise;

        // Now, this.initialised will correctly reflect whether the object was initialized from storage.
        if (!this.initialised) {
             console.error("TTSStateDurableObject not initialized, cannot process request.");
             return new Response("Durable Object not initialized.", { status: 500 });
        }

        const url = new URL(request.url);
        const pathname = url.pathname;

        if (pathname === '/initialize') {
            const { text, voiceId } = await request.json();
            await this.initialise(text, voiceId);
            return new Response("TTSStateDurableObject initialized.", { status: 200 });
        } else if (pathname === '/update-progress') {
            const { sentenceIndex, audioChunkBase64, error } = await request.json();
            await this.updateProgress(sentenceIndex, audioChunkBase64, error);
            return new Response("Progress updated.", { status: 200 });
        } else if (pathname === '/get-state') {
            const state = await this.getJobState();
            return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (pathname === '/delete-state') {
            await this.state.storage.deleteAll();
            this.initialised = false;
            this.text = "";
            this.voiceId = "";
            this.currentSentenceIndex = 0;
            this.audioChunks = [];
            this.lastError = null;
            this.errorTimestamp = null;
            // Re-initialize loadStatePromise to ensure a fresh load if the DO instance is reused.
            this.loadStatePromise = this.loadState();
            return new Response("State deleted.", { status: 200 });
        } else {
            return new Response("Not found", { status: 404 });
        }
    }
}