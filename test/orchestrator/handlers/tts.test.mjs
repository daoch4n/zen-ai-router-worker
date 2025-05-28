import handleTtsRequest from '../../orchestrator/src/index.mjs'; // Adjust path if needed
import { TextEncoder } from 'util'; // Node.js TextEncoder for testing

// Mocking global objects for testing environment
global.TextEncoder = TextEncoder;
global.Response = class MockResponse {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Map(Object.entries(options.headers || {}));
  }

  async json() {
    if (typeof this.body === 'string') {
      try {
        return JSON.parse(this.body);
      } catch (e) {
        throw new Error('Invalid JSON in mock response body');
      }
    }
    return this.body;
  }

  async text() {
    if (typeof this.body === 'string') {
      return this.body;
    }
    return JSON.stringify(this.body);
  }
};

global.Request = class MockRequest {
  constructor(url, options = {}) {
    this.url = url;
    this.method = options.method || 'GET';
    this._body = options.body;
    this.headers = new Map(Object.entries(options.headers || {}));
  }

  async json() {
    return JSON.parse(this._body);
  }
};

// Mocking TransformStream for SSE
class MockWritableStream {
  constructor() {
    this.chunks = [];
    this.closed = false;
  }
  write(chunk) {
    this.chunks.push(chunk);
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  // Helper to decode all chunks for assertion
  decodeAll() {
    const decoder = new TextDecoder();
    return this.chunks.map(chunk => decoder.decode(chunk)).join('');
  }
}

global.TransformStream = class MockTransformStream {
  constructor() {
    this.readable = {}; // Minimal mock for readable
    this.writable = new MockWritableStream();
  }
};

describe('handleTtsRequest', () => {
  let mockEnv;
  let mockBackendServices;
  let mockRouterCounterStub;
  let mockFetch;

  beforeEach(() => {
    mockRouterCounterStub = {
      fetch: jest.fn(() => Promise.resolve(new Response("1")))
    };

    mockEnv = {
      ROUTER_COUNTER: {
        idFromName: jest.fn(() => "global-router-counter-id"),
        get: jest.fn(() => mockRouterCounterStub)
      },
      BACKEND_SERVICE_0: { fetch: jest.fn() },
      BACKEND_SERVICE_1: { fetch: jest.fn() },
    };

    // Sort backend services by key index to match original logic
    mockBackendServices = Object.keys(mockEnv)
      .filter(key => key.startsWith("BACKEND_SERVICE_"))
      .sort((a, b) => parseInt(a.split('_')[2]) - parseInt(b.split('_')[2]))
      .map(key => mockEnv[key]);

    // Mock global fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Reset console.log and console.error mocks before each test
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return 405 for non-POST requests', async () => {
    const request = new Request('https://example.com/api/tts', { method: 'GET' });
    const response = await handleTtsRequest(request, mockEnv, mockBackendServices, mockBackendServices.length);
    expect(response.status).toBe(405);
    expect(await response.text()).toBe('Method Not Allowed');
  });

  it('should return 400 for missing required parameters', async () => {
    const request = new Request('https://example.com/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'test' }), // Missing voiceId and apiKey
      headers: { 'Content-Type': 'application/json' }
    });
    const response = await handleTtsRequest(request, mockEnv, mockBackendServices, mockBackendServices.length);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Missing required parameters: text, voiceId, or apiKey');
  });

  it('should successfully stream audio chunks via SSE for multiple sentences', async () => {
    mockEnv.ROUTER_COUNTER.get.mockReturnValue(mockRouterCounterStub);
    mockRouterCounterStub.fetch.mockResolvedValue(new Response("1")); // Always hit backend service 1

    // Mock backend service to return audio for each sentence
    mockBackendServices[1].fetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ audioContentBase64: 'audio1' }), { status: 200 }))
    );
    mockBackendServices[1].fetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ audioContentBase64: 'audio2' }), { status: 200 }))
    );

    const request = new Request('https://example.com/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Sentence one. Sentence two.', voiceId: 'test-voice', apiKey: 'test-key' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await handleTtsRequest(request, mockEnv, mockBackendServices, mockBackendServices.length);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');

    // Simulate reading from the readable stream
    const reader = response.body.getReader();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += new TextDecoder().decode(value);
    }

    expect(result).toContain('event: message\nid: 0\ndata: {"audioChunk":"audio1","index":0,"mimeType":"audio/opus"}\n\n');
    expect(result).toContain('event: message\nid: 1\ndata: {"audioChunk":"audio2","index":1,"mimeType":"audio/opus"}\n\n');
    expect(result).toContain('event: end\ndata: \n\n');

    expect(mockBackendServices[1].fetch).toHaveBeenCalledTimes(2);
    expect(mockBackendServices[1].fetch).toHaveBeenCalledWith(expect.any(Request));
    expect(mockBackendServices[1].fetch.mock.calls[0][0].body).toContain('Sentence one');
    expect(mockBackendServices[1].fetch.mock.calls[1][0].body).toContain('Sentence two');
  });

  it('should handle backend service errors and send SSE error messages', async () => {
    mockEnv.ROUTER_COUNTER.get.mockReturnValue(mockRouterCounterStub);
    mockRouterCounterStub.fetch.mockResolvedValue(new Response("1")); // Always hit backend service 1

    mockBackendServices[1].fetch.mockResolvedValueOnce(new Response('{"error": {"message": "Backend error"}}', { status: 500 }));
    mockBackendServices[1].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ audioContentBase64: 'audio2' }), { status: 200 }));


    const request = new Request('https://example.com/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Sentence one. Sentence two.', voiceId: 'test-voice', apiKey: 'test-key' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await handleTtsRequest(request, mockEnv, mockBackendServices, mockBackendServices.length);

    const reader = response.body.getReader();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += new TextDecoder().decode(value);
    }
    
    // Expect an error message for the first sentence due to 500 status
    expect(result).toContain('event: error\nid: 0\ndata: {"index":0,"message":"Synthesis failed for sentence 0: Backend Error: Backend error","audioContentBase64":null}\n\n');
    // Expect success for the second sentence
    expect(result).toContain('event: message\nid: 1\ndata: {"audioChunk":"audio2","index":1,"mimeType":"audio/opus"}\n\n');
    expect(result).toContain('event: end\ndata: \n\n');

    expect(mockBackendServices[1].fetch).toHaveBeenCalledTimes(2); // Two calls, one for each sentence
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Backend Error: Backend error for sentence 0'));
  });

  it('should retry on transient backend errors (5xx or 429) and eventually succeed', async () => {
    mockEnv.ROUTER_COUNTER.get.mockReturnValue(mockRouterCounterStub);
    mockRouterCounterStub.fetch.mockResolvedValue(new Response("0")); // Always hit backend service 0

    // First attempt: 503 error
    mockBackendServices[0].fetch.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }));
    // Second attempt: 429 error
    mockBackendServices[0].fetch.mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));
    // Third attempt: Success
    mockBackendServices[0].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ audioContentBase64: 'retried-audio' }), { status: 200 }));

    const request = new Request('https://example.com/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Single sentence to retry.', voiceId: 'test-voice', apiKey: 'test-key' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await handleTtsRequest(request, mockEnv, mockBackendServices, mockBackendServices.length);

    const reader = response.body.getReader();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += new TextDecoder().decode(value);
    }

    expect(result).toContain('event: message\nid: 0\ndata: {"audioChunk":"retried-audio","index":0,"mimeType":"audio/opus"}\n\n');
    expect(result).toContain('event: end\ndata: \n\n');

    // Expect 3 fetch calls for the single sentence due to retries
    expect(mockBackendServices[0].fetch).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Backend error for sentence 0, attempt 1/4. Retrying... Error: HTTP error Status 503'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Backend error for sentence 0, attempt 2/4. Retrying... Error: HTTP error Status 429'));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Synthesis failed for sentence 0'));
  });

  it('should send error message if all retries fail', async () => {
    mockEnv.ROUTER_COUNTER.get.mockReturnValue(mockRouterCounterStub);
    mockRouterCounterStub.fetch.mockResolvedValue(new Response("0")); // Always hit backend service 0

    // All attempts fail (3 retries + 1 initial = 4 attempts)
    mockBackendServices[0].fetch.mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    const request = new Request('https://example.com/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Single sentence to fail.', voiceId: 'test-voice', apiKey: 'test-key' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await handleTtsRequest(request, mockEnv, mockBackendServices, mockBackendServices.length);

    const reader = response.body.getReader();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += new TextDecoder().decode(value);
    }

    expect(result).toContain('event: error\nid: 0\ndata: {"index":0,"message":"Synthesis failed for sentence 0: Backend Error: HTTP error Status 500","audioContentBase64":null}\n\n');
    expect(result).toContain('event: end\ndata: \n\n');

    expect(mockBackendServices[0].fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Synthesis failed for sentence 0: Backend Error: HTTP error Status 500'));
  });

  it('should handle network fetch errors and send SSE error messages after retries', async () => {
    mockEnv.ROUTER_COUNTER.get.mockReturnValue(mockRouterCounterStub);
    mockRouterCounterStub.fetch.mockResolvedValue(new Response("0")); // Always hit backend service 0

    // Simulate network error
    mockBackendServices[0].fetch.mockRejectedValue(new TypeError('Network Error'));

    const request = new Request('https://example.com/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Sentence with network issue.', voiceId: 'test-voice', apiKey: 'test-key' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await handleTtsRequest(request, mockEnv, mockBackendServices, mockBackendServices.length);

    const reader = response.body.getReader();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += new TextDecoder().decode(value);
    }

    expect(result).toContain('event: error\nid: 0\ndata: {"index":0,"message":"Synthesis failed for sentence 0: Fetch Exception: Network Error","audioContentBase64":null}\n\n');
    expect(result).toContain('event: end\ndata: \n\n');

    expect(mockBackendServices[0].fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Synthesis failed for sentence 0: Fetch Exception: Network Error'));
  });
});