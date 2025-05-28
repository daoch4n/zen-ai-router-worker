export function setupTTSClient(orchestratorWorkerUrl) {
    window.ORCHESTRATOR_WORKER_URL = orchestratorWorkerUrl; // Ensure this is configured
    const SENTENCE_FETCH_TIMEOUT_MS = 15000;
    const FIRST_SENTENCE_TIMEOUT_MS = 20000;

    let audioContext;
    let audioQueue = [];
    let currentSource = null;
    let playStartTime = 0;
    let lastPlayedIndex = -1;
    let cumulativeAudioDuration = 0;
    let connectionErrorOccurred = false;
    let fullAudioBuffers = []; // Array to store all decoded audio buffers for reconstruction
    let currentHighlightedWordIndex = 0; // New: To keep track of the currently highlighted word
    let words = []; // New: To store the words from the input text

    function showToast(message, type = 'info', duration = 4000) {
        const toastContainer = document.getElementById('toastContainer');
        const messageDiv = document.getElementById('message'); // Fallback

        if (!toastContainer) {
            if (messageDiv) {
                messageDiv.textContent = `[${type.toUpperCase()}] ${message}`;
                messageDiv.style.color = type === 'error' ? 'red' : (type === 'success' ? 'green' : 'black');
            }
            console.warn("Toast container not found. Using fallback message div.");
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);

        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, duration);
    }

    const connectToEventSource = (text, voiceId, apiKey, downloadButtonLink, speakButton, loadingIndicator, textDisplayArea) => {
        words = text.split(/\b(\w+)\b|\s+/).filter(Boolean).map((word, index) => {
            // Only consider actual words for highlighting, not spaces or punctuation alone
            if (word.match(/\b(\w+)\b/)) {
                return { text: word, index: index, element: null };
            }
            return { text: word, index: index, element: null, isSeparator: true };
        });
        currentHighlightedWordIndex = 0;

        const sseUrl = `${window.ORCHESTRATOR_WORKER_URL}/api/tts-stream?voiceId=${encodeURIComponent(voiceId)}&text=${encodeURIComponent(text)}`;
        const eventSource = new EventSource(sseUrl, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        eventSource.onopen = () => {
            console.log('SSE connection opened.');
            showToast('SSE stream connected.', 'success');
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            cumulativeAudioDuration = 0; // Reset for new playback
            lastPlayedIndex = -1; // Reset for new playback
            audioQueue = []; // Clear queue
            fullAudioBuffers = []; // Clear full audio buffers
            currentSource = null; // Clear current source

            // Initial setup for highlighting
            const wordSpans = textDisplayArea.querySelectorAll('span[data-word-index]');
            words.forEach(word => {
                if (!word.isSeparator) {
                    word.element = textDisplayArea.querySelector(`span[data-word-index="${word.index}"]`);
                }
            });
            clearAllHighlights();
        };

        eventSource.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.error) {
                console.error('SSE Error:', data.error);
                showToast(`Stream Error: ${data.error.message || 'Unknown error'}`, 'error');
                connectionErrorOccurred = true;
                eventSource.close();
                return;
            }

            const audioChunk = data.audioChunk;
            const index = data.index;
            const mimeType = data.mimeType;

            if (audioChunk && audioContext) {
                try {
                    const audioData = Uint8Array.from(atob(audioChunk), c => c.charCodeAt(0));
                    const audioBuffer = await audioContext.decodeAudioData(audioData.buffer);

                    fullAudioBuffers.push({ buffer: audioBuffer, index: index }); // Store for reconstruction
                    audioQueue.push({ buffer: audioBuffer, index: index });
                    audioQueue.sort((a, b) => a.index - b.index); // Ensure correct order

                    if (!currentSource || (audioContext.currentTime >= cumulativeAudioDuration + audioContext.baseLatency && lastPlayedIndex < index)) {
                        playNextChunk(textDisplayArea); // Pass textDisplayArea
                    }

                } catch (e) {
                    console.error('Error decoding audio data:', e);
                    showToast(`Audio Error: ${e.message}`, 'error');
                }
            }
        };

        eventSource.addEventListener('end', async () => {
            console.log('SSE stream ended.');
            showToast('Audio stream completed.', 'success');
            eventSource.close();
            clearAllHighlights(); // Clear highlights when done

            if (fullAudioBuffers.length > 0 && audioContext) {
                fullAudioBuffers.sort((a, b) => a.index - b.index);

                const totalLength = fullAudioBuffers.reduce((sum, chunk) => sum + chunk.buffer.length, 0);
                const outputBuffer = audioContext.createBuffer(
                    fullAudioBuffers[0].buffer.numberOfChannels,
                    totalLength,
                    fullAudioBuffers[0].buffer.sampleRate
                );

                let offset = 0;
                for (const chunk of fullAudioBuffers) {
                    for (let i = 0; i < chunk.buffer.numberOfChannels; i++) {
                        outputBuffer.copyToChannel(chunk.buffer.getChannelData(i), i, offset);
                    }
                    offset += chunk.buffer.length;
                }

                const wavBlob = bufferToWave(outputBuffer, outputBuffer.length);
                downloadButtonLink.href = URL.createObjectURL(wavBlob);
                downloadButtonLink.style.display = 'block';
            }

            speakButton.disabled = false;
            loadingIndicator.style.display = 'none';
        });

        eventSource.onerror = (error) => {
            console.error('SSE Error:', error);
            if (!connectionErrorOccurred) {
                showToast('SSE connection error. Please try again.', 'error');
                connectionErrorOccurred = true;
            }
            eventSource.close();
            speakButton.disabled = false;
            loadingIndicator.style.display = 'none';
            clearAllHighlights(); // Clear highlights on error
        };
    };

    const playNextChunk = (textDisplayArea) => {
        if (audioQueue.length > 0) {
            const { buffer, index } = audioQueue.shift();

            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);

            let scheduledTime = cumulativeAudioDuration;
            if (scheduledTime < audioContext.currentTime) {
                scheduledTime = audioContext.currentTime;
            }

            source.start(scheduledTime);
            currentSource = source;
            lastPlayedIndex = index;
            cumulativeAudioDuration += buffer.duration;

            const totalWords = words.filter(w => !w.isSeparator).length;
            const wordsInThisChunk = words.slice(currentHighlightedWordIndex).filter(w => !w.isSeparator).length;
            const estimatedWordDuration = buffer.duration / wordsInThisChunk; // Simple estimation

            let wordHighlightTimeout;
            let currentChunkWordIndex = 0;

            const highlightWord = () => {
                if (currentHighlightedWordIndex < words.length) {
                    // Remove previous highlight
                    if (currentHighlightedWordIndex > 0) {
                        const prevWord = words[currentHighlightedWordIndex - 1];
                        if (prevWord && prevWord.element) {
                            prevWord.element.classList.remove('highlighted-word');
                        }
                    }

                    // Find the next actual word to highlight
                    while (currentHighlightedWordIndex < words.length && words[currentHighlightedWordIndex].isSeparator) {
                        currentHighlightedWordIndex++;
                    }

                    if (currentHighlightedWordIndex < words.length && words[currentHighlightedWordIndex].element) {
                        words[currentHighlightedWordIndex].element.classList.add('highlighted-word');
                        currentHighlightedWordIndex++;
                        currentChunkWordIndex++;
                        if (currentChunkWordIndex < wordsInThisChunk) {
                            wordHighlightTimeout = setTimeout(highlightWord, estimatedWordDuration * 1000);
                        }
                    } else {
                        currentHighlightedWordIndex++; // Advance even if no element to highlight (e.g., punctuation)
                        if (currentHighlightedWordIndex < words.length) {
                            wordHighlightTimeout = setTimeout(highlightWord, estimatedWordDuration * 1000);
                        }
                    }
                }
            };
            highlightWord();


            source.onended = () => {
                clearTimeout(wordHighlightTimeout); // Clear timeout for this chunk
                // Remove highlight from the last word of this chunk
                const lastWordOfChunk = words[currentHighlightedWordIndex - 1];
                if (lastWordOfChunk && lastWordOfChunk.element) {
                    lastWordOfChunk.element.classList.remove('highlighted-word');
                }

                if (audioQueue.length > 0) {
                    playNextChunk(textDisplayArea);
                } else {
                    currentSource = null;
                    clearAllHighlights(); // Ensure all highlights are cleared at the very end
                }
            };
        }
    };

    function clearAllHighlights() {
        words.forEach(word => {
            if (word.element) {
                word.element.classList.remove('highlighted-word');
            }
        });
    }

    function bufferToWave(abuffer, len) {
        var numOfChan = abuffer.numberOfChannels,
            length = len * numOfChan * 2 + 44,
            buffer = new ArrayBuffer(length),
            view = new DataView(buffer),
            channels = [], i, sample,
            offset = 0,
            pos = 0;

        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"

        setUint32(0x20746d66); // "fmt " chunk
        setUint32(16); // length = 16
        setUint16(1); // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * numOfChan * 2); // avg. bytes/sec
        setUint16(numOfChan * 2); // block-align
        setUint16(16); // 16-bit (each sample uses 2 bytes)

        setUint32(0x61746164); // "data" chunk
        setUint32(length - pos - 4); // chunk length

        for (i = 0; i < abuffer.numberOfChannels; i++)
            channels.push(abuffer.getChannelData(i));

        while (pos < length) {
            for (i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++
        }

        return new Blob([buffer], { type: 'audio/wav' });

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }

    return { connectToEventSource, showToast, bufferToWave };
}