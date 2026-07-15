import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitHubClient, GitHubApiError } from './github-client.js';

test('returns a distinct not_found outcome without retrying 404', async () => {
    let calls = 0;
    const client = createGitHubClient({
        fetchImpl: async () => {
            calls += 1;
            return new Response('{"message":"Not Found"}', { status: 404 });
        },
        maxAttempts: 3,
    });
    assert.deepEqual(await client.get('/repos/missing/repo'), { outcome: 'not_found' });
    assert.equal(calls, 1);
});

test('does not misclassify an ordinary 403 as a rate limit', async () => {
    let calls = 0;
    const client = createGitHubClient({
        fetchImpl: async () => {
            calls += 1;
            return new Response('{"message":"Resource not accessible"}', { status: 403 });
        },
        maxAttempts: 3,
    });
    await assert.rejects(client.get('/repos/org/repo'), (error: unknown) => {
        assert.ok(error instanceof GitHubApiError);
        assert.equal(error.kind, 'forbidden');
        return true;
    });
    assert.equal(calls, 1);
});

test('honors X-RateLimit-Reset before retrying a real rate limit', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = createGitHubClient({
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) {
                return new Response('{"message":"API rate limit exceeded"}', {
                    status: 403,
                    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' },
                });
            }
            return new Response('{"id":1}', { status: 200 });
        },
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        now: () => 0,
        maxAttempts: 2,
    });
    assert.deepEqual(await client.get('/repos/openai/openai-node'), { outcome: 'ok', data: { id: 1 } });
    assert.deepEqual(sleeps, [1_250]);
});

test('fails fast for an invalid token', async () => {
    let calls = 0;
    const client = createGitHubClient({
        token: 'secret-token',
        fetchImpl: async () => {
            calls += 1;
            return new Response('{"message":"Bad credentials"}', { status: 401 });
        },
        maxAttempts: 3,
    });
    await assert.rejects(client.get('/user'), /rejected the token/);
    assert.equal(calls, 1);
});

test('retries transient upstream errors and rejects invalid successful JSON', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = createGitHubClient({
        fetchImpl: async () => {
            calls += 1;
            return calls === 1
                ? new Response('temporary', { status: 503 })
                : new Response('{"ok":true}', { status: 200 });
        },
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        maxAttempts: 2,
    });
    assert.deepEqual(await client.get('/rate_limit'), { outcome: 'ok', data: { ok: true } });
    assert.deepEqual(sleeps, [500]);

    const invalid = createGitHubClient({ fetchImpl: async () => new Response('<html>', { status: 200 }) });
    await assert.rejects(invalid.get('/rate_limit'), /invalid JSON/);
});

test('redacts proxy-style credentials from network errors', async () => {
    const client = createGitHubClient({
        fetchImpl: async () => { throw new Error('connect failed via http://alice:secret@proxy.example:8000'); },
        maxAttempts: 1,
    });
    await assert.rejects(client.get('/rate_limit'), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /alice|secret/);
        assert.match(error.message, /\[redacted\]/);
        return true;
    });
});
