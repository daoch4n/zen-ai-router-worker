# Gemini OpenAI Compatibility Layer with Thinking Support

A Cloudflare Worker that provides OpenAI-compatible API access to Google's Gemini models, including advanced thinking capabilities for enhanced reasoning.

## Features

- **OpenAI API Compatibility**: Use Gemini models with existing OpenAI client libraries
- **Thinking Support**: Three distinct modes for different reasoning needs
- **Streaming Support**: Real-time response streaming
- **Function Calling**: Tool use and function calling capabilities
- **Search Integration**: Google Search tool integration
- **Text-to-Speech**: High-quality TTS with both WAV and raw audio output formats
- **Multiple Model Support**: Gemini, Gemma, and LearnLM models

## Quick Start

To use Gemini models with OpenAI libraries, make these three changes:

1. **API Key**: Replace with your API key (so random guy cant access it)
2. **Base URL**: Point to your deployed worker endpoint
3. **Model**: Choose a compatible Gemini model with optional thinking mode

## Thinking Modes

### Mode 1: Standard (Default)
Model names without suffixes behave exactly as the original Gemini API.

**Example**: `gemini-2.5-flash-preview-05-20`
- No reasoning_effort parameter is set
- Response returned as-is from Gemini API

### Mode 2: Thinking Mode (Exposed Reasoning)
Model names with `-thinking-{budget}` suffix expose the model's internal reasoning process.

**Example**: `gemini-2.5-flash-preview-05-20-thinking-medium`
- Sets thinking budget based on level
- Returns complete response including thinking tags
- Useful for debugging and understanding model reasoning

### Mode 3: Refined Mode (Hidden Reasoning)
Model names with `-refined-{budget}` suffix use thinking internally but hide the reasoning process.

**Example**: `gemini-2.5-flash-preview-05-20-refined-high`
- Sets thinking budget based on level
- Removes thinking tags from response
- Provides enhanced quality answers without verbose reasoning

## Budget Levels

| Level | Thinking Tokens | Use Case |
|-------|----------------|----------|
| `none` | 0 | Simple factual queries |
| `low` | 1,024 | Basic reasoning tasks |
| `medium` | 8,192 | Moderate complexity problems |
| `high` | 24,576 | Complex reasoning, multi-step planning |

## Text-to-Speech Endpoints

This worker provides two TTS endpoints for different use cases:

### Standard TTS (`/tts`)
- Returns processed WAV audio files ready for immediate playback
- Content-Type: `audio/wav`
- Best for: Direct audio playback, standard audio workflows

### Raw TTS (`/rawtts`)
- Returns base64-encoded raw audio data from Google's API
- Content-Type: Google API mimeType (e.g., `audio/L16;rate=24000`)
- Best for: Client-side processing, custom audio handling, bandwidth optimization

Both endpoints use identical authentication, parameters, and validation. See [TTS Documentation](docs/tts-endpoint.md) for detailed usage examples.

## Deployment

1. Clone this repository
2. Install dependencies: `npm install`
3. Copy wrangler.toml.example to wrangler.toml
4. Configure your Gemini API keys in `wrangler.toml`
5. Deploy to Cloudflare Workers: `npm run deploy`

## Best Practices

### When to Use Each Mode

- **Standard**: Simple queries, factual information, basic conversations
- **Thinking**: When you need to see the reasoning process, debugging model behavior, educational purposes
- **Refined**: Complex analysis, detailed planning, high-quality outputs where you don't need to see the thinking process

### Budget Level Guidelines

- **Low**: Quick reasoning tasks, simple problem-solving
- **Medium**: Moderate complexity, multi-step problems
- **High**: Complex reasoning, detailed analysis, planning tasks
