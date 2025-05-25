# Gemini API Schema Compatibility Improvement Plan

## Research Summary - UPDATED APPROACH

**IMPORTANT DISCOVERY**: Gemini 2.5 models support **native JSON Schema** via the `responseJsonSchema` field, which is much more comprehensive than the OpenAPI 3.0 subset used by `responseSchema`.

Since this project uses Gemini 2.5 models, we should leverage the native JSON Schema support instead of trying to transform schemas to fit OpenAPI 3.0 limitations.

## Current Problem

The error occurs because we're using `responseSchema` (OpenAPI 3.0 subset) instead of `responseJsonSchema` (full JSON Schema support) for Gemini 2.5 models.

## Gemini 2.5 JSON Schema Support

According to the official documentation, Gemini 2.5 supports **full JSON Schema** via `responseJsonSchema` with these limitations:
- Only works with Gemini 2.5 models
- While all JSON Schema properties can be passed, not all are supported
- Recursive references can only be used as non-required object properties
- Recursive references are unrolled to finite degree
- Schemas with `$ref` cannot contain other properties except those starting with `$`

## Supported JSON Schema Properties (Gemini 2.5)

With `responseJsonSchema`, Gemini 2.5 supports:

### JSON Schema Draft 7+ Properties ✅ **SUPPORTED**
- `$schema` - Schema version identifier
- `$id` - Schema identifier
- `$ref` - Schema references (with limitations)
- `type` - Data types
- `format` - Data format specification
- `description` - Property descriptions
- `title` - Schema titles
- `default` - Default values
- `examples` - Example values
- `const` - Constant values
- `enum` - Enumerated values

### Numeric Validation ✅ **SUPPORTED**
- `minimum` - Minimum value
- `maximum` - Maximum value
- `exclusiveMinimum` - Exclusive minimum ✅ **NOW SUPPORTED**
- `exclusiveMaximum` - Exclusive maximum ✅ **NOW SUPPORTED**
- `multipleOf` - Multiple of constraint

### String Validation ✅ **SUPPORTED**
- `minLength` - Minimum string length
- `maxLength` - Maximum string length
- `pattern` - Regex pattern validation

### Array Validation ✅ **SUPPORTED**
- `items` - Array item schema
- `minItems` - Minimum array length
- `maxItems` - Maximum array length
- `uniqueItems` - Unique items constraint

### Object Validation ✅ **SUPPORTED**
- `properties` - Object properties
- `required` - Required properties
- `additionalProperties` - Additional properties handling
- `minProperties` - Minimum properties count
- `maxProperties` - Maximum properties count

### Composition Keywords ✅ **SUPPORTED**
- `allOf` - Must match all schemas
- `anyOf` - Must match any schema
- `oneOf` - Must match exactly one schema
- `not` - Must not match schema

### Conditional Keywords ✅ **SUPPORTED**
- `if` - Conditional schema
- `then` - Schema if condition is true
- `else` - Schema if condition is false

## New Implementation Strategy

Instead of transforming schemas, we should:

### 1. Use `responseJsonSchema` for Gemini 2.5 Models
```javascript
// Current approach (limited OpenAPI 3.0 subset)
const config = {
  response_mime_type: "application/json",
  response_schema: openApiSchema  // Limited support
}

// New approach (full JSON Schema support)
const config = {
  response_mime_type: "application/json",
  response_json_schema: jsonSchema  // Full JSON Schema support
}
```

### 2. Model Detection and Schema Routing
```javascript
// Detect model version and use appropriate schema field
function getSchemaConfig(model, schema) {
  if (model.includes('gemini-2.5')) {
    return {
      response_mime_type: "application/json",
      response_json_schema: schema  // Use native JSON Schema
    }
  } else {
    return {
      response_mime_type: "application/json",
      response_schema: adjustSchemaForOpenAPI(schema)  // Transform for older models
    }
  }
}
```

### 3. Preserve Original Schemas
```javascript
// No more transformation needed for Gemini 2.5!
// Original schema with exclusiveMinimum, $schema, etc. works directly

const originalSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "age": {
      "type": "integer",
      "exclusiveMinimum": 0,  // ✅ Now supported!
      "exclusiveMaximum": 150  // ✅ Now supported!
    },
    "status": {
      "const": "active"  // ✅ Now supported!
    }
  },
  "allOf": [  // ✅ Now supported!
    {"required": ["age"]},
    {"required": ["status"]}
  ]
}

// Can be used directly with Gemini 2.5!
```

## Implementation Plan

### Phase 1: Add Native JSON Schema Support
1. **Update request transformation logic**:
   - Detect Gemini 2.5 models in request
   - Use `responseJsonSchema` instead of `responseSchema` for Gemini 2.5
   - Keep existing `adjustProps` as fallback for older models

2. **Add model detection utility**:
   - `isGemini25Model()` - Check if model supports native JSON Schema
   - `getSchemaField()` - Return appropriate schema field name
   - `shouldUseJsonSchema()` - Determine which schema format to use

### Phase 2: Update Transformation Logic
1. **Modify `transformConfig()` function**:
   - Add model detection
   - Route to appropriate schema field
   - Preserve original schemas for Gemini 2.5

2. **Update `adjustSchema()` function**:
   - Skip adjustment for Gemini 2.5 models using `responseJsonSchema`
   - Keep existing logic for older models using `responseSchema`

### Phase 3: Comprehensive Testing
1. **Test with Gemini 2.5 models**:
   - Verify `exclusiveMinimum`/`exclusiveMaximum` work
   - Test complex schemas with `allOf`, `anyOf`, `oneOf`
   - Validate conditional schemas with `if`/`then`/`else`

2. **Test backward compatibility**:
   - Ensure older Gemini models still work
   - Verify transformation logic still applies correctly
   - Test mixed model usage scenarios

### Phase 4: Documentation and Monitoring
1. **Update documentation**:
   - Document native JSON Schema support
   - Explain model detection logic
   - Provide migration examples

2. **Add logging and monitoring**:
   - Log which schema format is used
   - Track success rates by model version
   - Monitor for schema validation errors

## Benefits of This Approach

1. **Native Support**: Uses Gemini 2.5's full JSON Schema capabilities
2. **No Data Loss**: Preserves all original schema properties
3. **Backward Compatible**: Maintains support for older Gemini models
4. **Future-Proof**: Ready for new Gemini models with enhanced schema support
5. **Simplified Logic**: Eliminates complex transformation rules for Gemini 2.5

## Files to Modify

1. **`src/utils/helpers.mjs`**:
   - Add `isGemini25Model()` function
   - Update `adjustSchema()` to skip adjustment for Gemini 2.5
   - Keep existing `adjustProps` for backward compatibility

2. **`src/transformers/config.mjs`** (or relevant transformer):
   - Update `transformConfig()` to detect model version
   - Use `responseJsonSchema` for Gemini 2.5 models
   - Use `responseSchema` for older models

3. **`test/utils/helpers.test.mjs`**:
   - Add tests for model detection functions
   - Test Gemini 2.5 schema handling
   - Test backward compatibility with older models

4. **`docs/gemini-schema-compatibility.md`**:
   - Update with native JSON Schema approach
   - Document model detection logic
   - Add examples of Gemini 2.5 vs older model handling

## API Endpoint Changes Required

The current code likely uses:
```javascript
// Current (OpenAPI 3.0 subset)
generationConfig: {
  responseMimeType: "application/json",
  responseSchema: schema
}
```

For Gemini 2.5, we need:
```javascript
// New (Full JSON Schema)
generationConfig: {
  responseMimeType: "application/json",
  responseJsonSchema: schema  // Note: different field name
}
```

## Next Steps

1. **Identify current schema usage** in the codebase
2. **Implement model detection** logic
3. **Update request transformation** to use appropriate schema field
4. **Test with real Gemini 2.5 API calls** to verify native JSON Schema support
5. **Update documentation** with new approach

## Expected Results

After implementation:
- ✅ `exclusiveMinimum`/`exclusiveMaximum` work natively with Gemini 2.5
- ✅ `$schema`, `allOf`, `anyOf`, `oneOf` work without transformation
- ✅ Complex conditional schemas work with `if`/`then`/`else`
- ✅ Backward compatibility maintained for older Gemini models
- ✅ No more schema property removal or complex transformations needed
