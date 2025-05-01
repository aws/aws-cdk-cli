"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBytes = formatBytes;
/**
 * Format bytes as a human readable string
 *
 * @param bytes Number of bytes to format
 * @param decimals Number of decimal places to show (default 2)
 * @returns Formatted string with appropriate unit suffix
 */
function formatBytes(bytes, decimals = 2) {
    decimals = decimals < 0 ? 0 : decimals;
    if (bytes === 0) {
        return '0 Bytes';
    }
    const k = 1024;
    const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnl0ZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdXRpbC9ieXRlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQU9BLGtDQWFDO0FBcEJEOzs7Ozs7R0FNRztBQUNILFNBQWdCLFdBQVcsQ0FBQyxLQUFhLEVBQUUsV0FBbUIsQ0FBQztJQUM3RCxRQUFRLEdBQUcsUUFBUSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7SUFFdkMsSUFBSSxLQUFLLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDaEIsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQztJQUNmLE1BQU0sS0FBSyxHQUFHLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztJQUVoRixNQUFNLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXBELE9BQU8sR0FBRyxVQUFVLENBQUMsQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztBQUNqRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBGb3JtYXQgYnl0ZXMgYXMgYSBodW1hbiByZWFkYWJsZSBzdHJpbmdcbiAqXG4gKiBAcGFyYW0gYnl0ZXMgTnVtYmVyIG9mIGJ5dGVzIHRvIGZvcm1hdFxuICogQHBhcmFtIGRlY2ltYWxzIE51bWJlciBvZiBkZWNpbWFsIHBsYWNlcyB0byBzaG93IChkZWZhdWx0IDIpXG4gKiBAcmV0dXJucyBGb3JtYXR0ZWQgc3RyaW5nIHdpdGggYXBwcm9wcmlhdGUgdW5pdCBzdWZmaXhcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEJ5dGVzKGJ5dGVzOiBudW1iZXIsIGRlY2ltYWxzOiBudW1iZXIgPSAyKTogc3RyaW5nIHtcbiAgZGVjaW1hbHMgPSBkZWNpbWFscyA8IDAgPyAwIDogZGVjaW1hbHM7XG5cbiAgaWYgKGJ5dGVzID09PSAwKSB7XG4gICAgcmV0dXJuICcwIEJ5dGVzJztcbiAgfVxuXG4gIGNvbnN0IGsgPSAxMDI0O1xuICBjb25zdCBzaXplcyA9IFsnQnl0ZXMnLCAnS2lCJywgJ01pQicsICdHaUInLCAnVGlCJywgJ1BpQicsICdFaUInLCAnWmlCJywgJ1lpQiddO1xuXG4gIGNvbnN0IGkgPSBNYXRoLmZsb29yKE1hdGgubG9nKGJ5dGVzKSAvIE1hdGgubG9nKGspKTtcblxuICByZXR1cm4gYCR7cGFyc2VGbG9hdCgoYnl0ZXMgLyBNYXRoLnBvdyhrLCBpKSkudG9GaXhlZChkZWNpbWFscykpfSAke3NpemVzW2ldfWA7XG59XG4iXX0=