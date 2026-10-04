import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Ajv, type ValidateFunction } from 'ajv';
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const time = Type.Number({ minimum: 0 });
const ns = Type.String({ pattern: '^[0-9]+$' });
const positive = Type.Number({ exclusiveMinimum: 0 });
export const LabelSchema = object({ key: Type.String({ minLength: 1 }), value: Type.String() });
export type Label = Static<typeof LabelSchema>;
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
  phase: Type.Union(['load', 'process', 'compile'].map((v) => Type.Literal(v))),
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
  source: Type.Union(['longtask', 'loaf', 'watchdog'].map((v) => Type.Literal(v))),
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
  id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }),
  name: Type.String(),
  labels: Type.Optional(Type.Array(LabelSchema)),
  url: Type.String({ minLength: 1 }),
  durationMs: positive,
  warmupMs: Type.Optional(time),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type Entry = Static<typeof EntrySchema>;
export const SuiteSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    schemaVersion: Type.Literal(1),
    name: Type.String(),
    defaults: Type.Optional(
      object({
        warmupMs: Type.Optional(time),
        repetitions: Type.Optional(Type.Integer({ minimum: 1 })),
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
  api: Type.Optional(Type.Union(['webgpu', 'webgl2', 'other'].map((v) => Type.Literal(v)))),
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
      labels: Type.Array(LabelSchema),
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
    status: Type.Union(['ok', 'timeout', 'error'].map((v) => Type.Literal(v))),
    error: Type.Optional(object({ message: Type.String(), phase: Type.Optional(Type.String()) })),
  },
  {
    additionalProperties: false,
    $id: 'https://bhouston.github.io/performance-kit/schema/v1/run-result.schema.json',
  },
);
export type RunResult = Static<typeof RunResultSchema>;
export const ManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runSetId: Type.String(),
    createdAt: Type.String(),
    suite: SuiteSchema,
    schedule: Type.Array(object({ entryId: Type.String(), repetition: Type.Integer({ minimum: 1 }) })),
    seed: Type.Optional(Type.Number()),
    gitCommit: Type.Optional(Type.String()),
    environment: Type.Optional(EnvironmentSchema),
  },
  {
    additionalProperties: false,
    $id: 'https://bhouston.github.io/performance-kit/schema/v1/manifest.schema.json',
  },
);
export type Manifest = Static<typeof ManifestSchema>;
export type RunSetManifest = Manifest;
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
export const validateManifest = ajv.compile<Manifest>(ManifestSchema);
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
export function assertManifest(value: unknown): asserts value is Manifest {
  assert(validateManifest, value, 'Invalid manifest');
}
export function assertMessageToReporter(value: unknown): asserts value is MessageToReporter {
  assert(validateMessageToReporter, value, 'Invalid protocol message');
}
export function assertMessageToHarness(value: unknown): asserts value is MessageToHarness {
  assert(validateMessageToHarness, value, 'Invalid protocol message');
}
export const schemas = {
  suite: SuiteSchema,
  'run-result': RunResultSchema,
  manifest: ManifestSchema,
  'message-to-reporter': MessageToReporterSchema,
  'message-to-harness': MessageToHarnessSchema,
  ...protocolSchemas,
};

export * from './derive.js';
export * from './colorScales.js';
