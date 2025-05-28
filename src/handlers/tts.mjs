export async function optimizeTextForJson(text) {
  let optimizedText = text;

  // MODIFICATION: Preserve Unicode dashes and quotes by commenting out replacements.
  // These characters are valid in JSON strings and we want to see if Google TTS handles them better.
  // optimizedText = optimizedText.replace(/\u2013/g, '-'); // en dash
  // optimizedText = optimizedText.replace(/\u2014/g, '--'); // em dash
  // optimizedText = optimizedText.replace(/\u2018/g, "'"); // left single quote
  // optimizedText = optimizedText.replace(/\u2019/g, "'"); // right single quote
  // optimizedText = optimizedText.replace(/\u201C/g, '"'); // left double quote
  // optimizedText = optimizedText.replace(/\u201D/g, '"'); // right double quote

  // Remove invisible control characters, excluding newlines, carriage returns, and tabs.
  // The regex [^\P{C}\n\r\t] from PowerShell needs to be adapted for JavaScript.
  // \p{C} matches invisible control characters. \P{C} matches anything that is NOT an invisible control character.
  // So, [^\P{C}\n\r\t] means "any character that is NOT (not a control character OR newline OR carriage return OR tab)".
  // This simplifies to "any control character that is NOT newline, carriage return, or tab".
  optimizedText = optimizedText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

  // Replace (e.g., with (e.g. to avoid pronunciation issues with TTS
  optimizedText = optimizedText.replace(/\(e\.g\.,/g, '(e.g.');

  // Normalize line endings from \r\n to \n
  // JSON.stringify will handle escaping \n to \\n, so this is fine.
  optimizedText = optimizedText.replace(/\r\n/g, '\n');

  // Trim leading and trailing whitespace
  optimizedText = optimizedText.trim();

  return optimizedText;
}


import { errorHandler } from '../utils/error.mjs';

export async function handleTTS(requestBody, apiKey) {
  try {
    const { text, voiceId } = requestBody;
    console.log('TTS: Received request - text:', text ? text.substring(0, 50) + '...' : 'N/A', 'voiceId:', voiceId);

    if (!text || !voiceId) {
      throw new Error('Missing required parameters: text or voiceId');
    }

    const optimizedText = await optimizeTextForJson(text);
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