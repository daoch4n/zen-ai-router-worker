import 'jest-canvas-mock'; // Required for mocking Canvas-related APIs for AudioContext

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn(key => store[key] || null),
    setItem: jest.fn((key, value) => { store[key] = value.toString(); }),
    clear: jest.fn(() => { store = {}; })
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock DOM elements and their methods
const mockHtml = `
<!DOCTYPE html>
<html>
<body>
  <textarea id="textInput"></textarea>
  <select id="voiceIdInput"></select>
  <input type="text" id="apiKeyInput">
  <button id="speakButton"></button>
  <div id="settingsCog"></div>
  <a id="downloadButton"></a>
  <div id="loadingIndicator"></div>
  <div id="message"></div>
  <div id="toastContainer"></div>
  <div class="top-input-bar"></div>
</body>
</html>
`;

document.body.innerHTML = mockHtml;

// Helper to simulate event dispatch
const dispatchClick = (element) => {
  element.dispatchEvent(new Event('click'));
};

const dispatchChange = (element) => {
  element.dispatchEvent(new Event('change'));
};

// Mock AudioContext and related Web Audio API
class MockAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel) {
    return this.channels[channel];
  }
}

class MockAudioBufferSourceNode {
  constructor() {
    this.buffer = null;
    this.connect = jest.fn();
    this.start = jest.fn();
    this.stop = jest.fn();
    this.onended = null;
  }
}

const MockAudioContext = jest.fn(function() {
  this.decodeAudioData = jest.fn(buffer => {
    return Promise.resolve(new MockAudioBuffer(1, 44100, 44100));
  });
  this.createBuffer = jest.fn((channels, length, sampleRate) => {
    return new MockAudioBuffer(channels, length, sampleRate);
  });
  this.createBufferSource = jest.fn(() => new MockAudioBufferSourceNode());
  this.destination = {};
  this.currentTime = 0;
  this.baseLatency = 0;
});

// Mock EventSource
class MockEventSource {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.eventListeners = new Map();
    this.readyState = 0; // CONNECTING
    this.close = jest.fn(() => { this.readyState = 2; /* CLOSED */ });
  }

  addEventListener(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  // Helper to trigger events
  _trigger(event, data) {
    if (this.onmessage && event === 'message') {
      this.onmessage({ data: JSON.stringify(data) });
    }
    if (this.onerror && event === 'error') {
      this.onerror(data);
    }
    const handlers = this.eventListeners.get(event) || [];
    handlers.forEach(handler => handler({ data: JSON.stringify(data) }));
  }

  // Simulate opening the connection
  _simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) {
      this.onopen();
    }
  }

  // Simulate sending a message
  _simulateMessage(data) {
    this._trigger('message', data);
  }

  // Simulate sending an 'end' event
  _simulateEnd() {
    this._trigger('end', ''); // 'end' event usually has empty data
  }

  // Simulate an error
  _simulateError(error) {
    this._trigger('error', error);
  }
}

Object.defineProperty(window, 'AudioContext', { value: MockAudioContext });
Object.defineProperty(window, 'webkitAudioContext', { value: MockAudioContext });
Object.defineProperty(window, 'EventSource', { value: MockEventSource });

// Mock atob (for base64 decoding)
global.atob = jest.fn((b64) => Buffer.from(b64, 'base64').toString('binary'));
global.Uint8Array = Uint8Array; // Ensure Uint8Array is available

// Mock URL.createObjectURL for download button
global.URL.createObjectURL = jest.fn(() => 'blob:mock/audio');

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));


describe('TTS Frontend', () => {
  let textInput, voiceIdInput, apiKeyInput, speakButton, settingsCog, downloadButton, loadingIndicator, messageDiv, toastContainer;
  let mockEventSourceInstance;

  // Re-import and re-evaluate the script content before each test
  // This ensures a fresh state for the event listeners
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    document.body.innerHTML = mockHtml; // Reset DOM

    textInput = document.getElementById('textInput');
    voiceIdInput = document.getElementById('voiceIdInput');
    apiKeyInput = document.getElementById('apiKeyInput');
    speakButton = document.getElementById('speakButton');
    settingsCog = document.getElementById('settingsCog');
    downloadButton = document.getElementById('downloadButton');
    loadingIndicator = document.getElementById('loadingIndicator');
    messageDiv = document.getElementById('message');
    toastContainer = document.getElementById('toastContainer');

    // Simulate DOMContentLoaded manually since we're replacing innerHTML
    const scriptElement = document.createElement('script');
    scriptElement.textContent = `
      window.ORCHESTRATOR_WORKER_URL = 'https://mock.orchestrator.url';
      const SENTENCE_FETCH_TIMEOUT_MS = 15000;
      const FIRST_SENTENCE_TIMEOUT_MS = 20000;

      document.addEventListener('DOMContentLoaded', () => {
        const apiKeyInput = document.getElementById('apiKeyInput');
        const settingsCog = document.getElementById('settingsCog');
        const storedApiKey = localStorage.getItem('apiKey');

        if (storedApiKey) {
          apiKeyInput.value = storedApiKey;
          apiKeyInput.type = 'password';
          apiKeyInput.style.display = 'none';
          settingsCog.style.display = 'inline-block';
        } else {
          apiKeyInput.style.display = 'block';
          settingsCog.style.display = 'inline-block';
        }

        const storedVoiceId = localStorage.getItem('voiceId');
        if (storedVoiceId) {
          document.getElementById('voiceIdInput').value = storedVoiceId;
        }

        const topInputBar = document.querySelector('.top-input-bar');
        function updateBodyPadding() {
          if (topInputBar) {
            const barHeight = topInputBar.offsetHeight;
            document.body.style.paddingTop = \`\${barHeight + 20}px\`;
          }
        }

        if (topInputBar) {
          updateBodyPadding();
          window.addEventListener('resize', updateBodyPadding);
          new ResizeObserver(updateBodyPadding).observe(topInputBar);
        }

        settingsCog.addEventListener('click', () => {
          const isHidden = apiKeyInput.style.display === 'none';
          apiKeyInput.style.display = isHidden ? 'block' : 'none';
          if (isHidden && apiKeyInput.value) {
            apiKeyInput.type = 'text';
          } else if (!isHidden) {
            apiKeyInput.type = 'password';
          }
        });

        document.getElementById('voiceIdInput').addEventListener('change', (event) => {
          localStorage.setItem('voiceId', event.target.value);
        });
      });

      function showToast(message, type = 'info', duration = 4000) {
        const toastContainer = document.getElementById('toastContainer');
        const messageDiv = document.getElementById('message'); // Fallback
        if (!toastContainer) {
          if (messageDiv) {
            messageDiv.textContent = \`[\${type.toUpperCase()}] \${message}\`;
            messageDiv.style.color = type === 'error' ? 'red' : (type === 'success' ? 'green' : 'black');
          }
          console.warn("Toast container not found. Using fallback message div.");
          return;
        }

        const toast = document.createElement('div');
        toast.className = \`toast toast-\${type}\`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);

        setTimeout(() => {
          toast.classList.remove('show');
          toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, duration);
      }

      document.getElementById('speakButton').addEventListener('click', async () => {
        const text = document.getElementById('textInput').value;
        const voiceId = document.getElementById('voiceIdInput').value;
        const apiKey = document.getElementById('apiKeyInput').value;
        const messageDiv = document.getElementById('message');
        const downloadButtonLink = document.getElementById('downloadButton');
        const speakButton = document.getElementById('speakButton');
        const loadingIndicator = document.getElementById('loadingIndicator');

        messageDiv.textContent = '';
        downloadButtonLink.style.display = 'none';
        downloadButtonLink.href = '';
        speakButton.disabled = true;
        loadingIndicator.style.display = 'flex';

        if (!text || !apiKey) {
          showToast('Please enter text and API Key.', 'error');
          speakButton.disabled = false;
          loadingIndicator.style.display = 'none';
          return;
        }
        if (!window.ORCHESTRATOR_WORKER_URL) {
          showToast('Error: Orchestrator URL not configured.', 'error');
          speakButton.disabled = false;
          loadingIndicator.style.display = 'none';
          return;
        }

        localStorage.setItem('apiKey', apiKey);

        try {
          showToast("TTS request sent to orchestrator. Awaiting stream...", 'info');

          let audioContext;
          let audioQueue = [];
          let currentSource = null;
          let playStartTime = 0;
          let lastPlayedIndex = -1;
          let cumulativeAudioDuration = 0;
          let connectionErrorOccurred = false;
          let fullAudioBuffers = []; // Array to store all decoded audio buffers for reconstruction

          const connectToEventSource = () => {
            const sseUrl = \`\${window.ORCHESTRATOR_WORKER_URL}/api/tts-stream?voiceId=\${encodeURIComponent(voiceId)}&text=\${encodeURIComponent(text)}\`;
            const eventSource = new EventSource(sseUrl, {
              headers: {
                'Authorization': \`Bearer \${apiKey}\`
              }
            });
            mockEventSourceInstance = eventSource; // Store instance for test control

            eventSource.onopen = () => {
              console.log('SSE connection opened.');
              showToast('SSE stream connected.', 'success');
              if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
              }
            };

            eventSource.onmessage = async (event) => {
              const data = JSON.parse(event.data);
              if (data.error) {
                console.error('SSE Error:', data.error);
                showToast(\`Stream Error: \${data.error.message || 'Unknown error'}\`, 'error');
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

                  fullAudioBuffers.push({ buffer: audioBuffer, index: index });
                  audioQueue.push({ buffer: audioBuffer, index: index });
                  audioQueue.sort((a, b) => a.index - b.index);

                  if (!currentSource || (audioContext.currentTime >= cumulativeAudioDuration + audioContext.baseLatency && lastPlayedIndex < index)) {
                    playNextChunk();
                  }

                } catch (e) {
                  console.error('Error decoding audio data:', e);
                  showToast(\`Audio Error: \${e.message}\`, 'error');
                }
              }
            };

            eventSource.addEventListener('end', async () => {
              console.log('SSE stream ended.');
              showToast('Audio stream completed.', 'success');
              eventSource.close();
              
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
            };
          };

          const playNextChunk = () => {
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

              source.onended = () => {
                if (audioQueue.length > 0) {
                  playNextChunk();
                } else {
                  currentSource = null;
                }
              };
            }
          };

          // Mock this function since we're testing the client-side logic, not the WAV encoding itself
          function bufferToWave(abuffer, len) {
            return new Blob(["mock-wav-data"], { type: 'audio/wav' });
          }

          connectToEventSource();
        } catch (error) {
          console.error('TTS Request Error:', error);
          showToast(\`Error: \${error.message}\`, 'error');
        } finally {
          speakButton.disabled = false;
          loadingIndicator.style.display = 'none';
        }
      });
    `;
    document.body.appendChild(scriptElement);
    // Manually trigger DOMContentLoaded to run the script
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  it('should disable speak button and show loading indicator on click', async () => {
    textInput.value = 'Test text';
    apiKeyInput.value = 'test-api-key';
    dispatchClick(speakButton);

    expect(speakButton.disabled).toBe(true);
    expect(loadingIndicator.style.display).toBe('flex');
    expect(messageDiv.textContent).toBe('');
    expect(downloadButton.style.display).toBe('none');
    expect(downloadButton.href).toBe('');
  });

  it('should show error toast if text or API key is missing', async () => {
    // Missing text
    apiKeyInput.value = 'test-api-key';
    dispatchClick(speakButton);
    expect(toastContainer.children.length).toBe(1);
    expect(toastContainer.children[0].textContent).toContain('Please enter text and API Key.');
    expect(speakButton.disabled).toBe(false);
    expect(loadingIndicator.style.display).toBe('none');

    // Missing API key
    textInput.value = 'Test text';
    apiKeyInput.value = '';
    dispatchClick(speakButton);
    expect(toastContainer.children.length).toBe(2); // New toast added
    expect(toastContainer.children[1].textContent).toContain('Please enter text and API Key.');
  });

  it('should connect to EventSource and handle open event', async () => {
    textInput.value = 'Test text';
    apiKeyInput.value = 'test-api-key';

    const consoleLogSpy = jest.spyOn(console, 'log');

    dispatchClick(speakButton);
    // Ensure the EventSource constructor was called
    expect(MockEventSource).toHaveBeenCalledWith(
      'https://mock.orchestrator.url/api/tts-stream?voiceId=&text=Test%20text', // voiceId is empty by default in mock
      { headers: { 'Authorization': 'Bearer test-api-key' } }
    );
    expect(mockEventSourceInstance).toBeInstanceOf(MockEventSource);

    mockEventSourceInstance._simulateOpen();

    expect(consoleLogSpy).toHaveBeenCalledWith('SSE connection opened.');
    expect(toastContainer.children[0].textContent).toContain('TTS request sent to orchestrator. Awaiting stream...');
    expect(toastContainer.children[1].textContent).toContain('SSE stream connected.');
    expect(window.AudioContext).toHaveBeenCalledTimes(1); // AudioContext initialized on open
  });

  it('should process audio chunks and play them', async () => {
    textInput.value = 'Test text';
    apiKeyInput.value = 'test-api-key';
    dispatchClick(speakButton);

    mockEventSourceInstance._simulateOpen(); // This triggers new (window.AudioContext || window.webkitAudioContext)()

    // Retrieve the AudioContext instance created by the application code
    // This works because MockAudioContext is now a jest.fn() constructor
    const scriptAudioContextInstance = MockAudioContext.mock.instances[0];
    expect(scriptAudioContextInstance).toBeDefined(); // Ensure an instance was created

    // Mock the createBufferSource method on the *actual* instance used by the script
    const mockAudioBufferSourceNodeInstance = new MockAudioBufferSourceNode();
    scriptAudioContextInstance.createBufferSource.mockReturnValue(mockAudioBufferSourceNodeInstance);

    // Simulate first audio chunk
    mockEventSourceInstance._simulateMessage({ audioChunk: btoa('raw_audio_data_1'), index: 0, mimeType: 'audio/opus' });
    await Promise.resolve(); // Allow promises to resolve

    expect(atob).toHaveBeenCalledWith('raw_audio_data_1');
    expect(scriptAudioContextInstance.decodeAudioData).toHaveBeenCalled();
    expect(scriptAudioContextInstance.createBufferSource).toHaveBeenCalled();
    expect(mockAudioBufferSourceNodeInstance.buffer).toBeInstanceOf(MockAudioBuffer);
    expect(mockAudioBufferSourceNodeInstance.connect).toHaveBeenCalledWith(scriptAudioContextInstance.destination);
    expect(mockAudioBufferSourceNodeInstance.start).toHaveBeenCalled();

    // Simulate second audio chunk
    mockEventSourceInstance._simulateMessage({ audioChunk: btoa('raw_audio_data_2'), index: 1, mimeType: 'audio/opus' });
    await Promise.resolve(); // Allow promises to resolve

    // Simulate end of first chunk playback
    mockAudioBufferSourceNodeInstance.onended();
    await Promise.resolve(); // Allow promises to resolve

    // Should play next chunk
    expect(mockAudioBufferSourceNodeInstance.start).toHaveBeenCalledTimes(2);
  });

  it('should handle SSE error messages and close connection', async () => {
    textInput.value = 'Test text';
    apiKeyInput.value = 'test-api-key';
    const consoleErrorSpy = jest.spyOn(console, 'error');

    dispatchClick(speakButton);
    mockEventSourceInstance._simulateOpen();
    mockEventSourceInstance._simulateMessage({ error: { message: 'Test stream error' } });
    await Promise.resolve(); // Allow promises to resolve

    expect(consoleErrorSpy).toHaveBeenCalledWith('SSE Error:', { message: 'Test stream error' });
    expect(toastContainer.children[2].textContent).toContain('Stream Error: Test stream error');
    expect(mockEventSourceInstance.close).toHaveBeenCalledTimes(1);
    expect(speakButton.disabled).toBe(false);
    expect(loadingIndicator.style.display).toBe('none');
  });

  it('should handle SSE connection error (onerror) and close connection', async () => {
    textInput.value = 'Test text';
    apiKeyInput.value = 'test-api-key';
    const consoleErrorSpy = jest.spyOn(console, 'error');

    dispatchClick(speakButton);
    mockEventSourceInstance._simulateOpen();
    mockEventSourceInstance._simulateError(new Event('error'));
    await Promise.resolve(); // Allow promises to resolve

    expect(consoleErrorSpy).toHaveBeenCalledWith('SSE Error:', expect.any(Event));
    expect(toastContainer.children[2].textContent).toContain('SSE connection error. Please try again.');
    expect(mockEventSourceInstance.close).toHaveBeenCalledTimes(1);
    expect(speakButton.disabled).toBe(false);
    expect(loadingIndicator.style.display).toBe('none');
  });

  it('should handle stream end event and enable download button', async () => {
    textInput.value = 'Test text';
    apiKeyInput.value = 'test-api-key';
    dispatchClick(speakButton);

    mockEventSourceInstance._simulateOpen();
    // Simulate some audio chunks
    mockEventSourceInstance._simulateMessage({ audioChunk: btoa('chunk1'), index: 0, mimeType: 'audio/opus' });
    mockEventSourceInstance._simulateMessage({ audioChunk: btoa('chunk2'), index: 1, mimeType: 'audio/opus' });
    await Promise.resolve(); // Allow promises to resolve

    // Simulate end of stream
    mockEventSourceInstance._simulateEnd();
    await Promise.resolve(); // Allow promises to resolve

    expect(toastContainer.children[2].textContent).toContain('Audio stream completed.');
    expect(mockEventSourceInstance.close).toHaveBeenCalledTimes(1);
    expect(downloadButton.style.display).toBe('block');
    expect(downloadButton.href).toContain('blob:mock/audio');
    expect(speakButton.disabled).toBe(false);
    expect(loadingIndicator.style.display).toBe('none');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('should load API key and voice ID from localStorage on DOMContentLoaded', () => {
    localStorageMock.setItem('apiKey', 'stored-key');
    localStorageMock.setItem('voiceId', 'stored-voice');

    // Manually trigger DOMContentLoaded again to simulate page load
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(apiKeyInput.value).toBe('stored-key');
    expect(apiKeyInput.type).toBe('password');
    expect(apiKeyInput.style.display).toBe('none');
    expect(settingsCog.style.display).toBe('inline-block');
    expect(voiceIdInput.value).toBe('stored-voice');
  });

  it('should save API key and voice ID to localStorage', async () => {
    textInput.value = 'Test text';
    apiKeyInput.value = 'new-api-key';
    voiceIdInput.value = 'achird'; // Set a value from the options in index.html

    dispatchClick(speakButton); // This should trigger saving apiKey
    expect(localStorageMock.setItem).toHaveBeenCalledWith('apiKey', 'new-api-key');

    voiceIdInput.value = 'algenib';
    dispatchChange(voiceIdInput); // This should trigger saving voiceId
    expect(localStorageMock.setItem).toHaveBeenCalledWith('voiceId', 'algenib');
  });

  it('should toggle API key visibility when settings cog is clicked', () => {
    localStorageMock.setItem('apiKey', 'initial-key');
    document.dispatchEvent(new Event('DOMContentLoaded')); // Load initial state

    expect(apiKeyInput.type).toBe('password');
    expect(apiKeyInput.style.display).toBe('none');

    dispatchClick(settingsCog); // First click: show
    expect(apiKeyInput.type).toBe('text');
    expect(apiKeyInput.style.display).toBe('block');

    dispatchClick(settingsCog); // Second click: hide
    expect(apiKeyInput.type).toBe('password');
    expect(apiKeyInput.style.display).toBe('block'); // still block because it has a value, but type changes
  });
});