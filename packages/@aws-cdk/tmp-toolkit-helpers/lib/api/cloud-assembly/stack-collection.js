"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StackCollection = void 0;
const cx_api_1 = require("@aws-cdk/cx-api");
const toolkit_error_1 = require("../toolkit-error");
/**
 * A collection of stacks and related artifacts
 *
 * In practice, not all artifacts in the CloudAssembly are created equal;
 * stacks can be selected independently, but other artifacts such as asset
 * bundles cannot.
 */
class StackCollection {
    assembly;
    stackArtifacts;
    constructor(assembly, stackArtifacts) {
        this.assembly = assembly;
        this.stackArtifacts = stackArtifacts;
    }
    get stackCount() {
        return this.stackArtifacts.length;
    }
    get firstStack() {
        if (this.stackCount < 1) {
            throw new toolkit_error_1.ToolkitError('StackCollection contains no stack artifacts (trying to access the first one)');
        }
        return this.stackArtifacts[0];
    }
    get stackIds() {
        return this.stackArtifacts.map(s => s.id);
    }
    get hierarchicalIds() {
        return this.stackArtifacts.map(s => s.hierarchicalId);
    }
    withDependencies() {
        const allData = [];
        for (const stack of this.stackArtifacts) {
            const data = {
                id: stack.displayName ?? stack.id,
                name: stack.stackName,
                environment: stack.environment,
                dependencies: [],
            };
            for (const dependencyId of stack.dependencies.map(x => x.id)) {
                if (dependencyId.includes('.assets')) {
                    continue;
                }
                const depStack = this.assembly.stackById(dependencyId);
                if (depStack.firstStack.dependencies.filter((dep) => !(dep.id).includes('.assets')).length > 0) {
                    for (const stackDetail of depStack.withDependencies()) {
                        data.dependencies.push({
                            id: stackDetail.id,
                            dependencies: stackDetail.dependencies,
                        });
                    }
                }
                else {
                    data.dependencies.push({
                        id: depStack.firstStack.displayName ?? depStack.firstStack.id,
                        dependencies: [],
                    });
                }
            }
            allData.push(data);
        }
        return allData;
    }
    reversed() {
        const arts = [...this.stackArtifacts];
        arts.reverse();
        return new StackCollection(this.assembly, arts);
    }
    filter(predicate) {
        return new StackCollection(this.assembly, this.stackArtifacts.filter(predicate));
    }
    concat(...others) {
        return new StackCollection(this.assembly, this.stackArtifacts.concat(...others.map(o => o.stackArtifacts)));
    }
    /**
     * Extracts 'aws:cdk:warning|info|error' metadata entries from the stack synthesis
     */
    async validateMetadata(failAt = 'error', logger = async () => {
    }) {
        let warnings = false;
        let errors = false;
        for (const stack of this.stackArtifacts) {
            for (const message of stack.messages) {
                switch (message.level) {
                    case cx_api_1.SynthesisMessageLevel.WARNING:
                        warnings = true;
                        await logger('warn', message);
                        break;
                    case cx_api_1.SynthesisMessageLevel.ERROR:
                        errors = true;
                        await logger('error', message);
                        break;
                    case cx_api_1.SynthesisMessageLevel.INFO:
                        await logger('info', message);
                        break;
                }
            }
        }
        if (errors && failAt != 'none') {
            throw toolkit_error_1.AssemblyError.withStacks('Found errors', this.stackArtifacts);
        }
        if (warnings && failAt === 'warn') {
            throw toolkit_error_1.AssemblyError.withStacks('Found warnings (--strict mode)', this.stackArtifacts);
        }
    }
}
exports.StackCollection = StackCollection;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stY29sbGVjdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvY2xvdWQtYXNzZW1ibHkvc3RhY2stY29sbGVjdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw0Q0FBd0Q7QUFDeEQsb0RBQStEO0FBSS9EOzs7Ozs7R0FNRztBQUNILE1BQWEsZUFBZTtJQUNFO0lBQTBDO0lBQXRFLFlBQTRCLFFBQXdCLEVBQWtCLGNBQW1EO1FBQTdGLGFBQVEsR0FBUixRQUFRLENBQWdCO1FBQWtCLG1CQUFjLEdBQWQsY0FBYyxDQUFxQztJQUN6SCxDQUFDO0lBRUQsSUFBVyxVQUFVO1FBQ25CLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUM7SUFDcEMsQ0FBQztJQUVELElBQVcsVUFBVTtRQUNuQixJQUFJLElBQUksQ0FBQyxVQUFVLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDeEIsTUFBTSxJQUFJLDRCQUFZLENBQUMsOEVBQThFLENBQUMsQ0FBQztRQUN6RyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2hDLENBQUM7SUFFRCxJQUFXLFFBQVE7UUFDakIsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRUQsSUFBVyxlQUFlO1FBQ3hCLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVNLGdCQUFnQjtRQUNyQixNQUFNLE9BQU8sR0FBbUIsRUFBRSxDQUFDO1FBRW5DLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3hDLE1BQU0sSUFBSSxHQUFpQjtnQkFDekIs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QUssOEJBQXFCLENBQUMsT0FBTzt3QkFDaEMsUUFBUSxHQUFHLElBQUksQ0FBQzt3QkFDaEIsTUFBTSxNQUFNLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDO3dCQUM5QixNQUFNO29CQUNSLEtBQUssOEJBQXFCLENBQUMsS0FBSzt3QkFDOUIsTUFBTSxHQUFHLElBQUksQ0FBQzt3QkFDZCxNQUFNLE1BQU0sQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7d0JBQy9CLE1BQU07b0JBQ1IsS0FBSyw4QkFBcUIsQ0FBQyxJQUFJO3dCQUM3QixNQUFNLE1BQU0sQ0FBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUM7d0JBQzlCLE1BQU07Z0JBQ1YsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxNQUFNLElBQUksTUFBTSxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQy9CLE1BQU0sNkJBQWEsQ0FBQyxVQUFVLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUN0RSxDQUFDO1FBRUQsSUFBSSxRQUFRLElBQUksTUFBTSxLQUFLLE1BQU0sRUFBRSxDQUFDO1lBQ2xDLE1BQU0sNkJBQWEsQ0FBQyxVQUFVLENBQUMsZ0NBQWdDLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ3hGLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFqSEQsMENBaUhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgKiBhcyBjeGFwaSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0IHsgU3ludGhlc2lzTWVzc2FnZUxldmVsIH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB7IEFzc2VtYmx5RXJyb3IsIFRvb2xraXRFcnJvciB9IGZyb20gJy4uL3Rvb2xraXQtZXJyb3InO1xuaW1wb3J0IHR5cGUgeyBJU3RhY2tBc3NlbWJseSB9IGZyb20gJy4vc3RhY2stYXNzZW1ibHknO1xuaW1wb3J0IHsgdHlwZSBTdGFja0RldGFpbHMgfSBmcm9tICcuLi8uLi9wYXlsb2Fkcy9zdGFjay1kZXRhaWxzJztcblxuLyoqXG4gKiBBIGNvbGxlY3Rpb24gb2Ygc3RhY2tzIGFuZCByZWxhdGVkIGFydGlmYWN0c1xuICpcbiAqIEluIHByYWN0aWNlLCBub3QgYWxsIGFydGlmYWN0cyBpbiB0aGUgQ2xvdWRBc3NlbWJseSBhcmUgY3JlYXRlZCBlcXVhbDtcbiAqIHN0YWNrcyBjYW4gYmUgc2VsZWN0ZWQgaW5kZXBlbmRlbnRseSwgYnV0IG90aGVyIGFydGlmYWN0cyBzdWNoIGFzIGFzc2V0XG4gKiBidW5kbGVzIGNhbm5vdC5cbiAqL1xuZXhwb3J0IGNsYXNzIFN0YWNrQ29sbGVjdGlvbiB7XG4gIGNvbnN0cnVjdG9yKHB1YmxpYyByZWFkb25seSBhc3NlbWJseTogSVN0YWNrQXNzZW1ibHksIHB1YmxpYyByZWFkb25seSBzdGFja0FydGlmYWN0czogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0W10pIHtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc3RhY2tDb3VudCgpIHtcbiAgICByZXR1cm4gdGhpcy5zdGFja0FydGlmYWN0cy5sZW5ndGg7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGZpcnN0U3RhY2soKSB7XG4gICAgaWYgKHRoaXMuc3RhY2tDb3VudCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJ1N0YWNrQ29sbGVjdGlvbiBjb250YWlucyBubyBzdGFjayBhcnRpZmFjdHMgKHRyeWluZyB0byBhY2Nlc3MgdGhlIGZpcnN0IG9uZSknKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuc3RhY2tBcnRpZmFjdHNbMF07XG4gIH1cblxuICBwdWJsaWMgZ2V0IHN0YWNrSWRzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gdGhpcy5zdGFja0FydGlmYWN0cy5tYXAocyA9PiBzLmlkKTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgaGllcmFyY2hpY2FsSWRzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gdGhpcy5zdGFja0FydGlmYWN0cy5tYXAocyA9PiBzLmhpZXJhcmNoaWNhbElkKTtcbiAgfVxuXG4gIHB1YmxpYyB3aXRoRGVwZW5kZW5jaWVzKCk6IFN0YWNrRGV0YWlsc1tdIHtcbiAgICBjb25zdCBhbGxEYXRhOiBTdGFja0RldGFpbHNbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBzdGFjayBvZiB0aGlzLnN0YWNrQXJ0aWZhY3RzKSB7XG4gICAgICBjb25zdCBkYXRhOiBTdGFja0RldGFpbHMgPSB7XG4gICAgICAgIGlkOiBzdGFjay5kaXNwbGF5TmFtZSA/PyBzdGFjay5pZCxcbiAgICAgICAgbmFtZTogc3RhY2suc3RhY2tOYW1lLFxuICAgICAgICBlbnZpcm9ubWVudDogc3RhY2suZW52aXJvbm1lbnQsXG4gICAgICAgIGRlcGVuZGVuY2llczogW10sXG4gICAgICB9O1xuXG4gICAgICBmb3IgKGNvbnN0IGRlcGVuZGVuY3lJZCBvZiBzdGFjay5kZXBlbmRlbmNpZXMubWFwKHggPT4geC5pZCkpIHtcbiAgICAgICAgaWYgKGRlcGVuZGVuY3lJZC5pbmNsdWRlcygnLmFzc2V0cycpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkZXBTdGFjayA9IHRoaXMuYXNzZW1ibHkuc3RhY2tCeUlkKGRlcGVuZGVuY3lJZCk7XG5cbiAgICAgICAgaWYgKGRlcFN0YWNrLmZpcnN0U3RhY2suZGVwZW5kZW5jaWVzLmZpbHRlcigoZGVwKSA9PiAhKGRlcC5pZCkuaW5jbHVkZXMoJy5hc3NldHMnKSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGZvciAoY29uc3Qgc3RhY2tEZXRhaWwgb2YgZGVwU3RhY2sud2l0aERlcGVuZGVuY2llcygpKSB7XG4gICAgICAgICAgICBkYXRhLmRlcGVuZGVuY2llcy5wdXNoKHtcbiAgICAgICAgICAgICAgaWQ6IHN0YWNrRGV0YWlsLmlkLFxuICAgICAgICAgICAgICBkZXBlbmRlbmNpZXM6IHN0YWNrRGV0YWlsLmRlcGVuZGVuY2llcyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkYXRhLmRlcGVuZGVuY2llcy5wdXNoKHtcbiAgICAgICAgICAgIGlkOiBkZXBTdGFjay5maXJzdFN0YWNrLmRpc3BsYXlOYW1lID8/IGRlcFN0YWNrLmZpcnN0U3RhY2suaWQsXG4gICAgICAgICAgICBkZXBlbmRlbmNpZXM6IFtdLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGFsbERhdGEucHVzaChkYXRhKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYWxsRGF0YTtcbiAgfVxuXG4gIHB1YmxpYyByZXZlcnNlZCgpIHtcbiAgICBjb25zdCBhcnRzID0gWy4uLnRoaXMuc3RhY2tBcnRpZmFjdHNdO1xuICAgIGFydHMucmV2ZXJzZSgpO1xuICAgIHJldHVybiBuZXcgU3RhY2tDb2xsZWN0aW9uKHRoaXMuYXNzZW1ibHksIGFydHMpO1xuICB9XG5cbiAgcHVibGljIGZpbHRlcihwcmVkaWNhdGU6IChhcnQ6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCkgPT4gYm9vbGVhbik6IFN0YWNrQ29sbGVjdGlvbiB7XG4gICAgcmV0dXJuIG5ldyBTdGFja0NvbGxlY3Rpb24odGhpcy5hc3NlbWJseSwgdGhpcy5zdGFja0FydGlmYWN0cy5maWx0ZXIocHJlZGljYXRlKSk7XG4gIH1cblxuICBwdWJsaWMgY29uY2F0KC4uLm90aGVyczogU3RhY2tDb2xsZWN0aW9uW10pOiBTdGFja0NvbGxlY3Rpb24ge1xuICAgIHJldHVybiBuZXcgU3RhY2tDb2xsZWN0aW9uKHRoaXMuYXNzZW1ibHksIHRoaXMuc3RhY2tBcnRpZmFjdHMuY29uY2F0KC4uLm90aGVycy5tYXAobyA9PiBvLnN0YWNrQXJ0aWZhY3RzKSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzICdhd3M6Y2RrOndhcm5pbmd8aW5mb3xlcnJvcicgbWV0YWRhdGEgZW50cmllcyBmcm9tIHRoZSBzdGFjayBzeW50aGVzaXNcbiAgICovXG4gIHB1YmxpYyBhc3luYyB2YWxpZGF0ZU1ldGFkYXRhKFxuICAgIGZhaWxBdDogJ3dhcm4nIHwgJ2Vycm9yJyB8ICdub25lJyA9ICdlcnJvcicsXG4gICAgbG9nZ2VyOiAobGV2ZWw6ICdpbmZvJyB8ICdlcnJvcicgfCAnd2FybicsIG1zZzogY3hhcGkuU3ludGhlc2lzTWVzc2FnZSkgPT4gUHJvbWlzZTx2b2lkPiA9IGFzeW5jICgpID0+IHtcbiAgICB9LFxuICApIHtcbiAgICBsZXQgd2FybmluZ3MgPSBmYWxzZTtcbiAgICBsZXQgZXJyb3JzID0gZmFsc2U7XG5cbiAgICBmb3IgKGNvbnN0IHN0YWNrIG9mIHRoaXMuc3RhY2tBcnRpZmFjdHMpIHtcbiAgICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiBzdGFjay5tZXNzYWdlcykge1xuICAgICAgICBzd2l0Y2ggKG1lc3NhZ2UubGV2ZWwpIHtcbiAgICAgICAgICBjYXNlIFN5bnRoZXNpc01lc3NhZ2VMZXZlbC5XQVJOSU5HOlxuICAgICAgICAgICAgd2FybmluZ3MgPSB0cnVlO1xuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyKCd3YXJuJywgbWVzc2FnZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlIFN5bnRoZXNpc01lc3NhZ2VMZXZlbC5FUlJPUjpcbiAgICAgICAgICAgIGVycm9ycyA9IHRydWU7XG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIoJ2Vycm9yJywgbWVzc2FnZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlIFN5bnRoZXNpc01lc3NhZ2VMZXZlbC5JTkZPOlxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyKCdpbmZvJywgbWVzc2FnZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMgJiYgZmFpbEF0ICE9ICdub25lJykge1xuICAgICAgdGhyb3cgQXNzZW1ibHlFcnJvci53aXRoU3RhY2tzKCdGb3VuZCBlcnJvcnMnLCB0aGlzLnN0YWNrQXJ0aWZhY3RzKTtcbiAgICB9XG5cbiAgICBpZiAod2FybmluZ3MgJiYgZmFpbEF0ID09PSAnd2FybicpIHtcbiAgICAgIHRocm93IEFzc2VtYmx5RXJyb3Iud2l0aFN0YWNrcygnRm91bmQgd2FybmluZ3MgKC0tc3RyaWN0IG1vZGUpJywgdGhpcy5zdGFja0FydGlmYWN0cyk7XG4gICAgfVxuICB9XG59XG4iXX0=