import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRepo, mapIssue, mapUser, mapUserRepo, validateGitHubRecord } from './routes.js';

test('mapRepo maps core fields and prefers subscribers_count for watchers', () => {
    const r = mapRepo({
        id: 10270250,
        full_name: 'facebook/react',
        name: 'react',
        owner: { login: 'facebook' },
        stargazers_count: 200000,
        forks_count: 40000,
        subscribers_count: 6000,
        watchers_count: 200000,
        open_issues_count: 1000,
        license: { spdx_id: 'MIT' },
        topics: ['ui', 'javascript'],
        fork: false,
        archived: false,
        default_branch: 'main',
    }, []);
    assert.equal(r.entityType, 'repo');
    assert.equal(r.fullName, 'facebook/react');
    assert.equal(r.owner, 'facebook');
    assert.equal(r.watchers, 6000);
    assert.equal(r.license, 'MIT');
    assert.deepEqual(r.topics, ['ui', 'javascript']);
    assert.equal(r.isFork, false);
    assert.equal(r.issuesScrapedCount, 0);
});

test('mapRepo defaults topics to [] and license falls back to key', () => {
    const r = mapRepo({ id: 1, license: { key: 'apache-2.0' } }, []);
    assert.deepEqual(r.topics, []);
    assert.equal(r.license, 'apache-2.0');
    assert.equal(r.fullName, null);
});

test('mapIssue detects pull requests and normalizes mixed labels', () => {
    const i = mapIssue({
        number: 5,
        title: 'Bug',
        state: 'open',
        pull_request: { url: 'x' },
        user: { login: 'alice' },
        comments: 3,
        labels: ['bug', { name: 'p1' }, {}],
    });
    assert.equal(i.isPullRequest, true);
    assert.equal(i.author, 'alice');
    assert.deepEqual(i.labels, ['bug', 'p1']);
});

test('mapIssue without pull_request is not a PR and defaults labels', () => {
    const i = mapIssue({ number: 1, title: 'x', state: 'closed' });
    assert.equal(i.isPullRequest, false);
    assert.deepEqual(i.labels, []);
});

test('mapUser sets entityType and counts nested repos', () => {
    const u = mapUser(
        {
            id: 1,
            login: 'torvalds',
            followers: 200000,
            public_repos: 10,
            html_url: 'https://github.com/torvalds',
            created_at: '2008-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
        },
        [mapUserRepo({
            full_name: 'torvalds/linux',
            html_url: 'https://github.com/torvalds/linux',
            stargazers_count: 170000,
        })],
    );
    assert.equal(u.entityType, 'user');
    assert.equal(u.login, 'torvalds');
    assert.equal(u.reposScrapedCount, 1);
    assert.equal(u.repos[0].fullName, 'torvalds/linux');
    assert.equal(u.updatedAt, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(validateGitHubRecord(u), []);
});

test('record validation rejects incomplete top-level records before billing', () => {
    const record = mapRepo({ id: 1, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } }, []);
    assert.match(validateGitHubRecord(record).join(' '), /repository URL/);
});
