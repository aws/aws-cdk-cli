"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseStackAssembly = exports.ExtendedStackSelection = void 0;
const chalk = require("chalk");
const minimatch_1 = require("minimatch");
const stack_collection_1 = require("./stack-collection");
const util_1 = require("../../util");
const private_1 = require("../io/private");
/**
 * When selecting stacks, what other stacks to include because of dependencies
 */
var ExtendedStackSelection;
(function (ExtendedStackSelection) {
    /**
     * Don't select any extra stacks
     */
    ExtendedStackSelection[ExtendedStackSelection["None"] = 0] = "None";
    /**
     * Include stacks that this stack depends on
     */
    ExtendedStackSelection[ExtendedStackSelection["Upstream"] = 1] = "Upstream";
    /**
     * Include stacks that depend on this stack
     */
    ExtendedStackSelection[ExtendedStackSelection["Downstream"] = 2] = "Downstream";
})(ExtendedStackSelection || (exports.ExtendedStackSelection = ExtendedStackSelection = {}));
/**
 * A single Cloud Assembly and the operations we do on it to deploy the artifacts inside
 */
class BaseStackAssembly {
    assembly;
    /**
     * Sanitize a list of stack match patterns
     */
    static sanitizePatterns(patterns) {
        let sanitized = patterns.filter(s => s != null); // filter null/undefined
        sanitized = [...new Set(sanitized)]; // make them unique
        return sanitized;
    }
    /**
     * The directory this CloudAssembly was read from
     */
    directory;
    /**
     * The IoHelper used for messaging
     */
    ioHelper;
    constructor(assembly, ioHelper) {
        this.assembly = assembly;
        this.directory = assembly.directory;
        this.ioHelper = ioHelper;
    }
    /**
     * Select a single stack by its ID
     */
    stackById(stackId) {
        return new stack_collection_1.StackCollection(this, [this.assembly.getStackArtifact(stackId)]);
    }
    async selectMatchingStacks(stacks, patterns, extend = ExtendedStackSelection.None) {
        const matchingPattern = (pattern) => (stack) => (0, minimatch_1.minimatch)(stack.hierarchicalId, pattern);
        const matchedStacks = (0, util_1.flatten)(patterns.map(pattern => stacks.filter(matchingPattern(pattern))));
        return this.extendStacks(matchedStacks, stacks, extend);
    }
    async extendStacks(matched, all, extend = ExtendedStackSelection.None) {
        const allStacks = new Map();
        for (const stack of all) {
            allStacks.set(stack.hierarchicalId, stack);
        }
        const index = indexByHierarchicalId(matched);
        switch (extend) {
            case ExtendedStackSelection.Downstream:
                await includeDownstreamStacks(this.ioHelper, index, allStacks);
                break;
            case ExtendedStackSelection.Upstream:
                await includeUpstreamStacks(this.ioHelper, index, allStacks);
                break;
        }
        // Filter original array because it is in the right order
        const selectedList = all.filter(s => index.has(s.hierarchicalId));
        return new stack_collection_1.StackCollection(this, selectedList);
    }
}
exports.BaseStackAssembly = BaseStackAssembly;
function indexByHierarchicalId(stacks) {
    const result = new Map();
    for (const stack of stacks) {
        result.set(stack.hierarchicalId, stack);
    }
    return result;
}
/**
 * Calculate the transitive closure of stack dependents.
 *
 * Modifies `selectedStacks` in-place.
 */
async function includeDownstreamStacks(ioHelper, selectedStacks, allStacks) {
    const added = new Array();
    let madeProgress;
    do {
        madeProgress = false;
        for (const [id, stack] of allStacks) {
            // Select this stack if it's not selected yet AND it depends on a stack that's in the selected set
            if (!selectedStacks.has(id) && (stack.dependencies || []).some(dep => selectedStacks.has(dep.id))) {
                selectedStacks.set(id, stack);
                added.push(id);
                madeProgress = true;
            }
        }
    } while (madeProgress);
    if (added.length > 0) {
        await ioHelper.notify(private_1.IO.DEFAULT_ASSEMBLY_INFO.msg(`Including depending stacks: ${chalk.bold(added.join(', '))}`));
    }
}
/**
 * Calculate the transitive closure of stack dependencies.
 *
 * Modifies `selectedStacks` in-place.
 */
async function includeUpstreamStacks(ioHelper, selectedStacks, allStacks) {
    const added = new Array();
    let madeProgress = true;
    while (madeProgress) {
        madeProgress = false;
        for (const stack of selectedStacks.values()) {
            // Select an additional stack if it's not selected yet and a dependency of a selected stack (and exists, obviously)
            for (const dependencyId of stack.dependencies.map(x => x.manifest.displayName ?? x.id)) {
                if (!selectedStacks.has(dependencyId) && allStacks.has(dependencyId)) {
                    added.push(dependencyId);
                    selectedStacks.set(dependencyId, allStacks.get(dependencyId));
                    madeProgress = true;
                }
            }
        }
    }
    if (added.length > 0) {
        await ioHelper.notify(private_1.IO.DEFAULT_ASSEMBLY_INFO.msg(`Including dependency stacks: ${chalk.bold(added.join(', '))}`));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stYXNzZW1ibHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2Nsb3VkLWFzc2VtYmx5L3N0YWNrLWFzc2VtYmx5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLCtCQUErQjtBQUMvQix5Q0FBc0M7QUFDdEMseURBQXFEO0FBQ3JELHFDQUFxQztBQUNyQywyQ0FBbUM7QUFlbkM7O0dBRUc7QUFDSCxJQUFZLHNCQWVYO0FBZkQsV0FBWSxzQkFBc0I7SUFDaEM7O09BRUc7SUFDSCxtRUFBSSxDQUFBO0lBRUo7O09BRUc7SUFDSCwyRUFBUSxDQUFBO0lBRVI7O09BRUc7SUFDSCwrRUFBVSxDQUFBO0FBQ1osQ0FBQyxFQWZXLHNCQUFzQixzQ0FBdEIsc0JBQXNCLFFBZWpDO0FBRUQ7O0dBRUc7QUFDSCxNQUFzQixpQkFBaUI7SUFvQlQ7SUFuQjVCOztPQUVHO0lBQ08sTUFBTSxDQUFDLGdCQUFnQixDQUFDLFFBQWtCO1FBQ2xELElBQUksU0FBUyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyx3QkFBd0I7UUFDekUsU0FBUyxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsbUJBQW1CO1FBQ3hELE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRDs7T0FFRztJQUNhLFNBQVMsQ0FBUztJQUVsQzs7T0FFRztJQUNnQixRQUFRLENBQVc7SUFFdEMsWUFBNEIsUUFBNkIsRUFBRSxRQUFrQjtRQUFqRCxhQUFRLEdBQVIsUUFBUSxDQUFxQjtRQUN2RCxJQUFJLENBQUMsU0FBUyxHQUFHLFFBQVEsQ0FBQyxTQUFTLENBQUM7UUFDcEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7SUFDM0IsQ0FBQztJQUVEOztPQUVHO0lBQ0ksU0FBUyxDQUFDLE9BQWU7UUFD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QyxZQUFZLENBQUMsSUFBSSxTQUFTLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7b0JBQ3JFLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7b0JBQ3pCLGNBQWMsQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFFLENBQUMsQ0FBQztvQkFDL0QsWUFBWSxHQUFHLElBQUksQ0FBQztnQkFDdEIsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNyQixNQUFNLFFBQVEsQ0FBQyxNQUFNLENBQUMsWUFBRSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxnQ0FBZ0MsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDdEgsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgKiBhcyBjaGFsayBmcm9tICdjaGFsayc7XG5pbXBvcnQgeyBtaW5pbWF0Y2ggfSBmcm9tICdtaW5pbWF0Y2gnO1xuaW1wb3J0IHsgU3RhY2tDb2xsZWN0aW9uIH0gZnJvbSAnLi9zdGFjay1jb2xsZWN0aW9uJztcbmltcG9ydCB7IGZsYXR0ZW4gfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB7IElPIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgdHlwZSB7IElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZS9pby1oZWxwZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIElTdGFja0Fzc2VtYmx5IHtcbiAgLyoqXG4gICAqIFRoZSBkaXJlY3RvcnkgdGhpcyBDbG91ZEFzc2VtYmx5IHdhcyByZWFkIGZyb21cbiAgICovXG4gIGRpcmVjdG9yeTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBTZWxlY3QgYSBzaW5nbGUgc3RhY2sgYnkgaXRzIElEXG4gICAqL1xuICBzdGFja0J5SWQoc3RhY2tJZDogc3RyaW5nKTogU3RhY2tDb2xsZWN0aW9uO1xufVxuXG4vKipcbiAqIFdoZW4gc2VsZWN0aW5nIHN0YWNrcywgd2hhdCBvdGhlciBzdGFja3MgdG8gaW5jbHVkZSBiZWNhdXNlIG9mIGRlcGVuZGVuY2llc1xuICovXG5leHBvcnQgZW51bSBFeHRlbmRlZFN0YWNrU2VsZWN0aW9uIHtcbiAgLyoqXG4gICAqIERvbid0IHNlbGVjdCBhbnkgZXh0cmEgc3RhY2tzXG4gICAqL1xuICBOb25lLFxuXG4gIC8qKlxuICAgKiBJbmNsdWRlIHN0YWNrcyB0aGF0IHRoaXMgc3RhY2sgZGVwZW5kcyBvblxuICAgKi9cbiAgVXBzdHJlYW0sXG5cbiAgLyoqXG4gICAqIEluY2x1ZGUgc3RhY2tzIHRoYXQgZGVwZW5kIG9uIHRoaXMgc3RhY2tcbiAgICovXG4gIERvd25zdHJlYW0sXG59XG5cbi8qKlxuICogQSBzaW5nbGUgQ2xvdWQgQXNzZW1ibHkgYW5kIHRoZSBvcGVyYXRpb25zIHdlIGRvIG9uIGl0IHRvIGRlcGxveSB0aGUgYXJ0aWZhY3RzIGluc2lkZVxuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVN0YWNrQXNzZW1ibHkgaW1wbGVtZW50cyBJU3RhY2tBc3NlbWJseSB7XG4gIC8qKlxuICAgKiBTYW5pdGl6ZSBhIGxpc3Qgb2Ygc3RhY2sgbWF0Y2ggcGF0dGVybnNcbiAgICovXG4gIHByb3RlY3RlZCBzdGF0aWMgc2FuaXRpemVQYXR0ZXJucyhwYXR0ZXJuczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gICAgbGV0IHNhbml0aXplZCA9IHBhdHRlcm5zLmZpbHRlcihzID0+IHMgIT0gbnVsbCk7IC8vIGZpbHRlciBudWxsL3VuZGVmaW5lZFxuICAgIHNhbml0aXplZCA9IFsuLi5uZXcgU2V0KHNhbml0aXplZCldOyAvLyBtYWtlIHRoZW0gdW5pcXVlXG4gICAgcmV0dXJuIHNhbml0aXplZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgZGlyZWN0b3J5IHRoaXMgQ2xvdWRBc3NlbWJseSB3YXMgcmVhZCBmcm9tXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZGlyZWN0b3J5OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBJb0hlbHBlciB1c2VkIGZvciBtZXNzYWdpbmdcbiAgICovXG4gIHByb3RlY3RlZCByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IGFzc2VtYmx5OiBjeGFwaS5DbG91ZEFzc2VtYmx5LCBpb0hlbHBlcjogSW9IZWxwZXIpIHtcbiAgICB0aGlzLmRpcmVjdG9yeSA9IGFzc2VtYmx5LmRpcmVjdG9yeTtcbiAgICB0aGlzLmlvSGVscGVyID0gaW9IZWxwZXI7XG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0IGEgc2luZ2xlIHN0YWNrIGJ5IGl0cyBJRFxuICAgKi9cbiAgcHVibGljIHN0YWNrQnlJZChzdGFja0lkOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gbmV3IFN0YWNrQ29sbGVjdGlvbih0aGlzLCBbdGhpcy5hc3NlbWJseS5nZXRTdGFja0FydGlmYWN0KHN0YWNrSWQpXSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VsZWN0TWF0Y2hpbmdTdGFja3MoXG4gICAgc3RhY2tzOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3RbXSxcbiAgICBwYXR0ZXJuczogc3RyaW5nW10sXG4gICAgZXh0ZW5kOiBFeHRlbmRlZFN0YWNrU2VsZWN0aW9uID0gRXh0ZW5kZWRTdGFja1NlbGVjdGlvbi5Ob25lLFxuICApOiBQcm9taXNlPFN0YWNrQ29sbGVjdGlvbj4ge1xuICAgIGNvbnN0IG1hdGNoaW5nUGF0dGVybiA9IChwYXR0ZXJuOiBzdHJpbmcpID0+IChzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KSA9PiBtaW5pbWF0Y2goc3RhY2suaGllcmFyY2hpY2FsSWQsIHBhdHRlcm4pO1xuICAgIGNvbnN0IG1hdGNoZWRTdGFja3MgPSBmbGF0dGVuKHBhdHRlcm5zLm1hcChwYXR0ZXJuID0+IHN0YWNrcy5maWx0ZXIobWF0Y2hpbmdQYXR0ZXJuKHBhdHRlcm4pKSkpO1xuXG4gICAgcmV0dXJuIHRoaXMuZXh0ZW5kU3RhY2tzKG1hdGNoZWRTdGFja3MsIHN0YWNrcywgZXh0ZW5kKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBleHRlbmRTdGFja3MoXG4gICAgbWF0Y2hlZDogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0W10sXG4gICAgYWxsOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3RbXSxcbiAgICBleHRlbmQ6IEV4dGVuZGVkU3RhY2tTZWxlY3Rpb24gPSBFeHRlbmRlZFN0YWNrU2VsZWN0aW9uLk5vbmUsXG4gICkge1xuICAgIGNvbnN0IGFsbFN0YWNrcyA9IG5ldyBNYXA8c3RyaW5nLCBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q+KCk7XG4gICAgZm9yIChjb25zdCBzdGFjayBvZiBhbGwpIHtcbiAgICAgIGFsbFN0YWNrcy5zZXQoc3RhY2suaGllcmFyY2hpY2FsSWQsIHN0YWNrKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbmRleCA9IGluZGV4QnlIaWVyYXJjaGljYWxJZChtYXRjaGVkKTtcblxuICAgIHN3aXRjaCAoZXh0ZW5kKSB7XG4gICAgICBjYXNlIEV4dGVuZGVkU3RhY2tTZWxlY3Rpb24uRG93bnN0cmVhbTpcbiAgICAgICAgYXdhaXQgaW5jbHVkZURvd25zdHJlYW1TdGFja3ModGhpcy5pb0hlbHBlciwgaW5kZXgsIGFsbFN0YWNrcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBFeHRlbmRlZFN0YWNrU2VsZWN0aW9uLlVwc3RyZWFtOlxuICAgICAgICBhd2FpdCBpbmNsdWRlVXBzdHJlYW1TdGFja3ModGhpcy5pb0hlbHBlciwgaW5kZXgsIGFsbFN0YWNrcyk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIC8vIEZpbHRlciBvcmlnaW5hbCBhcnJheSBiZWNhdXNlIGl0IGlzIGluIHRoZSByaWdodCBvcmRlclxuICAgIGNvbnN0IHNlbGVjdGVkTGlzdCA9IGFsbC5maWx0ZXIocyA9PiBpbmRleC5oYXMocy5oaWVyYXJjaGljYWxJZCkpO1xuXG4gICAgcmV0dXJuIG5ldyBTdGFja0NvbGxlY3Rpb24odGhpcywgc2VsZWN0ZWRMaXN0KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbmRleEJ5SGllcmFyY2hpY2FsSWQoc3RhY2tzOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3RbXSk6IE1hcDxzdHJpbmcsIGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdD4ge1xuICBjb25zdCByZXN1bHQgPSBuZXcgTWFwPHN0cmluZywgY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0PigpO1xuXG4gIGZvciAoY29uc3Qgc3RhY2sgb2Ygc3RhY2tzKSB7XG4gICAgcmVzdWx0LnNldChzdGFjay5oaWVyYXJjaGljYWxJZCwgc3RhY2spO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGUgdGhlIHRyYW5zaXRpdmUgY2xvc3VyZSBvZiBzdGFjayBkZXBlbmRlbnRzLlxuICpcbiAqIE1vZGlmaWVzIGBzZWxlY3RlZFN0YWNrc2AgaW4tcGxhY2UuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGluY2x1ZGVEb3duc3RyZWFtU3RhY2tzKFxuICBpb0hlbHBlcjogSW9IZWxwZXIsXG4gIHNlbGVjdGVkU3RhY2tzOiBNYXA8c3RyaW5nLCBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q+LFxuICBhbGxTdGFja3M6IE1hcDxzdHJpbmcsIGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdD4sXG4pIHtcbiAgY29uc3QgYWRkZWQgPSBuZXcgQXJyYXk8c3RyaW5nPigpO1xuXG4gIGxldCBtYWRlUHJvZ3Jlc3M7XG4gIGRvIHtcbiAgICBtYWRlUHJvZ3Jlc3MgPSBmYWxzZTtcblxuICAgIGZvciAoY29uc3QgW2lkLCBzdGFja10gb2YgYWxsU3RhY2tzKSB7XG4gICAgICAvLyBTZWxlY3QgdGhpcyBzdGFjayBpZiBpdCdzIG5vdCBzZWxlY3RlZCB5ZXQgQU5EIGl0IGRlcGVuZHMgb24gYSBzdGFjayB0aGF0J3MgaW4gdGhlIHNlbGVjdGVkIHNldFxuICAgICAgaWYgKCFzZWxlY3RlZFN0YWNrcy5oYXMoaWQpICYmIChzdGFjay5kZXBlbmRlbmNpZXMgfHwgW10pLnNvbWUoZGVwID0+IHNlbGVjdGVkU3RhY2tzLmhhcyhkZXAuaWQpKSkge1xuICAgICAgICBzZWxlY3RlZFN0YWNrcy5zZXQoaWQsIHN0YWNrKTtcbiAgICAgICAgYWRkZWQucHVzaChpZCk7XG4gICAgICAgIG1hZGVQcm9ncmVzcyA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9IHdoaWxlIChtYWRlUHJvZ3Jlc3MpO1xuXG4gIGlmIChhZGRlZC5sZW5ndGggPiAwKSB7XG4gICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfQVNTRU1CTFlfSU5GTy5tc2coYEluY2x1ZGluZyBkZXBlbmRpbmcgc3RhY2tzOiAke2NoYWxrLmJvbGQoYWRkZWQuam9pbignLCAnKSl9YCkpO1xuICB9XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIHRoZSB0cmFuc2l0aXZlIGNsb3N1cmUgb2Ygc3RhY2sgZGVwZW5kZW5jaWVzLlxuICpcbiAqIE1vZGlmaWVzIGBzZWxlY3RlZFN0YWNrc2AgaW4tcGxhY2UuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGluY2x1ZGVVcHN0cmVhbVN0YWNrcyhcbiAgaW9IZWxwZXI6IElvSGVscGVyLFxuICBzZWxlY3RlZFN0YWNrczogTWFwPHN0cmluZywgY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0PixcbiAgYWxsU3RhY2tzOiBNYXA8c3RyaW5nLCBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q+LFxuKSB7XG4gIGNvbnN0IGFkZGVkID0gbmV3IEFycmF5PHN0cmluZz4oKTtcbiAgbGV0IG1hZGVQcm9ncmVzcyA9IHRydWU7XG4gIHdoaWxlIChtYWRlUHJvZ3Jlc3MpIHtcbiAgICBtYWRlUHJvZ3Jlc3MgPSBmYWxzZTtcblxuICAgIGZvciAoY29uc3Qgc3RhY2sgb2Ygc2VsZWN0ZWRTdGFja3MudmFsdWVzKCkpIHtcbiAgICAgIC8vIFNlbGVjdCBhbiBhZGRpdGlvbmFsIHN0YWNrIGlmIGl0J3Mgbm90IHNlbGVjdGVkIHlldCBhbmQgYSBkZXBlbmRlbmN5IG9mIGEgc2VsZWN0ZWQgc3RhY2sgKGFuZCBleGlzdHMsIG9idmlvdXNseSlcbiAgICAgIGZvciAoY29uc3QgZGVwZW5kZW5jeUlkIG9mIHN0YWNrLmRlcGVuZGVuY2llcy5tYXAoeCA9PiB4Lm1hbmlmZXN0LmRpc3BsYXlOYW1lID8/IHguaWQpKSB7XG4gICAgICAgIGlmICghc2VsZWN0ZWRTdGFja3MuaGFzKGRlcGVuZGVuY3lJZCkgJiYgYWxsU3RhY2tzLmhhcyhkZXBlbmRlbmN5SWQpKSB7XG4gICAgICAgICAgYWRkZWQucHVzaChkZXBlbmRlbmN5SWQpO1xuICAgICAgICAgIHNlbGVjdGVkU3RhY2tzLnNldChkZXBlbmRlbmN5SWQsIGFsbFN0YWNrcy5nZXQoZGVwZW5kZW5jeUlkKSEpO1xuICAgICAgICAgIG1hZGVQcm9ncmVzcyA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoYWRkZWQubGVuZ3RoID4gMCkge1xuICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX0FTU0VNQkxZX0lORk8ubXNnKGBJbmNsdWRpbmcgZGVwZW5kZW5jeSBzdGFja3M6ICR7Y2hhbGsuYm9sZChhZGRlZC5qb2luKCcsICcpKX1gKSk7XG4gIH1cbn1cbiJdfQ==