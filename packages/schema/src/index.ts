import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Ajv, type ValidateFunction } from 'ajv';
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const time = Type.Number({ minimum: 0 });
const ns = Type.String({ pattern: '^[0-9]+$' });
const positive = Type.Number({ exclusiveMinimum: 0 });
const pathSafeId = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' });
/** Stable filesystem-safe identifier and a separate human-readable display name. */
export const NamedEntitySchema = object({ id: pathSafeId, name: Type.String({ minLength: 1 }) });
export type NamedEntity = Static<typeof NamedEntitySchema>;
export type NamedEntityType = NamedEntity;
export const StampSchema = object({
  clock: Type.Union([Type.Literal('harness'), Type.Literal('reporter')]),
  t: time,
});
export type Stamp = Static<typeof StampSchema>;
export type EpochMs = number;
export type ClockSource = 'harness' | 'reporter' | 'gpu';
export const GpuStampSchema = object({ clock: Type.Literal('gpu'), ns });
export type GpuStamp = Static<typeof GpuStampSchema>;
export const PhaseMarkSchema = object({
  phase: Type.Union((['load', 'process', 'compile'] as const).map((v) => Type.Literal(v))),
  start: StampSchema,
  end: Type.Optional(StampSchema),
});
export type PhaseMark = Static<typeof PhaseMarkSchema>;
export type PhaseName = PhaseMark['phase'];
export const FrameRecordSchema = object({
  cpuStart: time,
  cpuEnd: time,
  presented: Type.Optional(time),
  gpuStart: Type.Optional(ns),
  gpuEnd: Type.Optional(ns),
  animationTime: Type.Optional(Type.Number()),
});
export type FrameRecord = Static<typeof FrameRecordSchema>;
export const BlockRecordSchema = object({
  start: time,
  end: time,
  scripts: Type.Optional(
    Type.Array(
      object({
        start: time,
        end: time,
        sourceURL: Type.Optional(Type.String()),
        invoker: Type.Optional(Type.String()),
        invokerType: Type.Optional(Type.String()),
        sourceFunctionName: Type.Optional(Type.String()),
        sourceCharPosition: Type.Optional(Type.Number()),
      }),
    ),
  ),
  source: Type.Union((['longtask', 'loaf', 'watchdog'] as const).map((v) => Type.Literal(v))),
});
export type BlockRecord = Static<typeof BlockRecordSchema>;
export const ClockSyncSampleSchema = object({ t0: time, t1: time, t2: time, t3: time });
export type ClockSyncSample = Static<typeof ClockSyncSampleSchema>;
export const MessageLogItemSchema = object({
  type: Type.String(),
  direction: Type.Union([Type.Literal('toReporter'), Type.Literal('toHarness')]),
  sentAt: StampSchema,
  receivedAt: StampSchema,
});
export type MessageLogItem = Static<typeof MessageLogItemSchema>;
const vsync = Type.Union([Type.Literal('on'), Type.Literal('off')]);
export const EntrySchema = object({
  id: pathSafeId,
  name: Type.String(),
  renderer: NamedEntitySchema,
  scene: NamedEntitySchema,
  url: Type.String({ minLength: 1 }),
  durationMs: positive,
  warmupMs: Type.Optional(time),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type Entry = Static<typeof EntrySchema>;
export type SuiteEntry = Entry;
export const SuiteSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    schemaVersion: Type.Literal(1),
    name: Type.String(),
    defaults: Type.Optional(
      object({
        warmupMs: Type.Optional(time),
        repetitions: Type.Optional(Type.Integer({ minimum: 1, maximum: 1 })),
        order: Type.Optional(Type.Union([Type.Literal('interleaved'), Type.Literal('sequential')])),
        setupTimeoutMs: Type.Optional(positive),
        captureAfterWarmup: Type.Optional(Type.Boolean()),
        vsync: Type.Optional(vsync),
      }),
    ),
    entries: Type.Array(EntrySchema, { minItems: 1 }),
  },
  {
    additionalProperties: false,
    $id: 'https://bhouston.github.io/performance-kit/schema/v1/suite.schema.json',
  },
);
export type Suite = Static<typeof SuiteSchema>;
export const EnvironmentSchema = object({
  userAgent: Type.String(),
  gpuAdapter: Type.Optional(
    object({
      vendor: Type.Optional(Type.String()),
      architecture: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
    }),
  ),
  api: Type.Optional(Type.Union((['webgpu', 'webgl2', 'other'] as const).map((v) => Type.Literal(v)))),
  gpuTimestampsAvailable: Type.Boolean(),
  crossOriginIsolated: Type.Boolean(),
  devicePixelRatio: positive,
  canvasSize: Type.Optional(object({ width: positive, height: positive })),
  chromeFlags: Type.Array(Type.String()),
  host: object({ os: Type.String(), cpu: Type.String(), machineId: Type.Optional(Type.String()) }),
  gitCommit: Type.Optional(Type.String()),
});
export type Environment = Static<typeof EnvironmentSchema>;
export const RunResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String({ minLength: 1 }),
    suiteName: Type.Optional(Type.String()),
    entry: object({
      id: Type.String(),
      name: Type.String(),
      renderer: NamedEntitySchema,
      scene: NamedEntitySchema,
      url: Type.String(),
    }),
    repetition: Type.Optional(Type.Integer({ minimum: 1 })),
    config: object({ durationMs: positive, warmupMs: time, vsync }),
    environment: Type.Optional(EnvironmentSchema),
    harness: object({
      iframeCreated: Type.Optional(time),
      startSent: time,
      runSent: Type.Optional(time),
      runEndObserved: Type.Optional(time),
      captureSent: Type.Optional(time),
      teardown: time,
    }),
    clockSync: Type.Optional(object({ samples: Type.Array(ClockSyncSampleSchema) })),
    messages: Type.Optional(Type.Array(MessageLogItemSchema)),
    reporter: object({
      hello: Type.Optional(time),
      phases: Type.Optional(Type.Array(PhaseMarkSchema)),
      ready: Type.Optional(time),
      warmupStart: Type.Optional(time),
      runStart: Type.Optional(time),
      runEnd: Type.Optional(time),
      frames: Type.Array(FrameRecordSchema),
      blocks: Type.Optional(Type.Array(BlockRecordSchema)),
      watchdogTicks: Type.Optional(Type.Array(time)),
    }),
    capture: Type.Optional(object({ file: Type.String(), at: time })),
    status: Type.Union((['ok', 'timeout', 'error'] as const).map((v) => Type.Literal(v))),
    error: Type.Optional(object({ message: Type.String(), phase: Type.Optional(Type.String()) })),
  },
  {
    additionalProperties: false,
    $id: 'https://bhouston.github.io/performance-kit/schema/v1/run-result.schema.json',
  },
);
export type RunResult = Static<typeof RunResultSchema>;
const displayNumber = Type.Number();
const optionalNumber = Type.Optional(displayNumber);
export const ProcessedResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String({ minLength: 1 }),
    suiteName: Type.Optional(Type.String()),
    screenshot: Type.Boolean(),
    entry: RunResultSchema.properties.entry,
    config: object({ durationSeconds: positive, warmupSeconds: time, vsync }),
    environment: Type.Optional(EnvironmentSchema),
    status: RunResultSchema.properties.status,
    error: RunResultSchema.properties.error,
    statistics: object({
      frameCount: Type.Integer({ minimum: 0 }),
      intervalCount: Type.Integer({ minimum: 0 }),
      cpuSampleCount: Type.Integer({ minimum: 0 }),
      gpuSampleCount: Type.Integer({ minimum: 0 }),
      median: optionalNumber,
      p95: optionalNumber,
      p99: optionalNumber,
      iqr: optionalNumber,
      mad: optionalNumber,
      typicalFps: optionalNumber,
      tailFps: optionalNumber,
      setupSeconds: optionalNumber,
      reporterSetupSeconds: optionalNumber,
      hiddenStartupSeconds: optionalNumber,
      unaccountedSeconds: optionalNumber,
      setupMaxBlockSeconds: displayNumber,
      setupBlockedSeconds: displayNumber,
      offsetSeconds: optionalNumber,
      driftSeconds: optionalNumber,
      cpuMedian: optionalNumber,
      cpuP95: optionalNumber,
      gpuMedian: optionalNumber,
      gpuP95: optionalNumber,
      phaseDurations: object({ load: optionalNumber, process: optionalNumber, compile: optionalNumber }),
    }),
    timeline: object({
      timeUnit: Type.Literal('seconds'),
      valueUnit: Type.Literal('seconds'),
      maxTime: Type.Number({ minimum: 0 }),
      ready: optionalNumber,
      runStart: optionalNumber,
      runEnd: optionalNumber,
      frameSeconds: Type.Array(displayNumber),
      cpuSeconds: Type.Array(Type.Union([displayNumber, Type.Null()])),
      gpuSeconds: Type.Array(Type.Union([displayNumber, Type.Null()])),
      frameIndices: Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 1536, uniqueItems: true }),
      watchdogSeconds: Type.Array(displayNumber),
      watchdogIndices: Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 512, uniqueItems: true }),
      watchdogPeriodSeconds: Type.Literal(0.016),
      phases: Type.Array(
        object({
          phase: PhaseMarkSchema.properties.phase,
          start: displayNumber,
          end: optionalNumber,
          durationSeconds: optionalNumber,
        }),
        { maxItems: 128 },
      ),
      blocks: Type.Array(
        object({
          start: displayNumber,
          end: displayNumber,
          durationSeconds: displayNumber,
          sources: Type.Array(Type.String(), { maxItems: 3 }),
        }),
        { maxItems: 256 },
      ),
      discrepancies: Type.Array(object({ name: Type.String(), seconds: displayNumber, flagged: Type.Boolean() }), {
        maxItems: 256,
      }),
    }),
    histogram: object({
      bins: Type.Array(object({ start: displayNumber, end: displayNumber, count: Type.Integer({ minimum: 0 }) }), {
        maxItems: 40,
      }),
      count: Type.Integer({ minimum: 0 }),
      maxCount: Type.Integer({ minimum: 0 }),
    }),
    attribution: Type.Array(
      object({
        start: displayNumber,
        end: displayNumber,
        durationSeconds: displayNumber,
        sourceURL: Type.Optional(Type.String()),
        invoker: Type.Optional(Type.String()),
        invokerType: Type.Optional(Type.String()),
        sourceFunctionName: Type.Optional(Type.String()),
        sourceCharPosition: optionalNumber,
      }),
      { maxItems: 256 },
    ),
  },
  {
    additionalProperties: false,
    $id: 'https://bhouston.github.io/performance-kit/schema/v1/processed-result.schema.json',
  },
);
export type ProcessedResult = Static<typeof ProcessedResultSchema>;
export type Envelope<TType extends string, TPayload> = {
  protocol: 'performance-kit';
  protocolVersion: 1;
  runId: string;
  seq: number;
  type: TType;
  sentAt: number;
  payload: TPayload;
};
const envelope = <T extends string, P extends TSchema>(type: T, payload: P) =>
  object({
    protocol: Type.Literal('performance-kit'),
    protocolVersion: Type.Literal(1),
    runId: Type.String({ minLength: 1 }),
    seq: Type.Integer({ minimum: 0 }),
    type: Type.Literal(type),
    sentAt: time,
    payload,
  });
export const protocolSchemas = {
  syncPing: envelope('syncPing', object({ t0: time })),
  start: envelope(
    'start',
    object({
      entryId: Type.String(),
      params: Type.Record(Type.String(), Type.Unknown()),
      warmupMs: time,
    }),
  ),
  captureRequest: envelope('capture', object({ mimeType: Type.Literal('image/png') })),
  run: envelope('run', object({ durationMs: positive })),
  abort: envelope('abort', object({ reason: Type.String() })),
  hello: envelope(
    'hello',
    object({
      reporterVersion: Type.String(),
      capabilities: object({
        gpuTimestamps: Type.Boolean(),
        longTasks: Type.Boolean(),
        loaf: Type.Boolean(),
      }),
    }),
  ),
  syncPong: envelope('syncPong', object({ t0: time, t1: time, t2: time })),
  phase: envelope('phase', PhaseMarkSchema),
  ready: envelope('ready', object({ at: time })),
  captureResponse: envelope('capture', object({ at: time, bytes: Type.Unsafe<ArrayBuffer>({}) })),
  runEnd: envelope(
    'runEnd',
    object({
      runStart: Type.Optional(time),
      runEnd: time,
      frames: Type.Array(FrameRecordSchema),
      blocks: Type.Array(BlockRecordSchema),
      watchdogTicks: Type.Array(time),
      messages: Type.Optional(Type.Array(MessageLogItemSchema)),
    }),
  ),
  environment: envelope('environment', Type.Partial(EnvironmentSchema)),
  error: envelope(
    'error',
    object({
      message: Type.String(),
      stack: Type.Optional(Type.String()),
      phase: Type.Optional(Type.String()),
    }),
  ),
  progress: envelope('progress', object({ at: time, frameCount: Type.Integer({ minimum: 0 }) })),
};
export const MessageToReporterSchema = Type.Union([
  protocolSchemas.syncPing,
  protocolSchemas.start,
  protocolSchemas.captureRequest,
  protocolSchemas.run,
  protocolSchemas.abort,
]);
export const MessageToHarnessSchema = Type.Union([
  protocolSchemas.hello,
  protocolSchemas.syncPong,
  protocolSchemas.phase,
  protocolSchemas.ready,
  protocolSchemas.captureResponse,
  protocolSchemas.runEnd,
  protocolSchemas.environment,
  protocolSchemas.error,
  protocolSchemas.progress,
]);
export type MessageToReporter = Static<typeof MessageToReporterSchema>;
export type MessageToHarness = Static<typeof MessageToHarnessSchema>;
const ajv = new Ajv({ allErrors: true, strict: false });
export const validateSuite = ajv.compile<Suite>(SuiteSchema);
export const validateRunResult = ajv.compile<RunResult>(RunResultSchema);
const validateProcessedSchema = ajv.compile<ProcessedResult>(ProcessedResultSchema);
export const validateProcessedResult: ValidateFunction<ProcessedResult> = Object.assign(
  (value: unknown) => {
    const valid = validateProcessedSchema(value);
    validateProcessedResult.errors = validateProcessedSchema.errors;
    if (!valid) return false;
    const metrics = value as ProcessedResult;
    const timeline = metrics.timeline;
    const error = (instancePath: string, message: string) => {
      validateProcessedResult.errors = [{ keyword: 'alignment', instancePath, schemaPath: '', params: {}, message }];
      return false;
    };
    if (
      timeline.cpuSeconds.length !== timeline.frameSeconds.length ||
      timeline.gpuSeconds.length !== timeline.frameSeconds.length
    )
      return error('/timeline', 'CPU and GPU arrays must align with frameSeconds');
    for (const [name, indices, length] of [
      ['frameIndices', timeline.frameIndices, timeline.frameSeconds.length],
      ['watchdogIndices', timeline.watchdogIndices, timeline.watchdogSeconds.length],
    ] as const) {
      if (indices.some((index, position) => index >= length || (position > 0 && index <= indices[position - 1]!)))
        return error(`/timeline/${name}`, 'indices must be ordered and refer to existing samples');
    }
    return true;
  },
  { errors: null },
) as ValidateFunction<ProcessedResult>;
export const validateMessageToReporter = ajv.compile<MessageToReporter>(MessageToReporterSchema);
const validateHarnessSchema = ajv.compile<MessageToHarness>(MessageToHarnessSchema);
export const validateMessageToHarness: ValidateFunction<MessageToHarness> = Object.assign(
  (value: unknown) => {
    const valid = validateHarnessSchema(value);
    validateMessageToHarness.errors = validateHarnessSchema.errors;
    if (
      valid &&
      (value as MessageToHarness).type === 'capture' &&
      !((value as Extract<MessageToHarness, { type: 'capture' }>).payload.bytes instanceof ArrayBuffer)
    ) {
      validateMessageToHarness.errors = [
        {
          keyword: 'instanceof',
          instancePath: '/payload/bytes',
          schemaPath: '',
          params: {},
          message: 'must be an ArrayBuffer',
        },
      ];
      return false;
    }
    return valid;
  },
  { errors: null },
) as ValidateFunction<MessageToHarness>;
function assert<T>(validator: ValidateFunction<T>, value: unknown, label: string): asserts value is T {
  if (!validator(value)) throw new Error(`${label}: ${ajv.errorsText(validator.errors, { separator: '; ' })}`);
}
export function assertSuite(value: unknown): asserts value is Suite {
  assert(validateSuite, value, 'Invalid suite');
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (ids.has(entry.id)) throw new Error(`Invalid suite: duplicate entry id ${entry.id}`);
    ids.add(entry.id);
  }
}
export function assertRunResult(value: unknown): asserts value is RunResult {
  assert(validateRunResult, value, 'Invalid result');
}
export function assertProcessedResult(value: unknown): asserts value is ProcessedResult {
  assert(validateProcessedResult, value, 'Invalid processed result');
}
export function assertMessageToReporter(value: unknown): asserts value is MessageToReporter {
  assert(validateMessageToReporter, value, 'Invalid protocol message');
}
export function assertMessageToHarness(value: unknown): asserts value is MessageToHarness {
  assert(validateMessageToHarness, value, 'Invalid protocol message');
}
export const schemas = {
  'named-entity': NamedEntitySchema,
  suite: SuiteSchema,
  'run-result': RunResultSchema,
  'processed-result': ProcessedResultSchema,
  'message-to-reporter': MessageToReporterSchema,
  'message-to-harness': MessageToHarnessSchema,
  ...protocolSchemas,
};

export * from './derive.js';
export * from './colorScales.js';

export * from './process.js';
