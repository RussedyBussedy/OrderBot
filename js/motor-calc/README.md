# js/motor-calc

`engine.js` and `builders.js` are the roller-blind torque and battery calculation of the "motor-calc" pack, which is written and kept outside this repository. Their **code is the pack's, line for line**. Only a few comment lines are worded differently here (Russel, 13 November 2026).

- **Don't edit the code here.** To change it, replace both files from a new pack, reword the same comment lines, and run the pack's own `selftest.mjs` against it. The regression test compares the two files with the pack's and lets only comment lines differ.
- **They hold no motor data.** The pack's data file and its reference cases must never be added to this repository: they are not published figures, and every file on `main` is public.
- OrderBot uses them through `js/roller-motor-calc.js`, which holds each BlindIQ roller motor's published datasheet figures. See `docs/roller-check.md`, "Torque and battery life".
