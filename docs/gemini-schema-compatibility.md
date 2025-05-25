# Gemini API JSON Schema Compatibility

This document explains the JSON schema compatibility fixes implemented to resolve errors when using OpenAI-style JSON schemas with the Gemini API.

## Problem

The Gemini API has more restrictive JSON schema support compared to OpenAI's API. When using certain JSON Schema Draft 7+ properties, the Gemini API returns validation errors like:

```
Invalid JSON payload received. Unknown name "exclusiveMinimum" at 'tools[0].function_declarations[0].parameters.properties[0].value': Cannot find field.
Invalid JSON payload received. Unknown name "$schema" at 'tools[0].function_declarations[0].parameters': Cannot find field.
```

## Solution

The `adjustProps` and `adjustSchema` functions in `src/utils/helpers.mjs` automatically remove or transform unsupported JSON schema properties to ensure compatibility with the Gemini API.

## Unsupported Properties

The following JSON Schema properties are automatically removed:

### JSON Schema Draft 7+ Metadata
- `$schema` - Schema version identifier
- `$id` - Schema identifier
- `$ref` - Schema reference
- `$comment` - Schema comments

### Numeric Validation Keywords
- `exclusiveMinimum` - Exclusive minimum value constraint
- `exclusiveMaximum` - Exclusive maximum value constraint

### Complex Composition Keywords
- `allOf` - Schema must match all sub-schemas
- `anyOf` - Schema must match any sub-schema
- `oneOf` - Schema must match exactly one sub-schema
- `not` - Schema must not match the sub-schema

### Conditional Schema Keywords
- `if` - Conditional schema application
- `then` - Schema to apply if condition is true
- `else` - Schema to apply if condition is false

### Content Validation
- `contentEncoding` - Content encoding specification
- `contentMediaType` - Content media type specification
- `contentSchema` - Content schema specification

### Additional Draft 7+ Keywords
- `readOnly` - Property is read-only
- `writeOnly` - Property is write-only
- `examples` - Example values

## Property Transformations

### `const` to `enum`
The `const` keyword is transformed to `enum` with a single value:

```javascript
// Before
{
  "type": "string",
  "const": "fixed-value"
}

// After
{
  "type": "string",
  "enum": ["fixed-value"]
}
```

### `additionalProperties: false`
This property is removed for object schemas:

```javascript
// Before
{
  "type": "object",
  "properties": {
    "name": { "type": "string" }
  },
  "additionalProperties": false
}

// After
{
  "type": "object",
  "properties": {
    "name": { "type": "string" }
  }
}
```

## Usage

The schema adjustment happens automatically when:

1. **Tool schemas** are processed in `transformTools()` function
2. **Response format schemas** are processed in `transformConfig()` function
3. **Any OpenAI schema** is passed through `adjustSchema()` function

No manual intervention is required - the compatibility fixes are applied transparently.

## Best Practices

To ensure optimal compatibility with Gemini API:

1. **Use simple schemas** - Avoid complex composition keywords when possible
2. **Use `enum` instead of `const`** - For fixed values, prefer enum arrays
3. **Avoid Draft 7+ features** - Stick to basic JSON Schema features
4. **Test thoroughly** - Verify your schemas work with both OpenAI and Gemini APIs

## Example

Here's an example of a schema before and after adjustment:

### Before Adjustment
```javascript
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "strict": true,
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "exclusiveMinimum": 0
        },
        "units": {
          "const": "celsius"
        }
      },
      "additionalProperties": false,
      "required": ["location"]
    }
  }
}
```

### After Adjustment
```javascript
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string"
        },
        "units": {
          "enum": ["celsius"]
        }
      },
      "required": ["location"]
    }
  }
}
```

## Testing

Comprehensive tests are available in `test/utils/helpers.test.mjs` that verify:

- All unsupported properties are removed
- Property transformations work correctly
- Nested objects and arrays are processed recursively
- Edge cases are handled safely
- Valid properties are preserved

Run tests with:
```bash
npm test -- test/utils/helpers.test.mjs
```
