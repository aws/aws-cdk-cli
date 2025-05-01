"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RewritableBlock = void 0;
// namespace object imports won't work in the bundle for function exports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wrapAnsi = require('wrap-ansi');
/**
 * A class representing rewritable display lines
 */
class RewritableBlock {
    stream;
    lastHeight = 0;
    trailingEmptyLines = 0;
    constructor(stream) {
        this.stream = stream;
    }
    get width() {
        // Might get changed if the user resizes the terminal
        return this.stream.columns;
    }
    get height() {
        // Might get changed if the user resizes the terminal
        return this.stream.rows;
    }
    displayLines(lines) {
        lines = terminalWrap(this.width, expandNewlines(lines));
        lines = lines.slice(0, getMaxBlockHeight(this.height, this.lastHeight, lines));
        this.stream.write(cursorUp(this.lastHeight));
        for (const line of lines) {
            this.stream.write(cll() + line + '\n');
        }
        this.trailingEmptyLines = Math.max(0, this.lastHeight - lines.length);
        // Clear remainder of unwritten lines
        for (let i = 0; i < this.trailingEmptyLines; i++) {
            this.stream.write(cll() + '\n');
        }
        // The block can only ever get bigger
        this.lastHeight = Math.max(this.lastHeight, lines.length);
    }
    removeEmptyLines() {
        this.stream.write(cursorUp(this.trailingEmptyLines));
    }
}
exports.RewritableBlock = RewritableBlock;
const ESC = '\u001b';
/*
 * Move cursor up `n` lines. Default is 1
 */
function cursorUp(n) {
    n = typeof n === 'number' ? n : 1;
    return n > 0 ? ESC + '[' + n + 'A' : '';
}
/**
 * Clear to end of line
 */
function cll() {
    return ESC + '[K';
}
function terminalWrap(width, lines) {
    if (width === undefined) {
        return lines;
    }
    return lines.flatMap(line => wrapAnsi(line, width - 1, {
        hard: true,
        trim: true,
        wordWrap: false,
    }).split('\n'));
}
/**
 * Make sure there are no hidden newlines in the gin strings
 */
function expandNewlines(lines) {
    return lines.flatMap(line => line.split('\n'));
}
function getMaxBlockHeight(windowHeight, lastHeight, lines) {
    if (windowHeight === undefined) {
        return Math.max(lines.length, lastHeight);
    }
    return lines.length < windowHeight ? lines.length : windowHeight - 1;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGxheS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9wcml2YXRlL2FjdGl2aXR5LXByaW50ZXIvZGlzcGxheS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5RUFBeUU7QUFDekUsaUVBQWlFO0FBQ2pFLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUV0Qzs7R0FFRztBQUNILE1BQWEsZUFBZTtJQUlHO0lBSHJCLFVBQVUsR0FBRyxDQUFDLENBQUM7SUFDZixrQkFBa0IsR0FBRyxDQUFDLENBQUM7SUFFL0IsWUFBNkIsTUFBMEI7UUFBMUIsV0FBTSxHQUFOLE1BQU0sQ0FBb0I7SUFDdkQsQ0FBQztJQUVELElBQVcsS0FBSztRQUNkLHFEQUFxRDtRQUNyRCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDO0lBQzdCLENBQUM7SUFFRCxJQUFXLE1BQU07UUFDZixxREFBcUQ7UUFDckQsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztJQUMxQixDQUFDO0lBRU0sWUFBWSxDQUFDLEtBQWU7UUFDakMsS0FBSyxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQ3hELEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUUvRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7UUFDN0MsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDekMsQ0FBQztRQUVELElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUV0RSxxQ0FBcUM7UUFDckMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDO1FBQ2xDLENBQUM7UUFFRCxxQ0FBcUM7UUFDckMsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFTSxnQkFBZ0I7UUFDckIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUM7SUFDdkQsQ0FBQztDQUNGO0FBeENELDBDQXdDQztBQUVELE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQztBQUVyQjs7R0FFRztBQUNILFNBQVMsUUFBUSxDQUFDLENBQVM7SUFDekIsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztBQUMxQyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLEdBQUc7SUFDVixPQUFPLEdBQUcsR0FBRyxJQUFJLENBQUM7QUFDcEIsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLEtBQXlCLEVBQUUsS0FBZTtJQUM5RCxJQUFJLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUN4QixPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUssR0FBRyxDQUFDLEVBQUU7UUFDckQsSUFBSSxFQUFFLElBQUk7UUFDVixJQUFJLEVBQUUsSUFBSTtRQUNWLFFBQVEsRUFBRSxLQUFLO0tBQ2hCLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNsQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLGNBQWMsQ0FBQyxLQUFlO0lBQ3JDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNqRCxDQUFDO0FBRUQsU0FBUyxpQkFBaUIsQ0FBQyxZQUFnQyxFQUFFLFVBQWtCLEVBQUUsS0FBZTtJQUM5RixJQUFJLFlBQVksS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMvQixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxVQUFVLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBQ0QsT0FBTyxLQUFLLENBQUMsTUFBTSxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQztBQUN2RSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gbmFtZXNwYWNlIG9iamVjdCBpbXBvcnRzIHdvbid0IHdvcmsgaW4gdGhlIGJ1bmRsZSBmb3IgZnVuY3Rpb24gZXhwb3J0c1xuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHNcbmNvbnN0IHdyYXBBbnNpID0gcmVxdWlyZSgnd3JhcC1hbnNpJyk7XG5cbi8qKlxuICogQSBjbGFzcyByZXByZXNlbnRpbmcgcmV3cml0YWJsZSBkaXNwbGF5IGxpbmVzXG4gKi9cbmV4cG9ydCBjbGFzcyBSZXdyaXRhYmxlQmxvY2sge1xuICBwcml2YXRlIGxhc3RIZWlnaHQgPSAwO1xuICBwcml2YXRlIHRyYWlsaW5nRW1wdHlMaW5lcyA9IDA7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBzdHJlYW06IE5vZGVKUy5Xcml0ZVN0cmVhbSkge1xuICB9XG5cbiAgcHVibGljIGdldCB3aWR0aCgpIHtcbiAgICAvLyBNaWdodCBnZXQgY2hhbmdlZCBpZiB0aGUgdXNlciByZXNpemVzIHRoZSB0ZXJtaW5hbFxuICAgIHJldHVybiB0aGlzLnN0cmVhbS5jb2x1bW5zO1xuICB9XG5cbiAgcHVibGljIGdldCBoZWlnaHQoKSB7XG4gICAgLy8gTWlnaHQgZ2V0IGNoYW5nZWQgaWYgdGhlIHVzZXIgcmVzaXplcyB0aGUgdGVybWluYWxcbiAgICByZXR1cm4gdGhpcy5zdHJlYW0ucm93cztcbiAgfVxuXG4gIHB1YmxpYyBkaXNwbGF5TGluZXMobGluZXM6IHN0cmluZ1tdKSB7XG4gICAgbGluZXMgPSB0ZXJtaW5hbFdyYXAodGhpcy53aWR0aCwgZXhwYW5kTmV3bGluZXMobGluZXMpKTtcbiAgICBsaW5lcyA9IGxpbmVzLnNsaWNlKDAsIGdldE1heEJsb2NrSGVpZ2h0KHRoaXMuaGVpZ2h0LCB0aGlzLmxhc3RIZWlnaHQsIGxpbmVzKSk7XG5cbiAgICB0aGlzLnN0cmVhbS53cml0ZShjdXJzb3JVcCh0aGlzLmxhc3RIZWlnaHQpKTtcbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgIHRoaXMuc3RyZWFtLndyaXRlKGNsbCgpICsgbGluZSArICdcXG4nKTtcbiAgICB9XG5cbiAgICB0aGlzLnRyYWlsaW5nRW1wdHlMaW5lcyA9IE1hdGgubWF4KDAsIHRoaXMubGFzdEhlaWdodCAtIGxpbmVzLmxlbmd0aCk7XG5cbiAgICAvLyBDbGVhciByZW1haW5kZXIgb2YgdW53cml0dGVuIGxpbmVzXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnRyYWlsaW5nRW1wdHlMaW5lczsgaSsrKSB7XG4gICAgICB0aGlzLnN0cmVhbS53cml0ZShjbGwoKSArICdcXG4nKTtcbiAgICB9XG5cbiAgICAvLyBUaGUgYmxvY2sgY2FuIG9ubHkgZXZlciBnZXQgYmlnZ2VyXG4gICAgdGhpcy5sYXN0SGVpZ2h0ID0gTWF0aC5tYXgodGhpcy5sYXN0SGVpZ2h0LCBsaW5lcy5sZW5ndGgpO1xuICB9XG5cbiAgcHVibGljIHJlbW92ZUVtcHR5TGluZXMoKSB7XG4gICAgdGhpcy5zdHJlYW0ud3JpdGUoY3Vyc29yVXAodGhpcy50cmFpbGluZ0VtcHR5TGluZXMpKTtcbiAgfVxufVxuXG5jb25zdCBFU0MgPSAnXFx1MDAxYic7XG5cbi8qXG4gKiBNb3ZlIGN1cnNvciB1cCBgbmAgbGluZXMuIERlZmF1bHQgaXMgMVxuICovXG5mdW5jdGlvbiBjdXJzb3JVcChuOiBudW1iZXIpIHtcbiAgbiA9IHR5cGVvZiBuID09PSAnbnVtYmVyJyA/IG4gOiAxO1xuICByZXR1cm4gbiA+IDAgPyBFU0MgKyAnWycgKyBuICsgJ0EnIDogJyc7XG59XG5cbi8qKlxuICogQ2xlYXIgdG8gZW5kIG9mIGxpbmVcbiAqL1xuZnVuY3Rpb24gY2xsKCkge1xuICByZXR1cm4gRVNDICsgJ1tLJztcbn1cblxuZnVuY3Rpb24gdGVybWluYWxXcmFwKHdpZHRoOiBudW1iZXIgfCB1bmRlZmluZWQsIGxpbmVzOiBzdHJpbmdbXSkge1xuICBpZiAod2lkdGggPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBsaW5lcztcbiAgfVxuXG4gIHJldHVybiBsaW5lcy5mbGF0TWFwKGxpbmUgPT4gd3JhcEFuc2kobGluZSwgd2lkdGggLSAxLCB7XG4gICAgaGFyZDogdHJ1ZSxcbiAgICB0cmltOiB0cnVlLFxuICAgIHdvcmRXcmFwOiBmYWxzZSxcbiAgfSkuc3BsaXQoJ1xcbicpKTtcbn1cblxuLyoqXG4gKiBNYWtlIHN1cmUgdGhlcmUgYXJlIG5vIGhpZGRlbiBuZXdsaW5lcyBpbiB0aGUgZ2luIHN0cmluZ3NcbiAqL1xuZnVuY3Rpb24gZXhwYW5kTmV3bGluZXMobGluZXM6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICByZXR1cm4gbGluZXMuZmxhdE1hcChsaW5lID0+IGxpbmUuc3BsaXQoJ1xcbicpKTtcbn1cblxuZnVuY3Rpb24gZ2V0TWF4QmxvY2tIZWlnaHQod2luZG93SGVpZ2h0OiBudW1iZXIgfCB1bmRlZmluZWQsIGxhc3RIZWlnaHQ6IG51bWJlciwgbGluZXM6IHN0cmluZ1tdKTogbnVtYmVyIHtcbiAgaWYgKHdpbmRvd0hlaWdodCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIE1hdGgubWF4KGxpbmVzLmxlbmd0aCwgbGFzdEhlaWdodCk7XG4gIH1cbiAgcmV0dXJuIGxpbmVzLmxlbmd0aCA8IHdpbmRvd0hlaWdodCA/IGxpbmVzLmxlbmd0aCA6IHdpbmRvd0hlaWdodCAtIDE7XG59XG4iXX0=