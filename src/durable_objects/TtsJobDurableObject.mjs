// src/durable_objects/TtsJobDurableObject.mjs

import { v4 as uuidv4 } from 'uuid'; // Assuming uuidv4 is used for job IDs
import { HttpError } from '../utils/error.mjs'; // Assuming HttpError is defined here
import { splitIntoSentences, getTextByteCount } from '../utils/textProcessing.mjs';

const TTL_SECONDS = 24 * 60 * 60; // 24 hours
const MAX_TEXT_LENGTH_CHAR_COUNT = 1500;

// Text processing utilities are now imported from ../utils/textProcessing.mjs


export class TtsJobDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage; // Direct reference to state.storage
  }

  // New methods to be implemented here

  async initializeJob(request) {
    const jobIdFromState = this.state.id.toString();
    const { jobId, text, voiceId, model, splittingPreference } = await request.json();

    if (jobId !== jobIdFromState) {
        throw new HttpError(
            `Job ID in request body ('${jobId}') must match Durable Object instance ID ('${jobIdFromState}').`,
            400
        );
    }

    if (!jobId || !text || !voiceId || !model || !splittingPreference) {
      throw new HttpError("Missing required fields for job initialization: jobId, text, voiceId, model, splittingPreference", 400);
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
        throw new HttpError("Text must be a non-empty string.", 400);
    }
    // Add other basic validations for voiceId, model, splittingPreference if necessary

    const validSplittingPreferences = ['characterCount', 'none', 'sentence'];
    if (!validSplittingPreferences.includes(splittingPreference)) {
        throw new HttpError(
            `Invalid splittingPreference value: '${splittingPreference}'. Must be one of ${validSplittingPreferences.join(', ')}.`,
            400
        );
    }

    let sentences;
    if (splittingPreference === 'characterCount') {
        const initialSentences = splitIntoSentences(text);

        // First, check if any single sentence exceeds the character limit.
        for (const sentence of initialSentences) {
            if (getTextByteCount(sentence) > MAX_TEXT_LENGTH_CHAR_COUNT) {
                throw new HttpError(
                    `A single sentence exceeds the maximum allowed length of ${MAX_TEXT_LENGTH_CHAR_COUNT} characters.`,
                    400
                );
            }
        }

        const batchedSentences = [];
        let currentBatch = '';
        let currentBatchLength = 0;

        for (const sentence of initialSentences) {
            const sentenceLength = getTextByteCount(sentence);
            // This existing logic handles batching for sentences that are individually within the limit
            // but collectively might exceed it, or super long sentences that couldn't be split further.
            // The check above ensures no single sentence is *initially* too long.
            if (sentenceLength > MAX_TEXT_LENGTH_CHAR_COUNT) { // This condition might seem redundant now but kept for safety / future text processing changes
                if (currentBatch.length > 0) {
                    batchedSentences.push(currentBatch.trim());
                    currentBatch = '';
                    currentBatchLength = 0;
                }
                batchedSentences.push(sentence.trim());
            } else if (currentBatchLength + sentenceLength > MAX_TEXT_LENGTH_CHAR_COUNT) {
                batchedSentences.push(currentBatch.trim());
                currentBatch = sentence;
                currentBatchLength = sentenceLength;
            } else {
                currentBatch += (currentBatch.length > 0 ? ' ' : '') + sentence;
                currentBatchLength += sentenceLength;
            }
        }
        if (currentBatch.length > 0) {
            batchedSentences.push(currentBatch.trim());
        }
        sentences = batchedSentences.filter(s => s.length > 0);
    } else if (splittingPreference === 'none') {
        sentences = [text];
    } else { // Default: sentence by sentence
        sentences = splitIntoSentences(text);
    }

    if (sentences.length === 0 && text.length > 0) { // Handle cases where splitting might result in empty array for non-empty text
        sentences = [text]; // Fallback to treat as single sentence
    }


    const jobData = {
      jobId,
      originalText: text,
      voiceId,
      model,
      splittingPreference,
      sentences, // Array of text chunks
      processedAudioChunks: sentences.map(() => ({ r2Key: null, mimeType: null, status: 'pending' })),
      currentSentenceIndex: 0, // Next sentence to give out for processing
      processedSentenceCount: 0, // How many sentences have been successfully processed
      status: 'initialized',
      createdAt: Date.now(),
      errorMessage: null,
    };

    await this.storage.put(jobId, jobData, { expirationTtl: TTL_SECONDS });

    return new Response(JSON.stringify({
        jobId,
        status: jobData.status,
        totalSentences: sentences.length,
        message: "Job initialized successfully"
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async getNextSentenceToProcess(request, jobIdFromPath) {
    const jobData = await this.storage.get(jobIdFromPath);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }

    if (jobData.status !== 'initialized' && jobData.status !== 'processing') {
      return new Response(JSON.stringify({ done: true, message: `Job is not in a processable state. Current status: ${jobData.status}` }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const indexToProcess = jobData.currentSentenceIndex;

    if (indexToProcess < jobData.sentences.length) {
      const sentence = jobData.sentences[indexToProcess];
      jobData.currentSentenceIndex = indexToProcess + 1; // Increment to indicate this sentence is dispatched
      if (jobData.status === 'initialized') {
        jobData.status = 'processing';
      }
      await this.storage.put(jobIdFromPath, jobData, { expirationTtl: TTL_SECONDS });

      return new Response(JSON.stringify({
        sentence: sentence,
        index: indexToProcess,
        done: false,
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } else {
      // All sentences have been dispatched.
      // If status is 'processing' and all dispatched, it means we are waiting for them to be marked processed.
      // If status becomes 'completed', then all are done.
      return new Response(JSON.stringify({ done: true, message: "All sentences have been dispatched for processing." }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }
  }

  async markSentenceAsProcessed(request, jobIdFromPath) {
    const { index, r2Key, mimeType } = await request.json();

    if (typeof index !== 'number' || index < 0 || !r2Key || typeof r2Key !== 'string' || !mimeType || typeof mimeType !== 'string') {
      throw new HttpError("Missing or invalid required fields: index (non-negative number), r2Key (string), mimeType (string)", 400);
    }

    const jobData = await this.storage.get(jobIdFromPath);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }

    if (jobData.status !== 'processing') {
        throw new HttpError(`Job is not in 'processing' state. Current status: ${jobData.status}. Cannot mark sentence as processed.`, 400);
    }
    if (index >= jobData.sentences.length) {
        throw new HttpError(`Invalid sentence index ${index}. Job has ${jobData.sentences.length} sentences.`, 400);
    }
    if (jobData.processedAudioChunks[index] && jobData.processedAudioChunks[index].status === 'completed') {
        // Sentence already marked as completed, possibly a retry from client.
        // Return current status, or could be an error depending on desired idempotency.
        console.warn(`Job ${jobIdFromPath}, sentence ${index} already marked as completed. Ignoring duplicate request.`);
        return new Response(JSON.stringify({
            jobId: jobIdFromPath,
            status: jobData.status,
            processedSentenceCount: jobData.processedSentenceCount,
            message: `Sentence ${index} was already marked as processed.`
        }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
    }


    jobData.processedAudioChunks[index] = { r2Key, mimeType, status: 'completed' };
    jobData.processedSentenceCount = (jobData.processedSentenceCount || 0) + 1;

    // Check if all sentences have reached a terminal state
    let finalizedSentenceCount = 0;
    jobData.processedAudioChunks.forEach(chunk => {
        if (chunk.status === 'completed' || chunk.status === 'failed') {
            finalizedSentenceCount++;
        }
    });

    if (finalizedSentenceCount === jobData.sentences.length) {
        const hasAnyFailedSentences = jobData.processedAudioChunks.some(chunk => chunk.status === 'failed');
        if (hasAnyFailedSentences) {
            jobData.status = 'completed_with_errors';
            console.log(`Job ${jobIdFromPath} finalized with errors. All ${jobData.sentences.length} sentences attempted.`);
        } else {
            jobData.status = 'completed';
            console.log(`Job ${jobIdFromPath} finalized successfully. All ${jobData.sentences.length} sentences processed.`);
        }
    }
    // If not all finalized, jobData.status remains 'processing' or 'processing_with_errors' (from updateJobStatus)


    await this.storage.put(jobIdFromPath, jobData, { expirationTtl: TTL_SECONDS });

    return new Response(JSON.stringify({
      jobId: jobIdFromPath,
      status: jobData.status,
      processedSentenceCount: jobData.processedSentenceCount,
      message: `Sentence ${index} marked as processed.`
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async getAudioChunkMetadata(request, jobIdFromPath, sentenceIndexStr) {
    const sentenceIndex = parseInt(sentenceIndexStr, 10);
    if (isNaN(sentenceIndex) || sentenceIndex < 0) {
        throw new HttpError("Sentence index must be a non-negative integer.", 400);
    }

    const jobData = await this.storage.get(jobIdFromPath);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }

    if (sentenceIndex >= jobData.sentences.length) {
        throw new HttpError(`Sentence index ${sentenceIndex} out of bounds. Job has ${jobData.sentences.length} sentences.`, 400);
    }

    const chunkMetadata = jobData.processedAudioChunks[sentenceIndex];

    if (chunkMetadata && chunkMetadata.status === 'completed') {
        return new Response(JSON.stringify({
            r2Key: chunkMetadata.r2Key,
            mimeType: chunkMetadata.mimeType,
            status: 'completed'
        }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
    } else {
        return new Response(JSON.stringify({
            status: chunkMetadata ? chunkMetadata.status : 'pending', // if no record, assume pending
            message: `Metadata for sentence ${sentenceIndex} is not yet available or processing failed.`
        }), { headers: { 'Content-Type': 'application/json' }, status: chunkMetadata && chunkMetadata.status === 'failed' ? 500 : 202 }); // 202 Accepted if pending
    }
  }


  async getJobState(request, jobIdFromPath) {
    const jobData = await this.storage.get(jobIdFromPath);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }

    // Filter sensitive or overly large fields for general state queries if necessary
    const { sentences, originalText, ...essentialJobData } = jobData;

    return new Response(JSON.stringify({
      ...essentialJobData, // Includes jobId, status, voiceId, model, splittingPreference, currentSentenceIndex, processedSentenceCount, createdAt, errorMessage
      totalSentences: jobData.sentences.length, // Ensure totalSentences is present
      // processedAudioChunks can be large, consider returning only statuses or a summary unless specifically requested
      processedAudioChunksSummary: jobData.processedAudioChunks.map(chunk => ({ status: chunk.status, mimeType: chunk.mimeType })),
      // originalText: jobData.originalText, // Optionally include originalText
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  async updateJobStatus(request, jobIdFromPath) { // This method might be less used if status is managed by other methods
    const { status, errorMessage, sentenceIndexToFail } = await request.json(); // Added sentenceIndexToFail
    if (!status && typeof sentenceIndexToFail !== 'number') {
      throw new HttpError("Missing required field: status, or sentenceIndexToFail must be provided to mark a sentence as failed.", 400);
    }

    const jobData = await this.storage.get(jobIdFromPath);
    if (!jobData) {
      throw new HttpError('Job not found', 404);
    }

    if (typeof sentenceIndexToFail === 'number') {
        if (sentenceIndexToFail < 0 || sentenceIndexToFail >= jobData.sentences.length) {
            throw new HttpError(`Invalid sentenceIndexToFail: ${sentenceIndexToFail}. Must be between 0 and ${jobData.sentences.length - 1}.`, 400);
        }

        // Directly update the status and error of the specified sentence chunk
        jobData.processedAudioChunks[sentenceIndexToFail].status = 'failed';
        if (errorMessage !== undefined) { // errorMessage from request body is associated with this sentence failure
            jobData.processedAudioChunks[sentenceIndexToFail].error = errorMessage;
        }

        // Note: processedSentenceCount is not incremented for failed sentences.
        // Overall job status might become 'failed' or 'partial_success' based on this.
        // For now, we just mark the chunk. The job status itself is handled below.

        // Check if this failure leads to all sentences being finalized
        let finalizedSentenceCount = 0;
        jobData.processedAudioChunks.forEach(chunk => {
            if (chunk.status === 'completed' || chunk.status === 'failed') {
                finalizedSentenceCount++;
            }
        });

        if (finalizedSentenceCount === jobData.sentences.length) {
            // Since we just marked one as failed, it must be completed_with_errors
            // This will be overridden if a more general 'status' (like 'failed') is also part of this request.
            if (!status || status === 'completed_with_errors' || status === 'processing_with_errors') {
                jobData.status = 'completed_with_errors';
            }
            console.log(`Job ${jobIdFromPath} finalized with errors due to sentence ${sentenceIndexToFail} failure. All ${jobData.sentences.length} sentences attempted.`);
        } else if (jobData.status !== 'failed' && jobData.status !== 'completed_with_errors' && jobData.status !== 'processing_error' && (!status || (status !== 'failed' && status !== 'completed_with_errors'))) {
            // Don't override a more terminal overall status unless it's also a terminal one.
            // Also, don't override if 'status' in request is already setting a terminal state.
            jobData.status = 'processing_with_errors';
        }
    }

    // This allows the incoming 'status' to override any logic above (e.g. if orchestrator wants to set job to 'failed')
    if (status) {
        jobData.status = status;
    }

    if (errorMessage !== undefined) { // Allow clearing/setting overall job errorMessage
      jobData.errorMessage = errorMessage;
    }

    // The following check is largely covered by the logic above when sentenceIndexToFail is processed.
    // It might offer some safety if 'status' is directly set to 'processing' while there are failed chunks,
    // but the above logic should handle setting 'processing_with_errors' or 'completed_with_errors' appropriately.
    // Consider removing if confident in the above. For now, it's harmless.
    // if (jobData.processedAudioChunks.some(c => c.status === 'failed') && jobData.status === 'processing') {
    //     jobData.status = 'processing_with_errors';
    // }


    await this.storage.put(jobIdFromPath, jobData, { expirationTtl: TTL_SECONDS });
    return new Response(JSON.stringify({
        jobId: jobIdFromPath,
        status: jobData.status,
        errorMessage: jobData.errorMessage,
        sentenceFailed: sentenceIndexToFail
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }


  // --- Fetch Handler ---

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const pathSegments = url.pathname.split('/');
      // pathSegments example for /tts-job/{jobId}/initialize:
      // ["", "tts-job", "{jobId}", "initialize"]
      // pathSegments example for /tts-job/{jobId}/chunk/{sentenceIndex}/metadata:
      // ["", "tts-job", "{jobId}", "chunk", "{sentenceIndex}", "metadata"]

      if (pathSegments.length < 3 || pathSegments[1] !== 'tts-job') {
        throw new HttpError('Invalid base path format. Expected /tts-job/...', 400);
      }

      const method = request.method;
      const jobIdFromPath = pathSegments[2];
      const actionOrPrimaryResource = pathSegments[3];

      // Route for initializing a job
      // Path: POST /tts-job/{jobId}/initialize
      // The client generates jobId and includes it in path and body.
      // initializeJob reads jobId from the body.
      if (method === 'POST' &&
          jobIdFromPath && jobIdFromPath !== 'initialize' && // Ensure jobIdFromPath is a real ID
          actionOrPrimaryResource === 'initialize' &&
          pathSegments.length === 4) {
        return this.initializeJob(request);
      }

      // All subsequent actions require a valid jobIdFromPath that is not 'initialize'
      if (!jobIdFromPath || jobIdFromPath === 'initialize') {
        throw new HttpError('Missing or invalid jobId in path segment.', 400);
      }

      if (method === 'GET' && actionOrPrimaryResource === 'next-sentence' && pathSegments.length === 4) {
        return this.getNextSentenceToProcess(request, jobIdFromPath);
      } else if (method === 'POST' && actionOrPrimaryResource === 'sentence-processed' && pathSegments.length === 4) {
        return this.markSentenceAsProcessed(request, jobIdFromPath);
      } else if (method === 'GET' && actionOrPrimaryResource === 'state' && pathSegments.length === 4) {
        return this.getJobState(request, jobIdFromPath);
      } else if (method === 'POST' && actionOrPrimaryResource === 'update-status' && pathSegments.length === 4) {
        return this.updateJobStatus(request, jobIdFromPath);
      } else if (method === 'GET' &&
                 actionOrPrimaryResource === 'chunk' &&
                 pathSegments.length === 6 &&
                 pathSegments[5] === 'metadata') {
        // Path: /tts-job/{jobId}/chunk/{sentenceIndex}/metadata
        const sentenceIndexStr = pathSegments[4];
        return this.getAudioChunkMetadata(request, jobIdFromPath, sentenceIndexStr);
      }
      // --- Keep or adapt old R2 methods if needed for combined audio ---
      else if (method === 'POST' && actionOrPrimaryResource === 'store-result' && pathSegments.length === 4) {
        return this.handleStoreResult(request, jobIdFromPath);
      } else if (method === 'GET' && actionOrPrimaryResource === 'result' && pathSegments.length === 4) {
        return this.handleGetResult(request, jobIdFromPath);
      }
      // Old /status route for compatibility
       else if (method === 'GET' && actionOrPrimaryResource === 'status' && pathSegments.length === 4) {
        const jobData = await this.storage.get(jobIdFromPath);
        if (!jobData) {
          throw new HttpError('Job not found', 404);
        }
        return new Response(JSON.stringify({
            jobId: jobIdFromPath,
            status: jobData.status,
            currentSentenceIndex: jobData.currentSentenceIndex,
            processedSentenceCount: jobData.processedSentenceCount,
            totalSentences: jobData.sentences?.length
        }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
      }

      throw new HttpError(`Action '${actionOrPrimaryResource}' not found, has incorrect parameters, or method '${method}' not allowed for path ${url.pathname}.`, 404);

    } catch (error) {
      console.error("DurableObject Error:", error.message, error.stack); // Log more details
      if (error instanceof HttpError) {
        return new Response(JSON.stringify({ error: error.message, status: error.statusCode }), {
          headers: { 'Content-Type': 'application/json' },
          status: error.statusCode,
        });
      }
      return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }

  // R2 related methods for storing/retrieving *combined* audio (can be kept if needed)
  // Stores a final, combined audio result in R2 for the job.
  // This method is intended for a workflow where individual audio chunks are first generated
  // and then assembled into a single audio file, which is then stored using this endpoint.
  // It is NOT directly used in the primary chunk-based streaming flow from the orchestrator.
  async handleStoreResult(request, jobId) {
    const { base64Audio, mimeType } = await request.json();
    const jobData = await this.storage.get(jobId);
    if (!jobData) throw new HttpError('Job not found', 404);
    if (!this.env.TTS_AUDIO_BUCKET) throw new HttpError('R2 Bucket (TTS_AUDIO_BUCKET) is not configured.', 500);

    const audioBuffer = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
    await this.env.TTS_AUDIO_BUCKET.put(`combined/${jobId}`, audioBuffer.buffer, { // Store combined under a prefix
        httpMetadata: { contentType: mimeType },
    });

    await this.storage.transaction(async txn => {
        let currentJobData = await txn.get(jobId);
        if (!currentJobData) throw new HttpError('Job not found during transaction', 404);
        currentJobData.combinedAudioR2Path = `combined/${jobId}`;
        currentJobData.combinedAudioMimeType = mimeType;
        currentJobData.status = 'completed_and_combined_stored'; // New status
        await txn.put(jobId, currentJobData, { expirationTtl: TTL_SECONDS });
    });

    return new Response(JSON.stringify({ jobId, status: 'completed_and_combined_stored' }), {
      headers: { 'Content-Type': 'application/json' }, status: 200 });
  }

  // Retrieves a final, combined audio result previously stored in R2 for the job.
  // This method complements handleStoreResult and is used to fetch the single, combined audio file.
  // It is NOT directly used in the primary chunk-based streaming flow from the orchestrator.
  async handleGetResult(request, jobId) {
    const jobData = await this.storage.get(jobId);
    if (!jobData) throw new HttpError('Job not found', 404);
    if (jobData.status !== 'completed_and_combined_stored' || !jobData.combinedAudioR2Path) {
      throw new HttpError('Combined job result not yet stored in R2.', 400);
    }
    if (!this.env.TTS_AUDIO_BUCKET) throw new HttpError('R2 Bucket is not configured.', 500);

    const audioObject = await this.env.TTS_AUDIO_BUCKET.get(jobData.combinedAudioR2Path);
    if (!audioObject) throw new HttpError('Combined audio not found in R2', 404);

    const audioBuffer = await audioObject.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    return new Response(JSON.stringify({
      jobId,
      status: jobData.status,
      base64Audio,
      mimeType: jobData.combinedAudioMimeType || 'application/octet-stream',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
  }

  async alarm() {
    console.log("Durable Object alarm triggered for potential cleanup or finalization tasks.");
    // Example: await this.storage.deleteAll(); // Use with caution
  }
}