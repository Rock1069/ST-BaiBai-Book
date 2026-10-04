# Third-party notices

## BS BioTracker

- Project: BS BioTracker v1.0.0
- Author: Liuuuu54
- Source: https://github.com/Liuuuu54/st_bs_biotracker
- License: Apache License, Version 2.0, included at `licenses/BS-BioTracker-Apache-2.0.txt`.

`src/memory/physiology.ts` adapts the pregnancy stage thresholds (98 / 196 / 259 / 280 days) from BS BioTracker's `scripts/stage_config.js`.

Modifications: rewritten in TypeScript for deterministic replay of BaiBai Book message deltas; configurable pregnancy length, manually enabled profiles, cycle tracking from menstruation day 1, simplified RP body needs, factual evidence validation and integration with existing summary/injection/UI. The original plugin entry point, independent API/polling loop, storage model and reproductive simulation engine are not included.
