import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDb } from '@relay/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveHub } from '../src/live/live-hub.js';
import { boot, ORIGIN, signUpUser, type TestUser } from './helpers.js';

interface SseEvent {
  event: string;
  data: unknown;
}

/** Minimal SSE client over fetch: collects parsed events until stopped. */
function openStream(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const events: SseEvent[] = [];
  const response = fetch(url, { headers, signal: controller.signal });
  const done = response.then(async (res) => {
    if (!res.ok || !res.body) return res;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buffer += value;
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      // aborted
    }
    return res;
  });
  const waitFor = async (predicate: (e: SseEvent) => boolean, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = events.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error('timed out waiting for SSE event');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { events, response, waitFor, close: () => controller.abort(), done };
}

describe('live stream (SSE)', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let owner: TestUser;
  let outsider: TestUser;
  let devKey: string;
  let prodKey: string;

  beforeAll(async () => {
    app = await boot(await createTestDb());
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = await app.getUrl();
    owner = await signUpUser(app, 'live@example.com');
    outsider = await signUpUser(app, 'stranger@example.com');
    const key = async (envId: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `/v1/environments/${envId}/api-keys`,
          headers: { cookie: owner.cookie, origin: ORIGIN },
          payload: { name: 'live' },
        })
      ).json().key as string;
    devKey = await key(owner.developmentEnvId);
    prodKey = await key(owner.productionEnvId);
    // An endpoint, so events fan out to a delivery.
    await app.inject({
      method: 'POST',
      url: '/v1/endpoints',
      headers: { authorization: `Bearer ${devKey}` },
      payload: { url: 'https://example.com/hooks' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const sendEvent = (key: string, type: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { authorization: `Bearer ${key}` },
      payload: { type, data: {} },
    });

  it('streams committed changes for the subscribed environment only', async () => {
    const stream = openStream(`${baseUrl}/v1/environments/${owner.developmentEnvId}/stream`, {
      cookie: owner.cookie,
    });
    const res = await stream.response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-transform');
    await stream.waitFor((e) => e.event === 'ready');

    await sendEvent(prodKey, 'other.env'); // must not arrive
    const sent = (await sendEvent(devKey, 'live.test')).json();

    const created = await stream.waitFor((e) => e.event === 'event.created');
    expect(created.data).toMatchObject({
      type: 'event.created',
      environmentId: owner.developmentEnvId,
      event: { id: sent.id, type: 'live.test', deliveryCounts: { pending: 1, succeeded: 0 } },
    });
    expect(
      stream.events.some(
        (e) => (e.data as { event?: { type: string } }).event?.type === 'other.env',
      ),
    ).toBe(false);
    stream.close();
    await stream.done;
  });

  it('serves API keys at /v1/stream', async () => {
    const stream = openStream(`${baseUrl}/v1/stream`, { authorization: `Bearer ${devKey}` });
    await stream.waitFor((e) => e.event === 'ready');
    await sendEvent(devKey, 'via.key');
    await stream.waitFor((e) => (e.data as { event?: { type: string } }).event?.type === 'via.key');
    stream.close();
    await stream.done;
  });

  it('is authenticated and scoped like every other route', async () => {
    const anonymous = await fetch(`${baseUrl}/v1/environments/${owner.developmentEnvId}/stream`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('content-type')).toContain('application/problem+json');
    const stranger = await fetch(`${baseUrl}/v1/environments/${owner.developmentEnvId}/stream`, {
      headers: { cookie: outsider.cookie },
    });
    expect(stranger.status).toBe(404);
  });

  it('releases the subscription when the client disconnects', async () => {
    const hub = app.get(LiveHub);
    const stream = openStream(`${baseUrl}/v1/stream`, { authorization: `Bearer ${devKey}` });
    await stream.waitFor((e) => e.event === 'ready');
    expect(hub.size).toBeGreaterThan(0);
    stream.close();
    await stream.done;
    const deadline = Date.now() + 2_000;
    while (hub.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(hub.size).toBe(0);
  });
});
