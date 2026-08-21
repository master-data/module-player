/**
 * The HVSC song-length database, keyed by the MD5 that `getTuneMd5()` returns.
 *
 * libsidplayfp ships `SidDatabase` for this, and it is deliberately not bound.
 * That class opens a *path*: in WebAssembly it would mean staging a file of
 * several megabytes into the virtual filesystem before a lookup that is, in the
 * end, a hash-keyed scan of text. Doing it here instead costs nothing in the
 * binary, behaves the same in a browser and in Node, and lets a caller parse
 * from a fetch response, a file read, or a string already in hand.
 *
 * The parsing follows `SidDatabase.cpp` exactly, including the parts that look
 * like quirks:
 *
 *   - `M:SS`, `M:SS.d`, `M:SS.dd` and `M:SS.ddd` are all valid, and the
 *     fractional part is scaled by its digit count — `.5` is 500 ms, not 5.
 *   - Anything trailing a time up to the next space is ignored, which is what
 *     lets HVSC's `(F)` and similar annotations sit in the file.
 *   - Minutes are not capped at 59: `90:00` is a legitimate 90 minutes.
 *
 * @example
 * ```ts
 * const db = SonglengthDatabase.parse(await (await fetch("/Songlengths.md5")).text());
 * const seconds = db.lengthSeconds(await player.getTuneMd5(), 1);
 * ```
 */
export declare class SonglengthDatabase {
    #private;
    private constructor();
    /** How many tunes the database describes. */
    get size(): number;
    /**
     * Parse a `Songlengths.md5` file.
     *
     * Malformed lines are skipped rather than thrown: the database is a
     * community-maintained text file of tens of thousands of lines, and one bad
     * entry should cost you that entry, not the other 60,000.
     */
    static parse(text: string): SonglengthDatabase;
    /**
     * Length of one song in milliseconds, or `null` when the tune is absent or
     * has no entry for that song.
     *
     * `song` is 1-based, matching `SidTuneInfo::currentSong()` and libsidplayfp's
     * own `SidDatabase::length`, so a caller can pass `getTuneInfo().currentSong`
     * straight through.
     */
    lengthMs(md5: string, song?: number): number | null;
    /** As {@link lengthMs}, in seconds. */
    lengthSeconds(md5: string, song?: number): number | null;
    /** Every song length for one tune, in milliseconds, or `null` if absent. */
    lengthsMs(md5: string): readonly number[] | null;
    /** Whether the database has an entry for this tune. */
    has(md5: string): boolean;
}
//# sourceMappingURL=songlengths.d.ts.map