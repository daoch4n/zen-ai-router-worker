// src/durable_objects/TtsJobDurableObject.mjs

import { v4 as uuidv4 } from 'uuid'; // Assuming uuidv4 is used for job IDs
import { HttpError } from '../utils/error.mjs'; // Assuming HttpError is defined here

const TTL_SECONDS = 24 * 60 * 60; // 24 hours

export class TtsJobDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const jobId = path.split('/')[2]; // Assuming path is /tts-job/{jobId}/...

    switch (path) {
      case `/tts-job/${jobId}/init`:
        return this.handleInit(request, jobId);
      case `/tts-job/${jobId}/update-status`:
        return this.handleUpdateStatus(request, jobId);
      case `/tts-job/${jobId}/store-result`:
        return this.handleStoreResult(request, jobId);
      case `/tts-job/${jobId}/status`:
        return this.handleGetStatus(request, jobId);
      case `/tts-job/${jobId}/result`:
        return this.handleGetResult(request, jobId);
      default:
        throw new HttpError('Not Found', 404);
    }
  }

  async handleInit(request, jobId) {
    // Logic to initialize job data (text, model, voiceId, status: 'processing')
    // and store in this.storage
    const { text, model, voiceId } = await request.json();
    await this.storage.put(jobId, {
      text,
      model,
      voiceId,
      status: 'processing',
      createdAt: Date.now(),
    }, { expirationTtl: TTL_SECONDS });
    return new Response(JSON.stringify({ jobId, status: 'processing' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleUpdateStatus(request, jobId) {
    // Logic to update job status in this.storage
    const { status, errorMessage } = await request.json();
    const jobData = await this.storage.get(jobId);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }
    jobData.status = status;
    if (errorMessage) {
      jobData.errorMessage = errorMessage;
    }
    await this.storage.put(jobId, jobData, { expirationTtl: TTL_SECONDS });
    return new Response(JSON.stringify({ jobId, status }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleStoreResult(request, jobId) {
    // Logic to decode base64Audio, store in R2, and update status in this.storage
    const { base64Audio, mimeType } = await request.json();
    const jobData = await this.storage.get(jobId);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }

    const audioBuffer = Buffer.from(base64Audio, 'base64');
    await this.env.TTS_AUDIO_BUCKET.put(jobId, audioBuffer);

    jobData.base64Audio = undefined; // Remove from DO storage
    jobData.mimeType = mimeType;
    jobData.status = 'completed';
    await this.storage.put(jobId, jobData, { expirationTtl: TTL_SECONDS });

    return new Response(JSON.stringify({ jobId, status: 'completed' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleGetStatus(request, jobId) {
    // Logic to retrieve job status from this.storage
    const jobData = await this.storage.get(jobId);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }
    return new Response(JSON.stringify({ jobId, status: jobData.status }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleGetResult(request, jobId) {
    // Logic to retrieve audio from R2, convert to base64, and return
    const jobData = await this.storage.get(jobId);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }
    if (jobData.status !== 'completed') {
      throw new HttpError('Job not completed', 400);
    }

    const audioObject = await this.env.TTS_AUDIO_BUCKET.get(jobId);
    if (!audioObject) {
      throw new HttpError('Audio not found in R2', 404);
    }

    const audioBuffer = await audioObject.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    return new Response(JSON.stringify({
      jobId,
      status: jobData.status,
      base64Audio,
      mimeType: jobData.mimeType,
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }
}