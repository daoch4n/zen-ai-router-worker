import { arrayBufferToBase64, base64ToArrayBuffer } from '../utils/audio.mjs';

export class TtsJobDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
    this.TTL_SECONDS = 24 * 60 * 60; // 24 hours
  }

  async fetch(request) {
    const url = new URL(request.url);
    const jobId = url.pathname.split('/').pop();

    // Basic validation for jobId (e.g., UUID format)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      return new Response(JSON.stringify({ error: 'Invalid jobId format' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      });
    }

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
        return new Response(JSON.stringify({ error: 'Not found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    });
    }
  }

  async handleInitJob(request, jobId) {
    try {
      const { text, model, voiceId } = await request.json();
      const jobData = {
        jobId,
        text,
        model,
        voiceId,
        status: 'queued',
        result: null,
        createdAt: Date.now(),
      };

      // Set a TTL for the job data (e.g., 24 hours)
      await this.storage.put(jobId, jobData, { expirationTtl: this.TTL_SECONDS });

      return new Response(JSON.stringify({ message: 'Job initialized', jobId }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  }

  async handleUpdateStatus(request, jobId) {
    try {
      const { status } = await request.json();
const allowedStatuses = ['processing', 'completed', 'failed', 'queued'];
      if (!allowedStatuses.includes(status)) {
        return new Response(JSON.stringify({ error: 'Invalid status value' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 400,
        });
      }
      const jobData = await this.storage.get(jobId);

      if (!jobData) {
        return new Response(JSON.stringify({ error: 'Job not found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    });
      }

      jobData.status = status;
      await this.storage.put(jobId, jobData, { expirationTtl: this.TTL_SECONDS });

      return new Response(JSON.stringify({ message: 'Job status updated', jobId, status }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  }

  async handleStoreResult(request, jobId) {
    try {
      const { base64Audio, mimeType } = await request.json();
      const jobData = await this.storage.get(jobId);

      if (!jobData) {
        return new Response(JSON.stringify({ error: 'Job not found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    });
      }

      // Decode Base64: Convert the base64Audio string into a Uint8Array
      const audioBuffer = base64ToArrayBuffer(base64Audio);

      // Upload to R2: Use the R2 bucket binding to upload the binary audio data
      await this.env.TTS_AUDIO_BUCKET.put(jobId, audioBuffer, { contentType: mimeType });

      // Update DO Storage: Remove base64Audio and keep mimeType in DO for retrieval
      jobData.base64Audio = undefined; // Or delete jobData.base64Audio;
      jobData.mimeType = mimeType;
      jobData.status = 'completed';
      await this.storage.put(jobId, jobData, { expirationTtl: this.TTL_SECONDS });

      return new Response(JSON.stringify({ message: 'Job result stored in R2', jobId }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (error) {
      console.error(`Failed to store audio in R2 for job ${jobId}:`, error);
      return new Response(JSON.stringify({ error: 'Failed to store audio result' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }

  async handleGetStatus(jobId) {
    const jobData = await this.storage.get(jobId);

    if (!jobData) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    });
    }

    return new Response(JSON.stringify({ jobId, status: jobData.status }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async handleGetResult(jobId) {
    try {
      const jobData = await this.storage.get(jobId);

      if (!jobData) {
        return new Response(JSON.stringify({ error: 'Job not found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    });
      }

      // Fetch from R2
      const r2Object = await this.env.TTS_AUDIO_BUCKET.get(jobId);
      if (!r2Object) {
        return new Response(JSON.stringify({ error: 'Audio result not found in R2' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    });
      }

      // Convert R2 Object Body to ArrayBuffer
      const arrayBuffer = await r2Object.arrayBuffer();

      // Encode to Base64 using the new utility function
      const base64Audio = await arrayBufferToBase64(arrayBuffer);

      return new Response(JSON.stringify({ jobId, status: jobData.status, base64Audio, mimeType: jobData.mimeType }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (error) {
      console.error(`Failed to retrieve audio from R2 for job ${jobId}:`, error);
      return new Response(JSON.stringify({ error: 'Failed to retrieve audio result' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }
}