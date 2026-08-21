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
export class SonglengthDatabase {
    /** Lowercased MD5 to the per-song lengths, in milliseconds. */
    #entries;
    constructor(entries) {
        this.#entries = entries;
    }
    /** How many tunes the database describes. */
    get size() {
        return this.#entries.size;
    }
    /**
     * Parse a `Songlengths.md5` file.
     *
     * Malformed lines are skipped rather than thrown: the database is a
     * community-maintained text file of tens of thousands of lines, and one bad
     * entry should cost you that entry, not the other 60,000.
     */
    static parse(text) {
        const entries = new Map();
        for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.trim();
            // Comments, blank lines, and the `[Database]` section header.
            if (line.length === 0 || line.startsWith(";") || line.startsWith("["))
                continue;
            const separator = line.indexOf("=");
            if (separator <= 0)
                continue;
            const md5 = line.slice(0, separator).trim().toLowerCase();
            if (!/^[0-9a-f]{32}$/.test(md5))
                continue;
            const lengths = [];
            let malformed = false;
            for (const field of line.slice(separator + 1).trim().split(/\s+/)) {
                if (field.length === 0)
                    continue;
                const milliseconds = parseTimeMs(field);
                if (milliseconds === null) {
                    malformed = true;
                    break;
                }
                lengths.push(milliseconds);
            }
            if (malformed || lengths.length === 0)
                continue;
            entries.set(md5, lengths);
        }
        return new SonglengthDatabase(entries);
    }
    /**
     * Length of one song in milliseconds, or `null` when the tune is absent or
     * has no entry for that song.
     *
     * `song` is 1-based, matching `SidTuneInfo::currentSong()` and libsidplayfp's
     * own `SidDatabase::length`, so a caller can pass `getTuneInfo().currentSong`
     * straight through.
     */
    lengthMs(md5, song = 1) {
        const lengths = this.#entries.get(md5.trim().toLowerCase());
        if (!lengths)
            return null;
        if (!Number.isInteger(song) || song < 1 || song > lengths.length)
            return null;
        return lengths[song - 1] ?? null;
    }
    /** As {@link lengthMs}, in seconds. */
    lengthSeconds(md5, song = 1) {
        const milliseconds = this.lengthMs(md5, song);
        return milliseconds === null ? null : milliseconds / 1000;
    }
    /** Every song length for one tune, in milliseconds, or `null` if absent. */
    lengthsMs(md5) {
        return this.#entries.get(md5.trim().toLowerCase()) ?? null;
    }
    /** Whether the database has an entry for this tune. */
    has(md5) {
        return this.#entries.has(md5.trim().toLowerCase());
    }
}
/**
 * `M:SS[.d[d[d]]]` to milliseconds, or `null` if the field is not a time.
 *
 * Mirrors `parseTime` in libsidplayfp's `SidDatabase.cpp`, including scaling the
 * fraction by how many digits were written and ignoring whatever follows the
 * time up to the next space.
 */
function parseTimeMs(field) {
    // The fraction is captured greedily on purpose. Upstream treats a run of
    // more than three digits as a parse error, so matching only the first three
    // would silently accept `1:00.9999` as `1:00.999`.
    const match = /^(\d+):(\d+)(?:\.(\d+))?/.exec(field);
    if (!match)
        return null;
    // `1:00.` is rejected, not read as `1:00`. Upstream commits to reading a
    // fraction the moment it sees the dot and treats "no digits after it" as a
    // parse error, so accepting it here would be more permissive than the
    // library this mirrors.
    if (match[3] === undefined && field.charAt(match[0].length) === ".")
        return null;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    let milliseconds = 0;
    if (match[3] !== undefined) {
        if (match[3].length > 3)
            return null;
        // ".5" is five hundred milliseconds, ".05" is fifty: the value scales by
        // how many digits were written, exactly as upstream does it.
        milliseconds = Number(match[3]) * [100, 10, 1][match[3].length - 1];
    }
    return (minutes * 60 + seconds) * 1000 + milliseconds;
}
//# sourceMappingURL=songlengths.js.map