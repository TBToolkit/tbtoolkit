# `.biff` Import/Export Plan

Status: design checkpoint for `account-encounter-workspaces`

## Purpose

`.biff` (Battle Information File Format) is the portable backup and sharing format for complete Battle Calculator Player Accounts. Version 1 should let a player:

- export one account, including its custom encounters and encounter workspaces;
- import that account on another browser or device without overwriting existing data;
- inspect what will be imported before any browser storage changes;
- round-trip an untouched export without changing calculator behavior.

This is an interchange format, not a dump of `localStorage`. Compatibility aliases, transient UI state, optimizer progress, and cached optimizer results must not be exported.

## Version 1 envelope

The file is UTF-8 JSON with a `.biff` extension. The top-level envelope is deliberately small and independently versioned from browser-storage keys.

```json
{
  "format": "tbtoolkit-biff",
  "schemaVersion": 1,
  "exportedAt": "2026-09-01T21:30:00.000Z",
  "appBuild": "191-dev1",
  "kind": "account",
  "account": {}
}
```

Required account data:

- stable account ID and display name;
- Temple level;
- custom encounters;
- active Epic and PvP encounter IDs;
- active battle category and calculation method;
- each encounter workspace's calculator inputs, selected unit IDs, and Custom Order state.

Explicitly excluded:

- built-in encounter definitions (refer to their stable IDs instead);
- optimizer result caches and in-progress optimizer diagnostics;
- legacy top-level Epic, Custom, and Optimizer modes;
- compatibility getters/aliases created by `makeBattleWorkspace()`;
- unrelated preferences or site data.

## Canonical payload

An account payload should use arrays at file boundaries, even where runtime state uses ID-keyed objects. Arrays are easier to validate, preserve deterministic ordering, and prevent unsafe object keys.

```text
account
├── id, name, templeLevel
├── activeBattleCategory, activeBattleMethod
├── activeEncounterByType { epic, pvp }
├── customEncounters[]
│   ├── id, name, battleType
│   └── enemyFormation + arachneBonus | pvpModel
└── workspaces[]
    ├── encounterId
    ├── inputs
    ├── selectedIds { troop[], monster[], mercenary[] }
    └── customOrder
        ├── orders
        ├── unitOrders
        ├── unitOrderManual
        └── squadOrder
```

The serializer should emit keys in a fixed order and sort custom encounters and workspaces by ID. This makes exports stable and reviewable.

## Import behavior

Version 1 defaults to **Add as New Account**. Import must never silently replace an existing account.

The preview requires a unique Player Account display name. It is prefilled with the exported name when available, or a unique `Copy` suggestion when that name already exists.

1. Read and parse the file without changing application state.
2. Validate the envelope and normalize the payload into current runtime shapes.
3. Show a preview: account name, Temple level, encounter count, workspace count, and warnings.
4. On confirmation, allocate a new account ID if the imported ID already exists.
5. Allocate new custom-encounter IDs on collisions and rewrite all references and workspace keys using the same ID map.
6. Preserve built-in encounter IDs when they still exist. If a built-in ID is unknown, retain its workspace but select the first valid encounter and show a warning.
7. Drop selected unit IDs that are absent from the current army database, and report the count. Reconcile Custom Order arrays after unit filtering.
8. Hydrate through the same constructors used by normal saved-state loading.
9. Validate the complete candidate account collection, then persist it once. If persistence fails, leave the prior in-memory and stored state unchanged.

Replace and merge behaviors are intentionally deferred. They require more conflict choices and are not necessary for safe backup/restore.

## Validation and safety contract

- Reject files larger than 5 MB before parsing.
- Require `format === "tbtoolkit-biff"` and a supported integer `schemaVersion`.
- Reject malformed JSON, duplicate IDs within the file, invalid battle types, invalid PvP models, and Epic formations outside 1–8 squads.
- Bound names to the same 60-character UI limit and normalize surrounding whitespace.
- Clamp only values the live UI already clamps (for example Temple level); reject structurally invalid values rather than guessing.
- Ignore unknown object properties so additive schema changes remain forward-tolerant, but reject a newer unsupported schema version.
- Build clean objects field by field. Never spread untrusted top-level objects into application state, and ignore `__proto__`, `prototype`, and `constructor` keys.
- Do not execute file content, resolve external URLs, or embed binary data.
- Perform all validation and ID rewriting before the first state mutation.

## Proposed code boundaries

Create `js/biff-format.mjs` as a pure module with no DOM or `localStorage` access:

- `serializeAccountToBiff(account, metadata)`
- `parseBiff(text, limits)`
- `previewBiffImport(parsed, currentState, armyIds)`
- `materializeImportedAccount(parsed, currentState, armyIds)`

Keep file selection, download creation, confirmation dialogs, activation, and persistence in `epic-stacker.js`. Reuse `makeAccount()`, `createCustomEncounter()`, `normalizeEnemyFormation()`, `makeBattleWorkspace()`, and `validateAccountCollection()` rather than maintaining a second set of runtime rules.

## UI proposal

Add **Export** and **Import** beside the Player Account controls.

- **Export** downloads the active account as `<safe-account-name>.biff`.
- **Import** opens a file picker accepting `.biff,application/json`.
- The preview dialog identifies the operation as **Add as New Account** and lists every warning before enabling Import.
- After success, activate the imported account and show a short summary. Do not automatically recalculate an imported optimizer result because optimizer caches are excluded.

## Required regression coverage

1. Canonical account export snapshot.
2. Export → import round trip preserves inputs, selections, encounters, and Custom Order.
3. Existing account and encounter ID collisions are remapped consistently.
4. Unknown unit IDs are removed from selections and all Custom Order structures with warnings.
5. Malformed, oversized, wrong-format, and newer-version files make no state changes.
6. Invalid Epic formation and PvP model are rejected.
7. Optimizer caches and legacy state do not appear in exported text.
8. Import persistence failure leaves the previous account collection active and intact.
9. A `.biff` produced by schema v1 continues to import after browser-storage schema changes.

## Implementation sequence

1. Extract/export the workspace constructor needed by the pure import module, without changing runtime behavior.
2. Implement the v1 serializer, parser, normalizer, and ID-remapping tests.
3. Add Export and verify downloads in Chromium and Firefox.
4. Add import preview and the atomic Add-as-New flow.
5. Add corrupted-file, collision, missing-unit, and storage-failure tests.
6. Publish the v1 schema example as a fixture and freeze it before enabling `.biff` in production.

## Deferred from version 1

- multi-account bundle export;
- encounter-level or workspace-level import/export;
- merge or replace import;
- encryption or password protection;
- compression;
- cloud sync and share links;
- imported optimizer result caches;
- digital signatures or publisher trust indicators.

These can be added through new `kind` values or a later schema version without changing the version 1 account contract.
