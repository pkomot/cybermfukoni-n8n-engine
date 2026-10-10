// Minimal n8n Code-node runtime for unit tests: injects $input, $(), $runIndex,
// $getWorkflowStaticData, $execution, $env and require, then runs the node body.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function runNode(file, { nodes = {}, input = [], runIndex = 0, staticData = {}, env = {},
  execution = { id: '42', resumeUrl: 'https://n8n.example/webhook-waiting/42' } } = {}) {
  const body = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Referenced node is unexecuted: ${name}`);
    const items = Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]];
    return { first: () => ({ json: items[0] }), all: () => items.map((json) => ({ json })) };
  };
  const $input = { first: () => ({ json: input[0] }), all: () => input.map((json) => ({ json })) };
  const fn = new Function('$input', '$', '$runIndex', '$getWorkflowStaticData', 'require', '$execution', '$env', body);
  return fn($input, $, runIndex, () => staticData, require, execution, env);
}
