import assert from 'node:assert/strict';
import test from 'node:test';
import type { GitHubApi } from './github-client.js';
import { normalizeInput } from './input.js';
import { scrapeGitHub } from './scraper.js';
import type { ChargeResult, GitHubRecord, GitHubRunStatus } from './types.js';

const logger = { info: () => undefined, warning: () => undefined };
const repo = (fullName: string, id: number) => ({
    id,
    full_name: fullName,
    name: fullName.split('/')[1],
    owner: { login: fullName.split('/')[0] },
    html_url: `https://github.com/${fullName}`,
    stargazers_count: 10,
    forks_count: 2,
    subscribers_count: 1,
    open_issues_count: 0,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
});

test('deduplicates explicit and searched repositories before billing', async () => {
    const paths: string[] = [];
    const saved: GitHubRecord[] = [];
    const statuses: GitHubRunStatus[] = [];
    const client: GitHubApi = {
        async get(path) {
            paths.push(path);
            if (path.includes('/search/repositories')) {
                return paths.filter((value) => value.includes('/search/repositories')).length === 1
                    ? { outcome: 'ok', data: { items: [{ full_name: 'OPENAI/openai-node' }, { full_name: 'facebook/react' }], incomplete_results: false } }
                    : { outcome: 'ok', data: { items: [], incomplete_results: false } };
            }
            if (path.includes('openai/openai-node')) return { outcome: 'ok', data: repo('openai/openai-node', 1) };
            if (path.includes('facebook/react')) return { outcome: 'ok', data: repo('facebook/react', 2) };
            throw new Error(`Unexpected path ${path}`);
        },
    };
    const result = await scrapeGitHub(normalizeInput({
        repos: ['openai/openai-node'],
        searchQueries: ['topic:javascript'],
        maxResults: 3,
    }), {
        client,
        pushData: async (record) => { saved.push(record); return { chargedCount: 1, eventChargeLimitReached: false }; },
        updateStatus: async (status) => { statuses.push(status); },
        log: logger,
    });
    assert.equal(result.status.status, 'succeeded');
    assert.equal(result.status.recordsSaved, 2);
    assert.equal(result.status.duplicateTargetsSkipped, 1);
    assert.deepEqual(saved.map((item) => item.entityType === 'repo' ? item.fullName : item.login), ['openai/openai-node', 'facebook/react']);
    assert.equal(statuses.at(-1)?.status, 'succeeded');
});

test('treats confirmed 404 targets as a valid empty outcome', async () => {
    const result = await scrapeGitHub(normalizeInput({ repos: ['missing/repository'] }), {
        client: { get: async () => ({ outcome: 'not_found' }) },
        pushData: async () => { throw new Error('must not bill'); },
        updateStatus: async () => undefined,
        log: logger,
    });
    assert.equal(result.status.status, 'empty');
    assert.equal(result.status.notFound, 1);
    assert.equal(result.status.recordsSaved, 0);
});

test('stops cleanly when the event charge limit is reached', async () => {
    const charge: ChargeResult = { chargedCount: 0, eventChargeLimitReached: true };
    const result = await scrapeGitHub(normalizeInput({ repos: ['openai/openai-node'] }), {
        client: { get: async () => ({ outcome: 'ok', data: repo('openai/openai-node', 1) }) },
        pushData: async () => charge,
        updateStatus: async () => undefined,
        log: logger,
    });
    assert.equal(result.status.status, 'stopped_spending_limit');
    assert.equal(result.status.recordsSaved, 0);
    assert.equal(result.spendingLimitReached, true);
});

test('fails honestly on malformed optional nested data and records diagnostics', async () => {
    const statuses: GitHubRunStatus[] = [];
    const client: GitHubApi = {
        async get(path) {
            if (path.includes('/issues?')) return { outcome: 'ok', data: { not: 'an array' } };
            return { outcome: 'ok', data: repo('openai/openai-node', 1) };
        },
    };
    await assert.rejects(
        scrapeGitHub(normalizeInput({ repos: ['openai/openai-node'], includeIssues: true, maxIssuesPerRepo: 1 }), {
            client,
            pushData: async () => { throw new Error('must not bill'); },
            updateStatus: async (status) => { statuses.push(status); },
            log: logger,
        }),
        /malformed issues/,
    );
    assert.equal(statuses.at(-1)?.status, 'failed');
    assert.equal(statuses.at(-1)?.recordsSaved, 0);
});

test('saves a validated user record with optional repositories', async () => {
    const saved: GitHubRecord[] = [];
    const client: GitHubApi = {
        async get(path) {
            if (path.includes('/repos?')) return { outcome: 'ok', data: [repo('torvalds/linux', 2)] };
            return {
                outcome: 'ok',
                data: {
                    id: 1,
                    login: 'torvalds',
                    type: 'User',
                    html_url: 'https://github.com/torvalds',
                    followers: 100,
                    created_at: '2008-01-01T00:00:00Z',
                    updated_at: '2026-01-01T00:00:00Z',
                },
            };
        },
    };
    const result = await scrapeGitHub(normalizeInput({
        users: ['torvalds'],
        includeUserRepos: true,
        maxReposPerUser: 1,
    }), {
        client,
        pushData: async (record) => { saved.push(record); return { chargedCount: 1, eventChargeLimitReached: false }; },
        updateStatus: async () => undefined,
        log: logger,
    });
    assert.equal(result.status.usersSaved, 1);
    assert.equal(saved[0].entityType, 'user');
    if (saved[0].entityType === 'user') assert.equal(saved[0].reposScrapedCount, 1);
});

test('does not save or bill a private repository exposed by a supplied token', async () => {
    let pushes = 0;
    const result = await scrapeGitHub(normalizeInput({ repos: ['owner/private-repo'] }), {
        client: {
            get: async () => ({
                outcome: 'ok',
                data: { ...repo('owner/private-repo', 9), private: true, visibility: 'private' },
            }),
        },
        pushData: async () => { pushes += 1; return { chargedCount: 1, eventChargeLimitReached: false }; },
        updateStatus: async () => undefined,
        log: logger,
    });
    assert.equal(pushes, 0);
    assert.equal(result.status.nonPublicSkipped, 1);
    assert.equal(result.status.status, 'empty');
});

test('stops at the internal runtime guard before starting more work', async () => {
    let requests = 0;
    const ticks = [0, 0, 100, 100, 100];
    const result = await scrapeGitHub(normalizeInput({ repos: ['openai/openai-node'] }), {
        client: { get: async () => { requests += 1; return { outcome: 'not_found' }; } },
        pushData: async () => { throw new Error('must not bill'); },
        updateStatus: async () => undefined,
        log: logger,
        now: () => ticks.shift() ?? 100,
        runtimeLimitMs: 50,
    });
    assert.equal(requests, 0);
    assert.equal(result.runtimeLimitReached, true);
    assert.equal(result.status.status, 'stopped_runtime_limit');
});
