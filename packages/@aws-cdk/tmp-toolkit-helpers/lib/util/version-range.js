"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rangeFromSemver = rangeFromSemver;
const semver = require("semver");
const toolkit_error_1 = require("../api/toolkit-error");
function rangeFromSemver(ver, targetType) {
    const re = ver.match(/^([^\d]*)([\d.]*)$/);
    if (!re || !semver.valid(re[2])) {
        throw new toolkit_error_1.ToolkitError('not a semver or unsupported range syntax');
    }
    const prefixPart = re[1];
    const verPart = re[2];
    switch (targetType) {
        case 'bracket':
            switch (prefixPart) {
                case '':
                    // if there's no prefix and the remaining is a valid semver, there's no range specified
                    return ver;
                case '^':
                    return `[${verPart},${semver.major(verPart) + 1}.0.0)`;
                default:
                    throw new toolkit_error_1.ToolkitError(`unsupported range syntax - ${prefixPart}`);
            }
        case 'pep':
            switch (prefixPart) {
                case '':
                    // if there's no prefix and the remaining is a valid semver, there's no range specified
                    return `==${ver}`;
                case '^':
                    return `>=${verPart},<${semver.major(verPart) + 1}.0.0`;
                default:
                    throw new toolkit_error_1.ToolkitError(`unsupported range syntax - ${prefixPart}`);
            }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVyc2lvbi1yYW5nZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlsL3ZlcnNpb24tcmFuZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFPQSwwQ0E4QkM7QUFyQ0QsaUNBQWlDO0FBQ2pDLHdEQUFvRDtBQU1wRCxTQUFnQixlQUFlLENBQUMsR0FBVyxFQUFFLFVBQXFCO0lBQ2hFLE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQztJQUMzQyxJQUFJLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ2hDLE1BQU0sSUFBSSw0QkFBWSxDQUFDLDBDQUEwQyxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUNELE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN6QixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFdEIsUUFBUSxVQUFVLEVBQUUsQ0FBQztRQUNuQixLQUFLLFNBQVM7WUFDWixRQUFRLFVBQVUsRUFBRSxDQUFDO2dCQUNuQixLQUFLLEVBQUU7b0JBQ0wsdUZBQXVGO29CQUN2RixPQUFPLEdBQUcsQ0FBQztnQkFDYixLQUFLLEdBQUc7b0JBQ04sT0FBTyxJQUFJLE9BQU8sSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFDLENBQUMsT0FBTyxDQUFDO2dCQUN2RDtvQkFDRSxNQUFNLElBQUksNEJBQVksQ0FBQyw4QkFBOEIsVUFBVSxFQUFFLENBQUMsQ0FBQztZQUN2RSxDQUFDO1FBQ0gsS0FBSyxLQUFLO1lBQ1IsUUFBUSxVQUFVLEVBQUUsQ0FBQztnQkFDbkIsS0FBSyxFQUFFO29CQUNMLHVGQUF1RjtvQkFDdkYsT0FBTyxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUNwQixLQUFLLEdBQUc7b0JBQ04sT0FBTyxLQUFLLE9BQU8sS0FBSyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFDLENBQUMsTUFBTSxDQUFDO2dCQUN4RDtvQkFDRSxNQUFNLElBQUksNEJBQVksQ0FBQyw4QkFBOEIsVUFBVSxFQUFFLENBQUMsQ0FBQztZQUN2RSxDQUFDO0lBQ0wsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBzZW12ZXIgZnJvbSAnc2VtdmVyJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uL2FwaS90b29sa2l0LWVycm9yJztcblxuLy8gYnJhY2tldCAtIGh0dHBzOi8vZG9jcy5vcmFjbGUuY29tL21pZGRsZXdhcmUvMTIxMi9jb3JlL01BVkVOL21hdmVuX3ZlcnNpb24uaHRtI01BVkVONDAxXG4vLyBwZXAgLSBodHRwczovL3d3dy5weXRob24ub3JnL2Rldi9wZXBzL3BlcC0wNDQwLyN2ZXJzaW9uLXNwZWNpZmllcnNcbmV4cG9ydCB0eXBlIFJhbmdlVHlwZSA9ICdicmFja2V0JyB8ICdwZXAnXG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZUZyb21TZW12ZXIodmVyOiBzdHJpbmcsIHRhcmdldFR5cGU6IFJhbmdlVHlwZSkge1xuICBjb25zdCByZSA9IHZlci5tYXRjaCgvXihbXlxcZF0qKShbXFxkLl0qKSQvKTtcbiAgaWYgKCFyZSB8fCAhc2VtdmVyLnZhbGlkKHJlWzJdKSkge1xuICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJ25vdCBhIHNlbXZlciBvciB1bnN1cHBvcnRlZCByYW5nZSBzeW50YXgnKTtcbiAgfVxuICBjb25zdCBwcmVmaXhQYXJ0ID0gcmVbMV07XG4gIGNvbnN0IHZlclBhcnQgPSByZVsyXTtcblxuICBzd2l0Y2ggKHRhcmdldFR5cGUpIHtcbiAgICBjYXNlICdicmFja2V0JzpcbiAgICAgIHN3aXRjaCAocHJlZml4UGFydCkge1xuICAgICAgICBjYXNlICcnOlxuICAgICAgICAgIC8vIGlmIHRoZXJlJ3Mgbm8gcHJlZml4IGFuZCB0aGUgcmVtYWluaW5nIGlzIGEgdmFsaWQgc2VtdmVyLCB0aGVyZSdzIG5vIHJhbmdlIHNwZWNpZmllZFxuICAgICAgICAgIHJldHVybiB2ZXI7XG4gICAgICAgIGNhc2UgJ14nOlxuICAgICAgICAgIHJldHVybiBgWyR7dmVyUGFydH0sJHtzZW12ZXIubWFqb3IodmVyUGFydCkrMX0uMC4wKWA7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgdW5zdXBwb3J0ZWQgcmFuZ2Ugc3ludGF4IC0gJHtwcmVmaXhQYXJ0fWApO1xuICAgICAgfVxuICAgIGNhc2UgJ3BlcCc6XG4gICAgICBzd2l0Y2ggKHByZWZpeFBhcnQpIHtcbiAgICAgICAgY2FzZSAnJzpcbiAgICAgICAgICAvLyBpZiB0aGVyZSdzIG5vIHByZWZpeCBhbmQgdGhlIHJlbWFpbmluZyBpcyBhIHZhbGlkIHNlbXZlciwgdGhlcmUncyBubyByYW5nZSBzcGVjaWZpZWRcbiAgICAgICAgICByZXR1cm4gYD09JHt2ZXJ9YDtcbiAgICAgICAgY2FzZSAnXic6XG4gICAgICAgICAgcmV0dXJuIGA+PSR7dmVyUGFydH0sPCR7c2VtdmVyLm1ham9yKHZlclBhcnQpKzF9LjAuMGA7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgdW5zdXBwb3J0ZWQgcmFuZ2Ugc3ludGF4IC0gJHtwcmVmaXhQYXJ0fWApO1xuICAgICAgfVxuICB9XG59XG4iXX0=