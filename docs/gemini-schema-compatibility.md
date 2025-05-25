# Gemini API JSON Schema Compatibility

This document explains the JSON Schema compatibility limitations and transformations applied for Gemini API.

## Schema Compatibility Overview

**IMPORTANT**: The Gemini API has limited JSON Schema support and requires transformation of OpenAI schemas to remove unsupported properties.

## Unsupported Properties

The following JSON Schema properties are **NOT supported** by Gemini API and are automatically removed:

- `$schema` - Schema version identifier ❌
- `$id` - Schema identifier ❌
- `exclusiveMinimum`/`exclusiveMaximum` - Exclusive numeric constraints ❌
- `allOf`/`anyOf`/`oneOf` - Schema composition ❌
- `if`/`then`/`else` - Conditional schemas ❌
- `const` - Constant values (transformed to `enum`) ❌
- `additionalProperties: false` - Strict object validation ❌
- Various other Draft 7+ properties ❌

## Implementation

The transformation logic applies schema adjustments to ensure compatibility:
- Tool function declarations are cleaned using `adjustSchema()`
- Response format schemas use `responseJsonSchema` field
- Unsupported properties are automatically removed

## Usage

Schema transformations are applied automatically when:

1. **Tool function declarations** are processed in `transformTools()` using `adjustSchema()`
2. **Response format schemas** are processed in `transformConfig()` using `responseJsonSchema`
3. **OpenAI schemas** are cleaned to remove unsupported properties

No manual intervention is required - compatibility transformations are applied transparently.

## Benefits

1. **API Compatibility**: Ensures requests work with Gemini API limitations
2. **Automatic Transformation**: Unsupported properties are removed automatically
3. **Error Prevention**: Prevents API errors from unsupported schema features
4. **Simplified Usage**: Developers can use OpenAI-style schemas without worrying about compatibility

## Best Practices

When working with schemas for Gemini API:

1. **Avoid unsupported features** - Use basic JSON Schema properties when possible
2. **Use `enum` instead of `const`** - `const` is automatically converted to `enum`
3. **Avoid complex composition** - `allOf`, `anyOf`, `oneOf` are not supported
4. **Use basic validation** - Stick to `minimum`/`maximum` instead of exclusive variants
5. **Don't rely on `additionalProperties: false`** - This constraint is removed

## Example

Here's an example showing schema transformation for Gemini API compatibility:

### OpenAI Schema (Input)
```javascript
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "strict": true,  // ❌ Removed
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",  // ❌ Removed
      "type": "object",
      "properties": {
        "temperature": {
          "type": "number",
          "exclusiveMinimum": -273.15,  // ❌ Removed
          "exclusiveMaximum": 1000      // ❌ Removed
        },
        "units": {
          "const": "celsius"            // ❌ Transformed to enum
        },
        "conditions": {
          "anyOf": [                    // ❌ Removed
            { "const": "sunny" },
            { "const": "cloudy" },
            { "const": "rainy" }
          ]
        }
      },
      "additionalProperties": false,    // ❌ Removed
      "required": ["temperature"]
    }
  }
}
```

### Result (Gemini-Compatible)
```javascript
{
  "type": "function",
  "function": {
    "name": "get_weather",
    // strict property removed
    "parameters": {
      // $schema removed
      "type": "object",
      "properties": {
        "temperature": {
          "type": "number"
          // exclusiveMinimum/exclusiveMaximum removed
        },
        "units": {
          "enum": ["celsius"]           // const converted to enum
        }
        // conditions with anyOf removed entirely
      },
      // additionalProperties removed
      "required": ["temperature"]
    }
  }
}
```

## Testing

Comprehensive tests are available in `test/transformers/request.test.mjs` that verify:

- Unsupported JSON Schema properties are removed from tool schemas
- `responseJsonSchema` is used for response format schemas
- Tool function declarations are properly cleaned using `adjustSchema()`
- `strict` property is removed from function schemas
- `const` values are converted to `enum` arrays
- `additionalProperties: false` is removed

Run tests with:
```bash
npm test -- test/transformers/request.test.mjs
```
