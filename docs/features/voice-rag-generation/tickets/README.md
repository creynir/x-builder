# Voice RAG Generation - Build Order

Tickets build top to bottom. This epic adds a local derived voice retrieval projection for generation guidance. It does not change the canonical corpus interface, feedback actuals, overlay transport, generated response schemas, or posting behavior.

| ID | Prefix | Title | Track | Depends on |
|---|---|---|---|---|
| VRG-001 | [FND] | SQLite voice projection migration | engine/storage | - |
| VRG-002 | [FND] | Deterministic local voice embedder | engine/voice | VRG-001 |
| VRG-003 | - | Voice index lifecycle service | engine/storage+voice | VRG-001, VRG-002 |
| VRG-004 | - | Voice RAG sample provider and resolver plug-in | engine/llm | VRG-003 |
| VRG-005 | [INT] | HTTP and runner generation parity | engine/runner tests | VRG-004 |
| VRG-006 | [DOC] | Local voice index documentation | docs | VRG-005 |

