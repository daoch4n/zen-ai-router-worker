# Gemini OpenAI Compatibility Layer with Thinking Support

A Cloudflare Worker that provides OpenAI-compatible API access to Google's Gemini models, including advanced thinking capabilities for enhanced reasoning.

## Features

- **OpenAI API Compatibility**: Use Gemini models with existing OpenAI client libraries
- **Thinking Support**: Three distinct modes for different reasoning needs
- **Streaming Support**: Real-time response streaming
- **Function Calling**: Tool use and function calling capabilities
- **Search Integration**: Google Search tool integration
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

## Deployment

This project is designed to be deployed to Cloudflare Workers using GitHub Actions. The deployment workflow (`.github/workflows/cf-deploy.yml`) requires several GitHub Secrets to be configured in your repository.

### Required GitHub Secrets

1.  **`CLOUDFLARE_API_TOKEN`**: Your Cloudflare API Token with permissions to deploy Workers.
2.  **`CLOUDFLARE_ACCOUNT_ID`**: Your Cloudflare Account ID.
3.  **`ALL_API_KEYS_JSON`**: A JSON array string containing all your individual API keys. These keys are dynamically assigned to `KEY1`, `KEY2`, etc., environment variables within the deployed workers.
    Example: `["key_value_1", "key_value_2", "key_value_3"]`
4.  **`PASS`**: A secret string used as an environment variable named `PASS` for both the individual source workers and the orchestrator worker. This will act as API key for the router.

### Deployment Steps

1.  Fork this repository.
2.  **Enable GitHub Actions**: Go to the "Actions" tab of your repository and enable GitHub Actions if they are not already enabled.
3.  Configure the required GitHub Secrets in your repository settings.
4.  Push to the `main` branch or open a Pull Request to trigger the deployment workflow.

### Optional: Deploying TTS Web UI to GitHub Pages

The `tts/index.html` frontend can be optionally deployed to GitHub Pages. Your `cf-deploy.yml` workflow is already configured to build and upload the necessary artifact.

To enable GitHub Pages for your repository, first ensure you have enabled GitHub Actions as described in the main [Deployment Steps](#deployment-steps). Then:

1.  **Navigate to your Repository Settings**: Go to your repository on GitHub and click on the "Settings" tab.
2.  **Go to "Pages"**: In the left sidebar, under "Code and automation", click on "Pages".
3.  **Configure GitHub Pages Source**: Under the "Build and deployment" section, for "Source", select "GitHub Actions".

After these steps, and a successful run of your `cf-deploy.yml` workflow, your TTS Web UI will be published and accessible via your GitHub Pages URL (e.g., `https://your-username.github.io/your-repo-name/`).

## Best Practices

### When to Use Each Mode

- **Standard**: Simple queries, factual information, basic conversations
- **Thinking**: When you need to see the reasoning process, debugging model behavior, educational purposes
- **Refined**: Complex analysis, detailed planning, high-quality outputs where you don't need to see the thinking process

### Budget Level Guidelines

- **Low**: Quick reasoning tasks, simple problem-solving
- **Medium**: Moderate complexity, multi-step problems
- **High**: Complex reasoning, detailed analysis, planning tasks
