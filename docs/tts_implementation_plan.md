# Plan for Implementing TTS Endpoint in Cloudflare Worker

**Objective:** Add a new `/tts` endpoint to the Cloudflare Worker that converts text to speech using the Google Generative AI API, mirroring the functionality of `scripts/tts.ps1`.

**Steps:**

1.  **Create a New TTS Handler Module:**
    *   Create a new file: `src/handlers/tts.mjs`.
    *   This module will encapsulate all the logic related to the TTS functionality.

2.  **Implement Core TTS Logic in `src/handlers/tts.mjs`:**
    *   **`handleTTS(requestBody, apiKey)` function:**
        *   This will be the main asynchronous function responsible for processing TTS requests.
        *   It will parse `requestBody` to extract the text, desired voice (e.g., `voiceName`, `secondVoiceName` for multi-speaker), and model.
        *   It will construct the API request payload for Google Generative AI, similar to how `scripts/tts.ps1` builds `$requestBody`.
        *   It will make a `fetch` call to the Google Generative AI API.
        *   It will handle the API response, extracting the base64-encoded audio data.
        *   It will decode the base64 string into raw audio bytes (`Uint8Array`).
        *   It will then convert this raw audio data into a WAV format.
        *   Finally, it will return a `Response` object with the `Content-Type` set to `audio/wav` and the WAV audio data.
    *   **`optimizeTextForJson(text)` function:**
        *   Translate the logic from the PowerShell function `Optimize-TextForJson` to JavaScript.
        *   This will involve replacing specific Unicode characters, removing invisible characters, normalizing line endings, and cleaning up whitespace to ensure the text is suitable for JSON serialization and API consumption.
    *   **`newWavHeader(dataLength, sampleRate, channels, bitsPerSample)` function:**
        *   Translate the logic from the PowerShell function `New-WavHeader` to JavaScript.
        *   This function will generate the 44-byte WAV header as a `Uint8Array`, calculating the necessary fields (file size, byte rate, block align) based on the audio data length and format parameters.
    *   **`convertToWavFormat(pcmData, sampleRate, channels, bitsPerSample)` function:**
        *   Translate the logic from the PowerShell function `ConvertTo-WavFormat` to JavaScript.
        *   This function will take raw PCM audio data (`Uint8Array`), generate a WAV header using `newWavHeader`, and concatenate the header and PCM data to produce a complete WAV file as a `Uint8Array`.
    *   **Error Handling:** Integrate with the existing `errorHandler` utility from `src/utils/index.mjs` for consistent error responses.

3.  **Integrate the New Handler into the Worker Entry Point:**
    *   **Modify `src/handlers/index.mjs`:**
        *   Add an export for the new `handleTTS` function from `src/handlers/tts.mjs`.
    *   **Modify `src/worker.mjs`:**
        *   Import `handleTTS` from `src/handlers/index.mjs`.
        *   Add a new `case` within the `switch (true)` statement for the `/tts` endpoint:
            ```javascript
            case pathname.endsWith("/tts"):
                if (!(request.method === "POST")) {
                    throw new Error("Assertion failed: expected POST request");
                }
                const ttsResponse = await handleTTS(await request.json(), apiKey)
                    .catch(errHandler);
                console.log(`TTS response status: ${ttsResponse.status}`);
                return ttsResponse;
            ```
        *   Ensure the `getRandomApiKey` function is correctly used to retrieve the API key for the TTS request.

**Mermaid Diagram:**

```mermaid
graph TD
    A[User Request: /tts Endpoint] --> B(src/worker.mjs);
    B --> C{Pathname Check};
    C -- /tts --> D[Call handleTTS in src/handlers/tts.mjs];

    subgraph src/handlers/tts.mjs
        D --> D1[Parse Request Body (text, voice, model)];
        D1 --> D2[Call optimizeTextForJson];
        D2 --> D3[Construct Google API Request Payload];
        D3 --> D4[Fetch from Google Generative AI API];
        D4 --> D5[Extract Base64 Audio Data];
        D5 --> D6[Decode Base64 to PCM Uint8Array];
        D6 --> D7[Call newWavHeader];
        D7 --> D8[Call convertToWavFormat];
        D8 --> D9[Return audio/wav Response];
    end

    D --> E[Error Handling via errorHandler];
    E --> F[Return Final Response];

    style D1 fill:#f9f,stroke:#333,stroke-width:2px
    style D2 fill:#f9f,stroke:#333,stroke-width:2px
    style D3 fill:#f9f,stroke:#333,stroke-width:2px
    style D4 fill:#f9f,stroke:#333,stroke-width:2px
    style D5 fill:#f9f,stroke:#333,stroke-width:2px
    style D6 fill:#f9f,stroke:#333,stroke-width:2px
    style D7 fill:#f9f,stroke:#333,stroke-width:2px
    style D8 fill:#f9f,stroke:#333,stroke-width:2px
    style D9 fill:#f9f,stroke:#333,stroke-width:2px