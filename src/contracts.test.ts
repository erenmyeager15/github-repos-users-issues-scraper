import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface ActorContract {
    pricingInfo: { pricingPerEvent: { actorChargeEvents: Record<string, { eventPriceUsd: number }> } };
    defaultRunOptions: { memoryMbytes: number; timeoutSecs: number };
    maxMemoryMbytes: number;
}
interface InputContract {
    properties: Record<string, { maxItems?: number; maximum?: number }>;
}
interface OutputContract {
    properties: { runStatus: { template: string } };
}
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

test('keeps live pricing and API-sized resource limits aligned', () => {
    const actor = readJson<ActorContract>('.actor/actor.json');
    const events = actor.pricingInfo.pricingPerEvent.actorChargeEvents;
    assert.equal(events['repo-scraped'].eventPriceUsd, 0.002);
    assert.equal(events['apify-actor-start'].eventPriceUsd, 0.00005);
    assert.equal(actor.defaultRunOptions.memoryMbytes, 512);
    assert.equal(actor.defaultRunOptions.timeoutSecs, 3600);
    assert.ok(actor.maxMemoryMbytes <= 1024);
});

test('publishes bounded input fields and run diagnostics', () => {
    const input = readJson<InputContract>('INPUT_SCHEMA.json');
    assert.equal(input.properties.repos.maxItems, 1000);
    assert.equal(input.properties.users.maxItems, 500);
    assert.equal(input.properties.searchQueries.maxItems, 20);
    assert.equal(input.properties.maxResults.maximum, 1000);

    const output = readJson<OutputContract>('.actor/output_schema.json');
    assert.match(output.properties.runStatus.template, /RUN_STATUS$/);
});
