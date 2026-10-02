# Foundry VTT 14 compatibility

StarWarsFFG supports Foundry VTT 13 and 14 during the runtime compatibility phase. Always back up a world before opening its copy on a newer Foundry generation. A world migrated on Version 14 must be restored from its Version 13 backup before downgrade; do not open the migrated database in an older generation.

Before upgrading, stop Foundry completely and copy the entire world directory from `Data/worlds/<world-id>` to storage outside the active Foundry data directory. Keep that backup unchanged until the migrated world has passed Actor, Item, effect, roll, combat, importer, and macro checks. To roll back, stop Foundry 14, restore the complete backup into a Version 13 data directory, reinstall the Version 13-compatible system build, and start the restored world there. Downgrading the migrated database in place is unsupported.

## Deferred compatibility warnings

The following warnings are intentionally deferred to their dedicated OpenSpec changes:

- ApplicationV1, `FormApplication`, and legacy Actor/Item sheet usage is handled by `migrate-ui-to-application-v2`.
- Legacy `template.json` system data definitions are handled by `adopt-typed-system-data-models`.

No other system-originated compatibility warning is allowlisted. In particular, Version 14 runtime code must not use legacy Active Effect changes or numeric modes, `renderChatMessage`, `core.rollMode`, `ChatMessage#applyRollMode`, or singular combatant-by-token lookup outside the explicit Version 13 compatibility adapters.

## Migration behavior

On first Version 14 launch, the active GM client migrates effects on world Actors and Items, embedded Items, unlinked token Actors, and writable world compendiums. The system logs migrated, skipped, failed, and locked-pack entries. The migration checkpoint advances only when writable content has no failures. Locked and external compendiums are reported and never force-unlocked.

If migration reports a failure:

1. Keep the pre-upgrade backup untouched.
2. Copy the failing document UUID and reason from the browser console.
3. Correct or remove only the malformed effect in another disposable copy.
4. Restart the world; successful documents are skipped and failed documents are retried.

See the local harness instructions in `playwright/README.md` for the two-generation validation matrix, migrated-world comparison, and temporary multi-client checks.

## Managed item effects

Every carrier item (weapon, armour, gear, ship weapon, ship attachment) owns two Active Effects
that the system keeps in step with the item's data: `(inherent)` holds what the item itself grants
(armour soak and defence, a ship attachment's hard points) and `(mods)` holds what its qualities,
attachment base mods and installed modifications grant, each multiplied by rank. Both are flagged
`flags.starwarsffg.managed`. They are rebuilt by `syncManagedEffects` (`modules/helpers/item-effects.js`)
whenever the item is created or its system data changes; nothing else should write them, and
nothing should write their `disabled` flag (edit mode suspends and restores it).

Whether the effects apply is decided when they are applied: `ActiveEffectFFG.shouldApplyChange`
(Version 14) and `apply` (Version 13) refuse changes from a stowed item, or an unequipped weapon,
armour or ship weapon. The effects therefore always describe what the item would grant.
Armour does not stack: of the armour an actor wears, the same gate lets only the piece with the
highest soak grant soak and only the piece with the highest defence grant defence (judged
separately; ties go to the first in the inventory). A weapon or armour stat modifier that does not
fit its carrier (a Superior quality's soak on a weapon) is dropped by the computation rather than
written as an actor change.

Effects named after a modifier attribute (`attr…`), and the `Superior` effect the companion
importer used to synthesise, belong to the previous pipeline and are deleted by the sync. Hand-made
effects with other names are left alone. `game.ffg.ItemEffects.rebuildWorld()` rebuilds every
carrier in the world and reports which actors' stats changed.
