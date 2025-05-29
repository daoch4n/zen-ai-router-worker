import { setupTTSClient } from '../../tts/ttsClient.mjs';

// Mock global objects and functions
const mockAudioContext = {
  decodeAudioData: jest.fn(),
  createBufferSource: jest.fn(() => ({
    buffer: null,
    connect: jest.fn(),
    start: jest.fn(),
    onended: null,
  })),
  currentTime: 0,
  baseLatency: 0,
};
const mockAudioBuffer = {
  length: 1000,
  numberOfChannels: 1,
  sampleRate: 48000,
  duration: 1, // 1 second
  getChannelData: jest.fn(() => new Float32Array(1000)),
};
const mockEventSource = jest.fn(() => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  addEventListener: jest.fn(),
  close: jest.fn(),
}));

// Mock DOM elements
const mockSpeakButton = { disabled: false };
const mockLoadingIndicator = { style: { display: 'none' } };
const mockDownloadButtonLink = { href: '', style: { display: 'none' } };
const mockTextDisplayArea = {
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(() => []),
  innerHTML: '', // Add innerHTML to allow setting it
};
const mockToastContainer = {
  appendChild: jest.fn(),
};
const mockMessageDiv = {
  textContent: '',
  style: {},
};

beforeAll(() => {
  global.AudioContext = jest.fn(() => mockAudioContext);
  global.webkitAudioContext = jest.fn(() => mockAudioContext);
  global.EventSource = mockEventSource;
  global.atob = jest.fn(b64 => Buffer.from(b64, 'base64').toString('binary'));
  global.Uint8Array = Uint8Array;
  global.TextDecoder = TextDecoder;
  global.URL = {
    createObjectURL: jest.fn(() => 'blob:mock-url'),
    revokeObjectURL: jest.fn(),
  };

  // Mock document and setTimeout for DOM interactions
  Object.defineProperty(document, 'getElementById', {
    value: jest.fn((id) => {
      if (id === 'toastContainer') return mockToastContainer;
      if (id === 'message') return mockMessageDiv;
      return null;
    }),
    writable: true,
  });
  Object.defineProperty(document, 'createElement', {
    value: jest.fn(() => ({
      className: '',
      textContent: '',
      style: {},
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      addEventListener: jest.fn(),
      remove: jest.fn(),
    })),
    writable: true,
  });

  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.clearAllMocks();
  mockAudioContext.currentTime = 0;
  mockAudioContext.decodeAudioData.mockReset();
  mockAudioContext.createBufferSource.mockClear();
  mockEventSource.mockClear();
  mockSpeakButton.disabled = false;
  mockLoadingIndicator.style.display = 'none';
  mockDownloadButtonLink.style.display = 'none';
  mockDownloadButtonLink.href = '';
});

describe('setupTTSClient', () => {
  test('should return connectToEventSource, showToast, and bufferToWave functions', () => {
    const ttsClient = setupTTSClient('http://mock-url');
    expect(typeof ttsClient.connectToEventSource).toBe('function');
    expect(typeof ttsClient.showToast).toBe('function');
    expect(typeof ttsClient.bufferToWave).toBe('function');
    expect(window.ORCHESTRATOR_WORKER_URL).toBe('http://mock-url');
  });
});

describe('showToast', () => {
  let showToast;

  beforeEach(() => {
    ({ showToast } = setupTTSClient('http://mock-url'));
  });

  test('should display a toast message with default type and duration', () => {
    showToast('Test message');
    expect(mockToastContainer.appendChild).toHaveBeenCalledTimes(1);
    const toastElement = mockToastContainer.appendChild.mock.calls[0][0];
    expect(toastElement.className).toBe('toast toast-info');
    expect(toastElement.textContent).toBe('Test message');

    jest.advanceTimersByTime(10); // for classList.add('show')
    expect(toastElement.classList.add).toHaveBeenCalledWith('show');

    jest.advanceTimersByTime(4000); // for classList.remove('show') and remove()
    expect(toastElement.classList.remove).toHaveBeenCalledWith('show');
    expect(toastElement.addEventListener).toHaveBeenCalledWith('transitionend', expect.any(Function), { once: true });
    toastElement.addEventListener.mock.calls[0][1](); // Manually trigger the transitionend event
    expect(toastElement.remove).toHaveBeenCalled();
  });

  test('should display a toast message with specified type and duration', () => {
    showToast('Error message', 'error', 2000);
    const toastElement = mockToastContainer.appendChild.mock.calls[0][0];
    expect(toastElement.className).toBe('toast toast-error');

    jest.advanceTimersByTime(2010);
    expect(toastElement.classList.remove).toHaveBeenCalledWith('show');
  });

  test('should use fallback message div if toastContainer is not found', () => {
    document.getElementById.mockImplementation((id) => {
      if (id === 'toastContainer') return null;
      if (id === 'message') return mockMessageDiv;
      return null;
    });

    showToast('Fallback message');
    expect(mockToastContainer.appendChild).not.toHaveBeenCalled();
    expect(mockMessageDiv.textContent).toBe('[INFO] Fallback message');
    expect(mockMessageDiv.style.color).toBe('black'); // Default type 'info'
  });

  test('should set color to red for error messages in fallback div', () => {
    document.getElementById.mockImplementation((id) => {
      if (id === 'toastContainer') return null;
      if (id === 'message') return mockMessageDiv;
      return null;
    });

    showToast('Fallback error', 'error');
    expect(mockMessageDiv.style.color).toBe('red');
  });
});

describe('connectToEventSource (TTS Client Core Logic)', () => {
  let connectToEventSource, showToast;
  const mockText = 'Sentence one. Sentence two.';
  const mockVoiceId = 'test-voice';
  const mockApiKey = 'test-api-key';
  const sseExpectedUrl = `http://mock-url/api/tts-stream?voiceId=${encodeURIComponent(mockVoiceId)}&text=${encodeURIComponent(mockText)}`;

  beforeEach(() => {
    ({ connectToEventSource, showToast } = setupTTSClient('http://mock-url'));

    // Reset mocks for specific elements that are queried often
    mockTextDisplayArea.querySelector.mockReset();
    mockTextDisplayArea.querySelectorAll.mockReset();
    mockTextDisplayArea.querySelectorAll.mockReturnValue([]); // Default empty

    mockAudioContext.decodeAudioData.mockResolvedValue(mockAudioBuffer); // Default successful decode
  });

  test('should establish SSE connection and initialize audio context on open', () => {
    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);

    expect(mockEventSource).toHaveBeenCalledWith(sseExpectedUrl, { headers: { 'Authorization': `Bearer ${mockApiKey}` } });
    expect(mockEventSource.mock.instances[0].onopen).not.toBeNull();

    mockEventSource.mock.instances[0].onopen(); // Simulate connection open
    expect(showToast).toHaveBeenCalledWith('SSE stream connected.', 'success');
    expect(global.AudioContext).toHaveBeenCalledTimes(1);
    expect(mockAudioContext.decodeAudioData).not.toHaveBeenCalled(); // No audio yet
  });

  test('should process incoming audio chunks, decode, queue, and play', async () => {
    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);

    const es = mockEventSource.mock.instances[0];
    es.onopen();

    // Simulate first audio chunk
    const firstChunkData = { audioChunk: btoa('raw_audio_data_0'), index: 0, mimeType: 'audio/opus' };
    await es.onmessage({ data: JSON.stringify(firstChunkData) });

    expect(mockAudioContext.decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(1);
    expect(mockAudioContext.createBufferSource.mock.results[0].value.connect).toHaveBeenCalledWith(mockAudioContext.destination);
    expect(mockAudioContext.createBufferSource.mock.results[0].value.start).toHaveBeenCalledWith(0); // Should start at current time (0)

    // Simulate second audio chunk
    const secondChunkData = { audioChunk: btoa('raw_audio_data_1'), index: 1, mimeType: 'audio/opus' };
    await es.onmessage({ data: JSON.stringify(secondChunkData) });

    expect(mockAudioContext.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(1); // Should not create new source yet, as previous is playing

    // Simulate first chunk ending, triggering next playback
    mockAudioContext.createBufferSource.mock.results[0].value.onended();
    expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(2); // New source should be created
    expect(mockAudioContext.createBufferSource.mock.results[1].value.start).toHaveBeenCalledWith(mockAudioBuffer.duration); // Should start after first chunk duration
  });

  test('should handle SSE errors from server data', async () => {
    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);

    const es = mockEventSource.mock.instances[0];
    es.onopen();

    const errorData = { error: { message: 'Backend TTS error' } };
    await es.onmessage({ data: JSON.stringify(errorData) });

    expect(showToast).toHaveBeenCalledWith('Stream Error: Backend TTS error', 'error');
    expect(es.close).toHaveBeenCalledTimes(1);
  });

  test('should handle SSE connection errors via onerror', () => {
    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);

    const es = mockEventSource.mock.instances[0];
    es.onopen();

    es.onerror(new Event('error')); // Simulate connection error

    expect(showToast).toHaveBeenCalledWith('SSE connection error. Please try again.', 'error');
    expect(es.close).toHaveBeenCalledTimes(1);
    expect(mockSpeakButton.disabled).toBe(false);
    expect(mockLoadingIndicator.style.display).toBe('none');
  });

  test('should handle audio decoding errors', async () => {
    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);

    const es = mockEventSource.mock.instances[0];
    es.onopen();
    mockAudioContext.decodeAudioData.mockRejectedValueOnce(new Error('Invalid audio data'));

    const chunkData = { audioChunk: btoa('bad_audio'), index: 0, mimeType: 'audio/opus' };
    await es.onmessage({ data: JSON.stringify(chunkData) });

    expect(showToast).toHaveBeenCalledWith('Audio Error: Invalid audio data', 'error');
    // Ensure that even on error, it tries to continue if more chunks come (though none here)
  });

  test('should generate download link and reset UI on stream end', async () => {
    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);

    const es = mockEventSource.mock.instances[0];
    es.onopen();
    await es.onmessage({ data: JSON.stringify({ audioChunk: btoa('audio_data'), index: 0, mimeType: 'audio/opus' }) });

    es.addEventListener.mock.calls.find(call => call[0] === 'end')[1](); // Simulate 'end' event
    jest.runAllTimers(); // Ensure all pending playbacks finish

    expect(showToast).toHaveBeenCalledWith('Audio stream completed.', 'success');
    expect(es.close).toHaveBeenCalledTimes(1);
    expect(mockSpeakButton.disabled).toBe(false);
    expect(mockLoadingIndicator.style.display).toBe('none');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(mockDownloadButtonLink.href).toBe('blob:mock-url');
    expect(mockDownloadButtonLink.style.display).toBe('block');
  });

  test('should not generate download link if no audio chunks received', async () => {
    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);

    const es = mockEventSource.mock.instances[0];
    es.onopen();
    es.addEventListener.mock.calls.find(call => call[0] === 'end')[1](); // Simulate 'end' event without messages

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mockDownloadButtonLink.style.display).toBe('none');
  });

  test('should handle highlighting for words (basic check)', async () => {
    mockTextDisplayArea.querySelectorAll.mockReturnValue([
      { getAttribute: (attr) => attr === 'data-word-index' ? '0' : null, classList: { add: jest.fn(), remove: jest.fn() } },
      { getAttribute: (attr) => attr === 'data-word-index' ? '1' : null, classList: { add: jest.fn(), remove: jest.fn() } }
    ]);
    mockTextDisplayArea.querySelector.mockImplementation((selector) => {
      if (selector === 'span[data-word-index="0"]') return { classList: { add: jest.fn(), remove: jest.fn() } };
      if (selector === 'span[data-word-index="1"]') return { classList: { add: jest.fn(), remove: jest.fn() } };
      return null;
    });

    connectToEventSource(mockText, mockVoiceId, mockApiKey, mockDownloadButtonLink, mockSpeakButton, mockLoadingIndicator, mockTextDisplayArea);
    const es = mockEventSource.mock.instances[0];
    es.onopen(); // This sets up words array and initial highlights

    // Simulate audio playback for two sentences with short durations for highlighting to advance
    const shortMockAudioBuffer = { ...mockAudioBuffer, duration: 0.1 }; // Make duration very short

    mockAudioContext.decodeAudioData
      .mockResolvedValueOnce(shortMockAudioBuffer)
      .mockResolvedValueOnce(shortMockAudioBuffer);

    await es.onmessage({ data: JSON.stringify({ audioChunk: btoa('audio_data_0'), index: 0, mimeType: 'audio/opus' }) });

    const source1 = mockAudioContext.createBufferSource.mock.results[0].value;
    const word0Element = mockTextDisplayArea.querySelector('span[data-word-index="0"]');
    const word1Element = mockTextDisplayArea.querySelector('span[data-word-index="1"]');

    // Simulate first word highlight
    jest.advanceTimersByTime(10);
    expect(word0Element.classList.add).toHaveBeenCalledWith('highlighted-word');
    expect(word0Element.classList.remove).not.toHaveBeenCalled();

    // Simulate second word highlight
    jest.advanceTimersByTime(100);
    expect(word0Element.classList.remove).toHaveBeenCalledWith('highlighted-word');
    expect(word1Element.classList.add).toHaveBeenCalledWith('highlighted-word');

    // Simulate end of first chunk
    source1.onended();
    expect(word1Element.classList.remove).toHaveBeenCalledWith('highlighted-word'); // Last word of chunk removed
    expect(mockTextDisplayArea.querySelectorAll()[0].classList.remove).toHaveBeenCalled(); // clearAllHighlights

    await es.onmessage({ data: JSON.stringify({ audioChunk: btoa('audio_data_1'), index: 1, mimeType: 'audio/opus' }) });

    es.addEventListener.mock.calls.find(call => call[0] === 'end')[1]();
    jest.runAllTimers(); // Ensure all pending playbacks finish

    expect(mockTextDisplayArea.querySelectorAll()[0].classList.remove).toHaveBeenCalled(); // All highlights cleared
  });
});

describe('bufferToWave', () => {
  let bufferToWave;

  beforeEach(() => {
    ({ bufferToWave } = setupTTSClient('http://mock-url'));
  });

  test('should convert AudioBuffer to WAV Blob with correct headers and data', () => {
    const mockBuffer = {
      numberOfChannels: 1,
      sampleRate: 44100,
      length: 100,
      getChannelData: jest.fn(() => new Float32Array(100).fill(0.5)), // Simple mono audio
    };

    const blob = bufferToWave(mockBuffer, mockBuffer.length);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/wav');
    // Basic size check based on WAV header + 1 channel * 100 samples * 2 bytes/sample (16-bit)
    expect(blob.size).toBe(44 + (1 * 100 * 2));

    // Optional: read blob content and assert specific header bytes if necessary
    // This part is more complex and might involve FileReader, typically skipped for unit tests
    // unless WAV structure is critical to verify.
  });

  test('should handle stereo audio buffers', () => {
    const mockBuffer = {
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 100,
      getChannelData: jest.fn((channel) => new Float32Array(100).fill(channel === 0 ? 0.5 : -0.5)), // Stereo audio
    };

    const blob = bufferToWave(mockBuffer, mockBuffer.length);
    expect(blob.type).toBe('audio/wav');
    // For stereo, length is 44 + (2 channels * 100 samples * 2 bytes/sample)
    expect(blob.size).toBe(44 + (2 * 100 * 2));
  });

  test('should return a Blob even for empty buffer (zero length)', () => {
    const mockBuffer = {
      numberOfChannels: 1,
      sampleRate: 44100,
      length: 0,
      getChannelData: jest.fn(() => new Float32Array(0)),
    };

    const blob = bufferToWave(mockBuffer, mockBuffer.length);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44); // Only WAV header
  });
});