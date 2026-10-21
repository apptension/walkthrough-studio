import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStream, ingestAgentEvent, streamLine, streamPayload, tail } from './agentStream.mjs';

const feed = (events) => {
  const s = createStream();
  for (const e of events) ingestAgentEvent(s, e);
  return s;
};

const kinds = (s) => s.entries.map((e) => e.kind);

test('Cursor partial output: deltas merge, the repeated full message does not print twice', () => {
  const s = feed([
    { type: 'system', subtype: 'init', model: 'Auto' },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'prompt' }] } },
    { type: 'thinking', subtype: 'delta', text: 'Reading' },
    { type: 'thinking', subtype: 'delta', text: ' package.json to identify' },
    { type: 'thinking', subtype: 'completed' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading `package.json`.' }] } },
    { type: 'assistant', model_call_id: 'm1', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading `package.json`.' }] } },
    { type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { readToolCall: { args: { path: '/repo/.cursor/skills/product-walkthrough-video/kit/brands/x/brand.json' } } } },
    { type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { readToolCall: { args: {}, result: { success: {} } } } },
    { type: 'thinking', subtype: 'completed' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The package' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ' name is **probe**.' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The package name is **probe**.' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: '…' },
  ]);
  assert.deepEqual(kinds(s), ['system', 'think', 'say', 'tool', 'say']);
  assert.equal(s.entries[1].text, 'Reading package.json to identify');
  assert.equal(s.entries[2].text, 'Reading `package.json`.');
  assert.equal(s.entries[3].title, 'Read');
  assert.equal(s.entries[3].text, 'kit/brands/x/brand.json');
  assert.equal(s.entries[3].ok, true);
  assert.equal(s.entries[4].text, 'The package name is **probe**.');
  assert.ok(s.entries.every((e) => e.done));
});

test('Claude Code partial messages: text, thinking and tool input stream into the same shapes', () => {
  const ev = (event) => ({ type: 'stream_event', event });
  const s = feed([
    { type: 'system', subtype: 'init', model: 'claude-sonnet' },
    ev({ type: 'message_start' }),
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check the ' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'brand first.' } }),
    ev({ type: 'content_block_stop', index: 0 }),
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Opening ' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'the brief.' } }),
    ev({ type: 'content_block_stop', index: 1 }),
    ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'Read', input: {} } }),
    ev({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } }),
    ev({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"/w/brief.json"}' } }),
    ev({ type: 'content_block_stop', index: 2 }),
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Check the brand first.' },
          { type: 'text', text: 'Opening the brief.' },
          { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/w/brief.json' } },
        ],
      },
    },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Done.' },
  ]);
  assert.deepEqual(kinds(s), ['system', 'think', 'say', 'tool']);
  assert.equal(s.entries[1].text, 'Check the brand first.');
  assert.equal(s.entries[2].text, 'Opening the brief.');
  assert.equal(s.entries[3].text, '/w/brief.json');
  assert.equal(s.entries[3].ok, true);
});

test('Claude Code without partials and a failed tool and an error result', () => {
  const s = feed([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Running the plates.' }, { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'node cli.mjs plates x' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: [{ type: 'text', text: 'denied' }] }] } },
    { type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' },
  ]);
  assert.deepEqual(kinds(s), ['say', 'tool', 'error']);
  assert.equal(s.entries[1].ok, false);
  assert.match(s.entries[1].text, /node cli\.mjs plates x\ndenied/);
  assert.equal(s.entries[2].text, 'Invalid API key · Please run /login');
});

test('a reprinted progress line updates in place, a new line does not', () => {
  const s = createStream();
  streamLine(s, '▸ encode · 12% · 0:04');
  streamLine(s, '▸ encode · 57% · 0:19');
  streamLine(s, '✓ plate open done');
  streamLine(s, '✓ plate close done');
  assert.deepEqual(
    s.entries.map((e) => e.text),
    ['▸ encode · 57% · 0:19', '✓ plate open done', '✓ plate close done']
  );
});

test('long text is kept whole, plain lines become entries, payload is plain data', () => {
  const s = createStream();
  const long = 'word '.repeat(600);
  ingestAgentEvent(s, { type: 'assistant', message: { content: [{ type: 'text', text: long }] } });
  streamLine(s, '\x1b[32m▸ plates · 3 of 9\x1b[0m');
  assert.equal(s.entries[0].text.length, long.length);
  assert.equal(s.entries[1].text, '▸ plates · 3 of 9');
  const wire = JSON.parse(JSON.stringify(streamPayload(s)));
  assert.equal(wire.entries.length, 2);
  assert.ok(wire.rev > 0);
  assert.ok(tail(long).length <= 222);
});
