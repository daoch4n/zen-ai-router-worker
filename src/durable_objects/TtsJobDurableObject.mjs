export class TtsJobDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const jobId = url.pathname.split('/').pop();

    switch (url.pathname) {
      case `/tts-job/${jobId}/status`:
        return this.handleGetStatus(jobId);
      case `/tts-job/${jobId}/result`:
        return this.handleGetResult(jobId);
      case `/tts-job/${jobId}/init`:
        return this.handleInitJob(request, jobId);
      case `/tts-job/${jobId}/update-status`:
        return this.handleUpdateStatus(request, jobId);
      case `/tts-job/${jobId}/store-result`:
        return this.handleStoreResult(request, jobId);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  async handleInitJob(request, jobId) {
    const { text, model, voiceId } = await request.json();
    const jobData = {
      jobId,
      text,
      model,
      voiceId,
      status: 'processing',
      result: null,
      createdAt: Date.now(),
    };

    // Set a TTL for the job data (e.g., 24 hours)
    const TTL_SECONDS = 24 * 60 * 60; 
    await this.storage.put(jobId, jobData, { expirationTtl: TTL_SECONDS });
    
    return new Response(JSON.stringify({ message: 'Job initialized', jobId }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleUpdateStatus(request, jobId) {
    const { status } = await request.json();
    const jobData = await this.storage.get(jobId);

    if (!jobData) {
      return new Response('Job not found', { status: 404 });
    }

    jobData.status = status;
    await this.storage.put(jobId, jobData);

    return new Response(JSON.stringify({ message: 'Job status updated', jobId, status }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleStoreResult(request, jobId) {
    const { result } = await request.json();
    const jobData = await this.storage.get(jobId);

    if (!jobData) {
      return new Response('Job not found', { status: 404 });
    }

    jobData.result = result;
    jobData.status = 'completed';
    await this.storage.put(jobId, jobData);

    return new Response(JSON.stringify({ message: 'Job result stored', jobId }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleGetStatus(jobId) {
    const jobData = await this.storage.get(jobId);

    if (!jobData) {
      return new Response('Job not found', { status: 404 });
    }

    return new Response(JSON.stringify({ jobId, status: jobData.status }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleGetResult(jobId) {
    const jobData = await this.storage.get(jobId);

    if (!jobData) {
      return new Response('Job not found', { status: 404 });
    }

    return new Response(JSON.stringify({ jobId, status: jobData.status, result: jobData.result }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }
}