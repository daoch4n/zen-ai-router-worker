/**
 * Request transformation functions
 */
import { HttpError } from '../utils/error.mjs';
import { adjustSchema, parseImg, getBudgetFromLevel } from '../utils/helpers.mjs';
import { FIELDS_MAP, SAFETY_SETTINGS, REASONING_EFFORT_MAP, THINKING_MODES } from '../constants/index.mjs';

/**
 * Transforms OpenAI-style configuration to Gemini format
 * @param {Object} req - The request object
 * @param {Object} thinkingConfig - Optional thinking configuration
 * @returns {Object} - Transformed configuration
 */
export const transformConfig = (req, thinkingConfig = null) => {
  let cfg = {};
  for (let key in req) {
    const matchedKey = FIELDS_MAP[key];
    if (matchedKey) {
      // Handle reasoning_effort specially - convert to thinking budget
      if (key === "reasoning_effort") {
        const budget = getBudgetFromLevel(req[key]);
        if (budget > 0) {
          cfg.thinkingConfig = cfg.thinkingConfig || {};
          cfg.thinkingConfig.thinkingBudget = budget;
        }
      } else {
        cfg[matchedKey] = req[key];
      }
    }
  }

  // Apply thinking configuration from model name parsing if provided
  if (thinkingConfig) {
    cfg.thinkingConfig = cfg.thinkingConfig || {};
    Object.assign(cfg.thinkingConfig, thinkingConfig);
  }

  if (req.response_format) {
    switch (req.response_format.type) {
      case "json_schema":
        adjustSchema(req.response_format);
        cfg.responseSchema = req.response_format.json_schema?.schema;
        if (cfg.responseSchema && "enum" in cfg.responseSchema) {
          cfg.responseMimeType = "text/x.enum";
          break;
        }
        // eslint-disable-next-line no-fallthrough
      case "json_object":
        cfg.responseMimeType = "application/json";
        break;
      case "text":
        cfg.responseMimeType = "text/plain";
        break;
      default:
        throw new HttpError("Unsupported response_format.type", 400);
    }
  }
  return cfg;
};

/**
 * Transforms a message content
 * @param {Object} content - The message content
 * @returns {Promise<Array>} - Transformed content parts
 */
export const transformMsg = async ({ content }) => {
  const parts = [];
  if (!Array.isArray(content)) {
    // system, user: string
    // assistant: string or null (Required unless tool_calls is specified.)
    parts.push({ text: content });
    return parts;
  }
  // user:
  // An array of content parts with a defined type.
  // Supported options differ based on the model being used to generate the response.
  // Can contain text, image, or audio inputs.
  for (const item of content) {
    switch (item.type) {
      case "text":
        parts.push({ text: item.text });
        break;
      case "image_url":
        parts.push(await parseImg(item.image_url.url));
        break;
      case "input_audio":
        parts.push({
          inlineData: {
            mimeType: "audio/" + item.input_audio.format,
            data: item.input_audio.data,
          }
        });
        break;
      default:
        throw new HttpError(`Unknown "content" item type: "${item.type}"`, 400);
    }
  }
  if (content.every(item => item.type === "image_url")) {
    parts.push({ text: "" }); // to avoid "Unable to submit request because it must have a text parameter"
  }
  return parts;
};

/**
 * Transforms function response
 * @param {Object} item - The function response item
 * @param {Object} parts - The parts object
 */
export const transformFnResponse = ({ content, tool_call_id }, parts) => {
  if (!parts.calls) {
    throw new HttpError("No function calls found in the previous message", 400);
  }
  let response;
  try {
    response = JSON.parse(content);
  } catch (err) {
    console.error("Error parsing function response content:", err);
    throw new HttpError("Invalid function response: " + content, 400);
  }
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    response = { result: response };
  }
  if (!tool_call_id) {
    throw new HttpError("tool_call_id not specified", 400);
  }
  const { i, name } = parts.calls[tool_call_id] ?? {};
  if (!name) {
    throw new HttpError("Unknown tool_call_id: " + tool_call_id, 400);
  }
  if (parts[i]) {
    throw new HttpError("Duplicated tool_call_id: " + tool_call_id, 400);
  }
  parts[i] = {
    functionResponse: {
      id: tool_call_id.startsWith("call_") ? null : tool_call_id,
      name,
      response,
    }
  };
};

/**
 * Transforms function calls
 * @param {Object} tool_calls - The tool calls object
 * @returns {Array} - Transformed function calls
 */
export const transformFnCalls = ({ tool_calls }) => {
  const calls = {};
  const parts = tool_calls.map(({ function: { arguments: argstr, name }, id, type }, i) => {
    if (type !== "function") {
      throw new HttpError(`Unsupported tool_call type: "${type}"`, 400);
    }
    let args;
    try {
      args = JSON.parse(argstr);
    } catch (err) {
      console.error("Error parsing function arguments:", err);
      throw new HttpError("Invalid function arguments: " + argstr, 400);
    }
    calls[id] = {i, name};
    return {
      functionCall: {
        id: id.startsWith("call_") ? null : id,
        name,
        args,
      }
    };
  });
  parts.calls = calls;
  return parts;
};

/**
 * Transforms messages
 * @param {Array} messages - The messages array
 * @returns {Promise<Object>} - Transformed messages
 */
export const transformMessages = async (messages) => {
  if (!messages) { return; }
  const contents = [];
  let system_instruction;
  for (const item of messages) {
    switch (item.role) {
      case "system":
        system_instruction = { parts: await transformMsg(item) };
        continue;
      case "tool":
        // eslint-disable-next-line no-case-declarations
        let { role, parts } = contents[contents.length - 1] ?? {};
        if (role !== "function") {
          const calls = parts?.calls;
          parts = []; parts.calls = calls;
          contents.push({
            role: "function", // ignored
            parts
          });
        }
        transformFnResponse(item, parts);
        continue;
      case "assistant":
        item.role = "model";
        break;
      case "user":
        break;
      default:
        throw new HttpError(`Unknown message role: "${item.role}"`, 400);
    }
    contents.push({
      role: item.role,
      parts: item.tool_calls ? transformFnCalls(item) : await transformMsg(item)
    });
  }
  if (system_instruction) {
    if (!contents[0]?.parts.some(part => part.text)) {
      contents.unshift({ role: "user", parts: { text: " " } });
    }
  }
  return { system_instruction, contents };
};

/**
 * Transforms tools
 * @param {Object} req - The request object
 * @returns {Object} - Transformed tools
 */
export const transformTools = (req) => {
  let tools, tool_config;
  if (req.tools) {
    const funcs = req.tools.filter(tool => tool.type === "function");
    funcs.forEach(adjustSchema);
    tools = [{ function_declarations: funcs.map(schema => schema.function) }];
  }
  if (req.tool_choice) {
    const allowed_function_names = req.tool_choice?.type === "function" ? [ req.tool_choice?.function?.name ] : undefined;
    if (allowed_function_names || typeof req.tool_choice === "string") {
      tool_config = {
        function_calling_config: {
          mode: allowed_function_names ? "ANY" : req.tool_choice.toUpperCase(),
          allowed_function_names
        }
      };
    }
  }
  return { tools, tool_config };
};

/**
 * Main request transformation function
 * @param {Object} req - The request object
 * @param {Object} thinkingConfig - Optional thinking configuration
 * @returns {Promise<Object>} - Transformed request
 */
export const transformRequest = async (req, thinkingConfig = null) => ({
  ...await transformMessages(req.messages),
  safetySettings: SAFETY_SETTINGS,
  generationConfig: transformConfig(req, thinkingConfig),
  ...transformTools(req),
});
