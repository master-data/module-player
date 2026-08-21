# Fixtures

`test-tone-c4.sid` is a minimal PSID that gates voice 1 on a single sustained
note and nothing else. It exists so that a test has something to play whose
correct output is knowable from first principles rather than from a recording:
the tune writes frequency register `4414`, and the SID's oscillator is
`register * clock / 2^24`, so at the PAL clock it must sound at 259.21 Hz.

That is roughly 0.9% flat of concert C4 (261.63 Hz) — the register is an
integer, and 4455 would have been the closer choice. The name records the
intent; the register records the fact.

It is published with the package because consumers were otherwise resolving it
from a path inside this repository, which breaks the moment the layout changes.

```ts
import { fileURLToPath } from "node:url";
const tone = fileURLToPath(import.meta.resolve("libsidplayfp-wasm/fixtures/test-tone-c4.sid"));
```
