# Quest Data Notes

This file records maintainer-facing decisions for curated quest requirements. It is not displayed in the app.

## Frigost craft quests 581 and 582

Date: 2026-07-09

Quests:

- `581` - `Hôtel de glace`
- `582` - `La fonte des glaces`

Decision:

- Use the DofusDB `need.items` values for the quest requirements.
- Do not flatten these quests to the raw ingredients listed by DPLN-style walkthroughs.

Reason:

These quests ask the player to craft specific intermediate quest items. The raw ingredients are useful for the craft plan, but they are not the direct items requested by the quest. Keeping the DofusDB requirements preserves the visible quest target, while QuestPlanner can still decompose each craft through local recipes.

DofusDB values confirmed:

- `581`: `5 x 11279`, `5 x 11280`, `5 x 11281`, `5 x 11282`
- `582`: `1 x 11292`, `1 x 11293`, `1 x 11294`, `1 x 11295`, with prerequisite quest `581`

All eight target items have local recipes, so craft decomposition remains available.
