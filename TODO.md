# TODO: R2 Integration Post-Deployment

*   **Configure R2 Bucket Lifecycle Rules**:
    *   Manually configure lifecycle rules in the Cloudflare dashboard for the `tts-audio-results` R2 bucket.
    *   Set a rule to expire objects after a specific number of days (e.g., 1 day for temporary audio files) to ensure automatic deletion.