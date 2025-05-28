import { optimizeTextForJson } from '../../orchestrator/src/utils/textProcessing.mjs'; // Import from orchestrator utils
import { errorHandler } from '../utils/error.mjs';

export async function handleTTS(requestBody, apiKey) {
  try {
    const { text, voiceId } = requestBody;
    console.log('TTS: Received request - text:', text ? text.substring(0, 50) + '...' : 'N/A', 'voiceId:', voiceId);

    if (!text || !voiceId) {
      throw new Error('Missing required parameters: text or voiceId');
    }

    const optimizedText = optimizeTextForJson(text); // Use the imported function
    console.log('TTS: Optimized text:', optimizedText ? optimizedText.substring(0, 50) + '...' : 'N/A');

    const model = 'gemini-2.5-flash-preview-tts'; // As per tts.ps1
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    console.log('TTS: Google API URL:', apiUrl);

    const speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voiceId,
        },
      },
    };

    const payload = {
      contents: [
        {
          parts: [
            {
              text: optimizedText,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: speechConfig,
      },
    };

    console.log('TTS: Payload being sent:', JSON.stringify(payload, null, 2));
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    console.log('TTS: Google API response status:', response.status, response.statusText);
    console.log('TTS: Google API response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Generative AI TTS API error: ${response.status} - ${errorData.error.message}`);
    }

    const data = await response.json();
    console.log('TTS: Google API raw data:', JSON.stringify(data, null, 2));
    const audioContentBase64 = data.candidates[0]?.content?.parts[0]?.inlineData?.data;
    const mimeType = data.candidates[0]?.content?.parts[0]?.inlineData?.mimeType;
    console.log('TTS: Extracted audioContentBase64 (first 50 chars):', audioContentBase64 ? audioContentBase64.substring(0, 50) + '...' : 'N/A');
    console.log('TTS: Extracted mimeType:', mimeType);

    if (!audioContentBase64) {
      throw new Error('No audio content received from Google Generative AI TTS API');
    }

    return new Response(JSON.stringify({ audioContentBase64, mimeType }), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    return errorHandler(error);
  }
}