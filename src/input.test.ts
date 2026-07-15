import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput, parseRepositoryIdentifier, parseUserIdentifier } from './input.js';

test('normalizes GitHub URLs, strips .git, and deduplicates case-insensitively', () => {
    const input = normalizeInput({
        repos: ['https://github.com/OpenAI/openai-node.git?tab=readme', 'openai/OPENAI-node'],
        users: ['@Torvalds', 'https://github.com/torvalds/'],
        searchQueries: [' topic:typescript  stars:>100 ', 'TOPIC:TYPESCRIPT STARS:>100'],
    });
    assert.deepEqual(input.repos, ['OpenAI/openai-node']);
    assert.deepEqual(input.users, ['Torvalds']);
    assert.deepEqual(input.searchQueries, ['topic:typescript stars:>100']);
    assert.equal(input.maxResults, 1);
});

test('accepts only exact repository and profile paths', () => {
    assert.equal(parseRepositoryIdentifier('https://github.com/facebook/react/issues'), null);
    assert.equal(parseRepositoryIdentifier('https://example.com/facebook/react'), null);
    assert.equal(parseUserIdentifier('https://github.com/openai/openai-node'), null);
    assert.equal(parseUserIdentifier('bad user'), null);
});

test('rejects malformed entries instead of silently dropping them', () => {
    assert.throws(
        () => normalizeInput({ repos: ['openai/openai-node', 'not-a-repository'] }),
        /Invalid repository input/,
    );
});

test('rejects empty work and unsafe limits', () => {
    assert.throws(() => normalizeInput({ repos: [], users: [], searchQueries: [] }), /Provide at least one/);
    assert.throws(() => normalizeInput({ repos: ['openai/openai-node'], maxResults: 0 }), /maxResults/);
    assert.throws(
        () => normalizeInput({ repos: ['openai/openai-node'], searchQueries: Array.from({ length: 21 }, (_, i) => `q${i}`) }),
        /at most 20/,
    );
});
