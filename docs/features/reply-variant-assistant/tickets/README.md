# Reply Variant Assistant Tickets

Build order:

1. `RVA-001-rfr-pin-reply-split-merge-behavior.md` - `[RFR]` Pin current reply split/merge safety before changing reply UI.
2. `RVA-002-reply-assistant-shared-contracts-and-transport-surface.md` - `[FND]` Add reply-specific shared schemas and transport surface.
3. `RVA-003-generated-reply-ledger-and-hash-projection.md` - `[FND]` Add generated reply ledger, normalized hash projection, and repository contract.
4. `RVA-004-reply-variant-generation-routes-and-service.md` - Implement reply variant generation service and HTTP route.
5. `RVA-005-generated-reply-exclusion-from-voice-evidence.md` - Exclude exact generated reply hashes from voice/RAG evidence readers.
6. `RVA-006-reply-assistant-overlay-branch.md` - Branch reply mode away from the legacy post cockpit.
7. `RVA-007-reply-variant-choose-and-record-flow.md` - Implement variant chooser, native composer write, and ledger recording.
8. `RVA-008-reply-assistant-end-to-end-contract.md` - `[INT]` Prove the full reply assistant path and post-mode non-regression.
