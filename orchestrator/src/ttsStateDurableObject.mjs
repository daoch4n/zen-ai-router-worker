export class TTSStateDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.text = "";
        this.voiceId = "";
        this.currentSentenceIndex = 0;
        this.audioChunks = [];
        this.lastError = null; // New field for error handling
        this.errorTimestamp = null; // New field for error handling
        this.initialised = false; // Will be set by loadState

        // Load state in the constructor, ensuring it's only done once per instance
        this.loadState().then(() => {
            console.log("TTSStateDurableObject constructor: state loaded.");
        }).catch(error => {
            console.error("TTSStateDurableObject constructor: failed to load state:", error);
            // Handle error during initial load, e.g., set a flag or state to indicate failure
            this.initialised = false; // Ensure it's false if load fails
        });
    }

    async initialise(text, voiceId) {
        if (this.initialised) {
            console.log("TTSStateDurableObject already initialised.");
            return;
        }

        this.text = text;
        this.voiceId = voiceId;
        this.currentSentenceIndex = 0;
        this.audioChunks = [];
        this.lastError = null; // Clear errors on initialization
        this.errorTimestamp = null; // Clear errors on initialization
        this.initialised = true;

        await this.state.storage.put("text", text);
        await this.state.storage.put("voiceId", voiceId);
        await this.state.storage.put("currentSentenceIndex", 0);
        await this.state.storage.put("audioChunks", []);
        await this.state.storage.put("initialised", true);
        await this.state.storage.put("lastError", null); // Persist cleared error
        await this.state.storage.put("errorTimestamp", null); // Persist cleared error
        console.log("TTSStateDurableObject initialised and state persisted.");
    }

    async loadState() {
        // Only load if not already initialised to prevent redundant reads
        if (this.initialised) {
            console.log("TTSStateDurableObject state already in memory.");
            return;
        }

        const [text, voiceId, currentSentenceIndex, audioChunks, initialised, lastError, errorTimestamp] = await this.state.storage.get([
            "text",
            "voiceId",
            "currentSentenceIndex",
            "audioChunks",
            "initialised",
            "lastError", // Load new error field
            "errorTimestamp" // Load new error field
        ]);

        this.text = text || "";
        this.voiceId = voiceId || "";
        this.currentSentenceIndex = currentSentenceIndex || 0;
        this.audioChunks = audioChunks || [];
        this.initialised = initialised || false;
        this.lastError = lastError || null; // Assign loaded error
        this.errorTimestamp = errorTimestamp || null; // Assign loaded error
        console.log("TTSStateDurableObject state loaded.");
    }

    async updateProgress(sentenceIndex, audioChunkBase64, error = null) {
        this.currentSentenceIndex = sentenceIndex;
        this.audioChunks[sentenceIndex] = audioChunkBase64; // Can be null if there was an error for this chunk

        if (error) {
            this.lastError = error;
            this.errorTimestamp = Date.now();
        } else {
            this.lastError = null;
            this.errorTimestamp = null;
        }

        await this.state.storage.put("currentSentenceIndex", this.currentSentenceIndex);
        await this.state.storage.put("audioChunks", this.audioChunks);
        await this.state.storage.put("lastError", this.lastError); // Persist error status
        await this.state.storage.put("errorTimestamp", this.errorTimestamp); // Persist error timestamp
        console.log(`TTSStateDurableObject progress updated for sentence ${sentenceIndex}.`);
    }

    async getJobState() {
        return {
            initialised: this.initialised, // Include initialised status in state
            text: this.text,
            voiceId: this.voiceId,
            currentSentenceIndex: this.currentSentenceIndex,
            audioChunks: this.audioChunks,
            lastError: this.lastError, // Include error information
            errorTimestamp: this.errorTimestamp // Include error information
        };
    }

    async fetch(request) {
        // State is now loaded in the constructor, so no need to await here
        // If initial load failed, we might want to throw or return an error here
        if (!this.initialised && (await this.state.storage.get("initialised")) === false) {
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
            const { sentenceIndex, audioChunkBase64, error } = await request.json(); // Expect 'error' from orchestrator
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
            this.lastError = null; // Clear error on delete
            this.errorTimestamp = null; // Clear error on delete
            return new Response("State deleted.", { status: 200 });
        } else {
            return new Response("Not found", { status: 404 });
        }
    }
}