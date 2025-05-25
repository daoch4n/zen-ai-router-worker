import { Miniflare } from 'miniflare';
import { jest } from '@jest/globals';

describe('ConversationStateDO', () => {
  let mf;
  let doId;
  let doStub;

  beforeEach(async () => {
    mf = new Miniflare({
      // We don't need to specify `script` if we're only testing Durable Objects
      // and binding them directly.
      durableObjects: {
        ConversationStateDO: 'ConversationStateDO',
      },
      modules: true,
      scriptPath: 'src/durableObject.mjs',
    });

    doId = mf.newDurableObjectIdentifier('test-do');
    doStub = mf.getDurableObjectStub(doId);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  test('should store a tool mapping', async () => {
    const toolUseId = 'tool_use_123';
    const toolName = 'my_tool';

    const response = await doStub.fetch('http://test-do/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_use_id: toolUseId, tool_name: toolName }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Mapping stored successfully');
  });

  test('should retrieve a tool mapping', async () => {
    const toolUseId = 'tool_use_456';
    const toolName = 'another_tool';

    await doStub.fetch('http://test-do/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_use_id: toolUseId, tool_name: toolName }),
    });

    const response = await doStub.fetch(`http://test-do/retrieve?tool_use_id=${toolUseId}`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ tool_use_id: toolUseId, tool_name: toolName });
  });

  test('should return 404 if mapping not found', async () => {
    const response = await doStub.fetch('http://test-do/retrieve?tool_use_id=non_existent_id');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Mapping not found');
  });

  test('should delete a tool mapping', async () => {
    const toolUseId = 'tool_use_789';
    const toolName = 'tool_to_delete';

    await doStub.fetch('http://test-do/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_use_id: toolUseId, tool_name: toolName }),
    });

    const deleteResponse = await doStub.fetch(`http://test-do/delete_mapping?tool_use_id=${toolUseId}`, {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.text()).toBe('Mapping deleted successfully');

    const retrieveResponse = await doStub.fetch(`http://test-do/retrieve?tool_use_id=${toolUseId}`);
    expect(retrieveResponse.status).toBe(404);
  });

  test('should clear all conversation state', async () => {
    await doStub.fetch('http://test-do/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_use_id: 'id1', tool_name: 'name1' }),
    });
    await doStub.fetch('http://test-do/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_use_id: 'id2', tool_name: 'name2' }),
    });

    const clearResponse = await doStub.fetch('http://test-do/clear_conversation_state', {
      method: 'POST',
    });
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.text()).toBe('Conversation state cleared successfully');

    const retrieveResponse1 = await doStub.fetch('http://test-do/retrieve?tool_use_id=id1');
    expect(retrieveResponse1.status).toBe(404);
    const retrieveResponse2 = await doStub.fetch('http://test-do/retrieve?tool_use_id=id2');
    expect(retrieveResponse2.status).toBe(404);
  });
});