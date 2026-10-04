# performance-kit-schema

TypeBox schemas, TypeScript types, and Ajv validators for performance-kit suites, raw results, manifests, and messages. JSON Schema files are published under `schemas/`.

Suite entries and result entries name their renderer and scene explicitly:

```json
{
  "renderer": { "id": "three-base", "name": "Three Base" },
  "scene": { "id": "cornell-metallic", "name": "Cornell metallic sphere" }
}
```

Both references use the exported `NamedEntity` (`NamedEntityType`) type and `NamedEntitySchema`. IDs are stable path-safe identifiers: ASCII letters or digits followed by letters, digits, periods, underscores, or hyphens. Display names may contain spaces and are shown in the report's Renderers and Scenes navigation. `SuiteEntry` aliases the existing `Entry` type.

`renderer` and `scene` are required on every suite entry and result entry. IDs support filtering and comparisons; names appear in the report. The former labels array is not part of this format and is rejected by validation. These references describe the entry; they do not change any raw timing data or require moving its files.
