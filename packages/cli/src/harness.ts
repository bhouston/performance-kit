/** Executed in the isolated harness page. Keep the measured run window idle. */
export async function harnessRun(input: {
  runId: string;
  url: string;
  entryId: string;
  params: Record<string, unknown>;
  warmupMs: number;
  durationMs: number;
  setupTimeoutMs: number;
  capture: boolean;
  width: number;
  height: number;
  isolation?: 'iframe' | 'page';
}) {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Function is serialized into Chrome.
  const now = () => performance.timeOrigin + performance.now();
  type Message = {
    protocol: string;
    protocolVersion: number;
    runId: string;
    seq: number;
    type: string;
    sentAt: number;
    payload: Record<string, unknown>;
  };
  const outer = window as unknown as {
    validateEnvelope: (message: unknown, bytes?: number[]) => Promise<void>;
    __performanceKitReceive?: (message: unknown) => void;
    __performanceKitSend?: (message: unknown) => void;
  };
  const pageMode = input.isolation === 'page';
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `width:${input.width}px;height:${input.height}px;border:0`;
  iframe.allow = 'cross-origin-isolated';
  const harness: Record<string, number> = { iframeCreated: now(), startSent: now() };
  const reporter: Record<string, unknown> = {
    frames: [],
    phases: [],
    blocks: [],
    watchdogTicks: [],
  };
  const messages: unknown[] = [],
    samples: unknown[] = [];
  let environment: Record<string, unknown> = {};
  let seq = 0,
    receivedSeq = -1;
  let failure: Error | undefined;
  const waiting = new Map<
    string,
    {
      resolve: (message: Message) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }[]
  >();
  const pending = new Map<string, Message[]>();
  const origin = new URL(input.url).origin;
  const send = (type: string, payload: Record<string, unknown>) => {
    const sentAt = now();
    const message = {
      protocol: 'performance-kit',
      protocolVersion: 1,
      runId: input.runId,
      seq: seq++,
      type,
      sentAt,
      payload,
    };
    if (pageMode) outer.__performanceKitReceive?.(message);
    else iframe.contentWindow?.postMessage(message, origin);
    return sentAt;
  };
  const wait = (type: string, timeout = input.setupTimeoutMs): Promise<Message> => {
    if (failure) return Promise.reject(failure);
    const message = pending.get(type)?.shift();
    if (message) return Promise.resolve(message);
    return new Promise((resolve, reject) => {
      const item = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const queue = waiting.get(type);
          if (queue)
            waiting.set(
              type,
              queue.filter((candidate) => candidate !== item),
            );
          reject(new Error(`Timeout waiting for ${type}`));
        }, timeout),
      };
      waiting.set(type, [...(waiting.get(type) ?? []), item]);
    });
  };
  const listener = async (event: MessageEvent) => {
    if (
      event.source !== (pageMode ? window : iframe.contentWindow) ||
      event.origin !== origin ||
      event.data?.protocol !== 'performance-kit'
    )
      return;
    const receivedAt = now();
    try {
      const bytes =
        event.data.type === 'capture' && event.data.payload?.bytes instanceof ArrayBuffer
          ? Array.from(new Uint8Array(event.data.payload.bytes))
          : undefined;
      await outer.validateEnvelope(event.data, bytes);
      const message = event.data as Message;
      if (message.runId !== input.runId) throw new Error('Protocol runId mismatch');
      if (message.seq <= receivedSeq) throw new Error('Protocol sequence repeated or reordered');
      receivedSeq = message.seq;
      messages.push({
        type: message.type,
        direction: 'toHarness',
        sentAt: { clock: 'reporter', t: message.sentAt },
        receivedAt: { clock: 'harness', t: receivedAt },
      });
      if (message.type === 'hello') reporter.hello = message.sentAt;
      if (message.type === 'phase') (reporter.phases as unknown[]).push(message.payload);
      if (message.type === 'ready') reporter.ready = message.payload.at;
      if (message.type === 'environment') environment = { ...environment, ...message.payload };
      if (message.type === 'runEnd') {
        const { messages: receiptLogs, ...measurements } = message.payload;
        Object.assign(reporter, measurements);
        if (Array.isArray(receiptLogs)) messages.push(...receiptLogs);
        harness.runEndObserved = receivedAt;
      }
      if (message.type === 'syncPong') {
        samples.push({ ...message.payload, t3: receivedAt });
        // Startup receipt logs arrive with runEnd; tail pings happen afterwards.
        if (reporter.runEnd !== undefined)
          messages.push({
            type: 'syncPing',
            direction: 'toReporter',
            sentAt: { clock: 'harness', t: message.payload.t0 },
            receivedAt: { clock: 'reporter', t: message.payload.t1 },
          });
      }
      if (message.type === 'error') throw new Error(String(message.payload.message));
      const item = waiting.get(message.type)?.shift();
      if (item) {
        clearTimeout(item.timer);
        item.resolve(message);
      } else pending.set(message.type, [...(pending.get(message.type) ?? []), message]);
    } catch (error) {
      failure = error as Error;
      for (const queue of waiting.values())
        for (const item of queue) {
          clearTimeout(item.timer);
          item.reject(failure);
        }
      waiting.clear();
    }
  };
  window.addEventListener('message', listener);
  if (pageMode)
    outer.__performanceKitSend = (message) => {
      void listener(new MessageEvent('message', { data: message, origin, source: window }));
    };
  else {
    iframe.src = input.url;
    document.body.append(iframe);
  }
  let status: 'ok' | 'error' | 'timeout' = 'ok';
  let error: { message: string } | undefined;
  let capture: { at: number; bytes: number[] } | undefined;
  const sync = async (count: number) => {
    for (let i = 0; i < count; i++) {
      send('syncPing', { t0: now() });
      await wait('syncPong');
    }
  };
  try {
    await wait('hello');
    await sync(10);
    harness.startSent = send('start', {
      entryId: input.entryId,
      params: input.params,
      warmupMs: input.warmupMs,
    });
    await wait('ready');
    reporter.warmupStart = reporter.ready;
    await new Promise((resolve) => setTimeout(resolve, input.warmupMs));
    if (input.capture) {
      harness.captureSent = send('capture', { mimeType: 'image/png' });
      const response = await wait('capture');
      capture = {
        at: Number(response.payload.at),
        bytes: Array.from(new Uint8Array(response.payload.bytes as ArrayBuffer)),
      };
    }
    harness.runSent = send('run', { durationMs: input.durationMs });
    await wait('runEnd', input.durationMs + input.setupTimeoutMs);
    await sync(5);
  } catch (caught) {
    const message = (caught as Error).message;
    status = message.startsWith('Timeout') ? 'timeout' : 'error';
    error = { message };
    send('abort', { reason: message });
    // Allow the reporter to flush raw partial frames and receipts before removal.
    await new Promise((done) => setTimeout(done, 200));
  } finally {
    harness.teardown = now();
    iframe.remove();
    window.removeEventListener('message', listener);
    for (const queue of waiting.values()) for (const item of queue) clearTimeout(item.timer);
  }
  return {
    harness,
    reporter,
    messages,
    clockSync: { samples },
    environment,
    capture,
    status,
    error,
  };
}
