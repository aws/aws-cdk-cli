"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkGraphBuilder = void 0;
const cxapi = require("@aws-cdk/cx-api");
const cdk_assets_1 = require("cdk-assets");
const work_graph_1 = require("./work-graph");
const work_graph_types_1 = require("./work-graph-types");
const util_1 = require("../../util");
const toolkit_error_1 = require("../toolkit-error");
class WorkGraphBuilder {
    prebuildAssets;
    idPrefix;
    /**
     * Default priorities for nodes
     *
     * Assets builds have higher priority than the other two operations, to make good on our promise that
     * '--prebuild-assets' will actually do assets before stacks (if it can). Unfortunately it is the
     * default :(
     *
     * But between stack dependencies and publish dependencies, stack dependencies go first
     */
    static PRIORITIES = {
        'asset-build': 10,
        'asset-publish': 0,
        'stack': 5,
    };
    graph;
    ioHelper;
    constructor(ioHelper, prebuildAssets, idPrefix = '') {
        this.prebuildAssets = prebuildAssets;
        this.idPrefix = idPrefix;
        this.graph = new work_graph_1.WorkGraph({}, ioHelper);
        this.ioHelper = ioHelper;
    }
    addStack(artifact) {
        this.graph.addNodes({
            type: 'stack',
            id: `${this.idPrefix}${artifact.id}`,
            dependencies: new Set(this.stackArtifactIds(onlyStacks(artifact.dependencies))),
            stack: artifact,
            deploymentState: work_graph_types_1.DeploymentState.PENDING,
            priority: WorkGraphBuilder.PRIORITIES.stack,
        });
    }
    /**
     * Oof, see this parameter list
     */
    // eslint-disable-next-line max-len
    addAsset(parentStack, assetManifestArtifact, assetManifest, asset) {
        // Just the artifact identifier
        const assetId = asset.id.assetId;
        const buildId = `build-${assetId}-${(0, util_1.contentHashAny)([assetId, asset.genericSource]).substring(0, 10)}`;
        const publishId = `publish-${assetId}-${(0, util_1.contentHashAny)([assetId, asset.genericDestination]).substring(0, 10)}`;
        // Build node only gets added once because they are all the same
        if (!this.graph.tryGetNode(buildId)) {
            const node = {
                type: 'asset-build',
                id: buildId,
                note: asset.displayName(false),
                dependencies: new Set([
                    ...this.stackArtifactIds(assetManifestArtifact.dependencies),
                    // If we disable prebuild, then assets inherit (stack) dependencies from their parent stack
                    ...!this.prebuildAssets ? this.stackArtifactIds(onlyStacks(parentStack.dependencies)) : [],
                ]),
                parentStack: parentStack,
                assetManifestArtifact,
                assetManifest,
                asset,
                deploymentState: work_graph_types_1.DeploymentState.PENDING,
                priority: WorkGraphBuilder.PRIORITIES['asset-build'],
            };
            this.graph.addNodes(node);
        }
        const publishNode = this.graph.tryGetNode(publishId);
        if (!publishNode) {
            this.graph.addNodes({
                type: 'asset-publish',
                id: publishId,
                note: asset.displayName(true),
                dependencies: new Set([
                    buildId,
                ]),
                parentStack,
                assetManifestArtifact,
                assetManifest,
                asset,
                deploymentState: work_graph_types_1.DeploymentState.PENDING,
                priority: WorkGraphBuilder.PRIORITIES['asset-publish'],
            });
        }
        for (const inheritedDep of this.stackArtifactIds(onlyStacks(parentStack.dependencies))) {
            // The asset publish step also depends on the stacks that the parent depends on.
            // This is purely cosmetic: if we don't do this, the progress printing of asset publishing
            // is going to interfere with the progress bar of the stack deployment. We could remove this
            // for overall faster deployments if we ever have a better method of progress displaying.
            // Note: this may introduce a cycle if one of the parent's dependencies is another stack that
            // depends on this asset. To workaround this we remove these cycles once all nodes have
            // been added to the graph.
            this.graph.addDependency(publishId, inheritedDep);
        }
        // This will work whether the stack node has been added yet or not
        this.graph.addDependency(`${this.idPrefix}${parentStack.id}`, publishId);
    }
    build(artifacts) {
        const parentStacks = stacksFromAssets(artifacts);
        for (const artifact of artifacts) {
            if (cxapi.CloudFormationStackArtifact.isCloudFormationStackArtifact(artifact)) {
                this.addStack(artifact);
            }
            else if (cxapi.AssetManifestArtifact.isAssetManifestArtifact(artifact)) {
                const manifest = cdk_assets_1.AssetManifest.fromFile(artifact.file);
                for (const entry of manifest.entries) {
                    const parentStack = parentStacks.get(artifact);
                    if (parentStack === undefined) {
                        throw new toolkit_error_1.ToolkitError('Found an asset manifest that is not associated with a stack');
                    }
                    this.addAsset(parentStack, artifact, manifest, entry);
                }
            }
            else if (cxapi.NestedCloudAssemblyArtifact.isNestedCloudAssemblyArtifact(artifact)) {
                const assembly = new cxapi.CloudAssembly(artifact.fullPath, { topoSort: false });
                const nestedGraph = new WorkGraphBuilder(this.ioHelper, this.prebuildAssets, `${this.idPrefix}${artifact.id}.`).build(assembly.artifacts);
                this.graph.absorb(nestedGraph);
            }
            else {
                // Ignore whatever else
            }
        }
        this.graph.removeUnavailableDependencies();
        // Remove any potentially introduced cycles between asset publishing and the stacks that depend on them.
        this.removeStackPublishCycles();
        return this.graph;
    }
    stackArtifactIds(deps) {
        return deps.flatMap((d) => cxapi.CloudFormationStackArtifact.isCloudFormationStackArtifact(d) ? [this.stackArtifactId(d)] : []);
    }
    stackArtifactId(artifact) {
        if (!cxapi.CloudFormationStackArtifact.isCloudFormationStackArtifact(artifact)) {
            throw new toolkit_error_1.ToolkitError(`Can only call this on CloudFormationStackArtifact, got: ${artifact.constructor.name}`);
        }
        return `${this.idPrefix}${artifact.id}`;
    }
    /**
     * We may have accidentally introduced cycles in an attempt to make the messages printed to the
     * console not interfere with each other too much. Remove them again.
     */
    removeStackPublishCycles() {
        const publishSteps = this.graph.nodesOfType('asset-publish');
        for (const publishStep of publishSteps) {
            for (const dep of publishStep.dependencies) {
                if (this.graph.reachable(dep, publishStep.id)) {
                    publishStep.dependencies.delete(dep);
                }
            }
        }
    }
}
exports.WorkGraphBuilder = WorkGraphBuilder;
function stacksFromAssets(artifacts) {
    const ret = new Map();
    for (const stack of artifacts.filter(x => cxapi.CloudFormationStackArtifact.isCloudFormationStackArtifact(x))) {
        const assetArtifacts = stack.dependencies.filter((x) => cxapi.AssetManifestArtifact.isAssetManifestArtifact(x));
        for (const art of assetArtifacts) {
            ret.set(art, stack);
        }
    }
    return ret;
}
function onlyStacks(artifacts) {
    return artifacts.filter(x => cxapi.CloudFormationStackArtifact.isCloudFormationStackArtifact(x));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29yay1ncmFwaC1idWlsZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS93b3JrLWdyYXBoL3dvcmstZ3JhcGgtYnVpbGRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5Q0FBeUM7QUFDekMsMkNBQWdFO0FBQ2hFLDZDQUF5QztBQUV6Qyx5REFBcUQ7QUFDckQscUNBQTRDO0FBRTVDLG9EQUFnRDtBQUVoRCxNQUFhLGdCQUFnQjtJQW9CUjtJQUNBO0lBcEJuQjs7Ozs7Ozs7T0FRRztJQUNJLE1BQU0sQ0FBQyxVQUFVLEdBQXFDO1FBQzNELGFBQWEsRUFBRSxFQUFFO1FBQ2pCLGVBQWUsRUFBRSxDQUFDO1FBQ2xCLE9BQU8sRUFBRSxDQUFDO0tBQ1gsQ0FBQztJQUNlLEtBQUssQ0FBWTtJQUNqQixRQUFRLENBQVc7SUFFcEMsWUFDRSxRQUFrQixFQUNELGNBQXVCLEVBQ3ZCLFdBQVcsRUFBRTtRQURiLG1CQUFjLEdBQWQsY0FBYyxDQUFTO1FBQ3ZCLGFBQVEsR0FBUixRQUFRLENBQUs7UUFFOUIsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ3pDLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzNCLENBQUM7SUFFTyxRQUFRLENBQUMsUUFBMkM7UUFDMUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUM7WUFDbEIsSUFBSSxFQUFFLE9BQU87WUFDYixFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxFQUFFLEVBQUU7WUFDcEMsWUFBWSxFQUFFLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7WUFDL0UsS0FBSyxFQUFFLFFBQVE7WUFDZixlQUFlLEVBQUUsa0NBQWUsQ0FBQyxPQUFPO1lB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QztJQUNsRCxPQUFPLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsMkJBQTJCLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuRyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3hhcGkgZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB7IEFzc2V0TWFuaWZlc3QsIHR5cGUgSU1hbmlmZXN0RW50cnkgfSBmcm9tICdjZGstYXNzZXRzJztcbmltcG9ydCB7IFdvcmtHcmFwaCB9IGZyb20gJy4vd29yay1ncmFwaCc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0QnVpbGROb2RlLCBXb3JrTm9kZSB9IGZyb20gJy4vd29yay1ncmFwaC10eXBlcyc7XG5pbXBvcnQgeyBEZXBsb3ltZW50U3RhdGUgfSBmcm9tICcuL3dvcmstZ3JhcGgtdHlwZXMnO1xuaW1wb3J0IHsgY29udGVudEhhc2hBbnkgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgSW9IZWxwZXIgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uL3Rvb2xraXQtZXJyb3InO1xuXG5leHBvcnQgY2xhc3MgV29ya0dyYXBoQnVpbGRlciB7XG4gIC8qKlxuICAgKiBEZWZhdWx0IHByaW9yaXRpZXMgZm9yIG5vZGVzXG4gICAqXG4gICAqIEFzc2V0cyBidWlsZHMgaGF2ZSBoaWdoZXIgcHJpb3JpdHkgdGhhbiB0aGUgb3RoZXIgdHdvIG9wZXJhdGlvbnMsIHRvIG1ha2UgZ29vZCBvbiBvdXIgcHJvbWlzZSB0aGF0XG4gICAqICctLXByZWJ1aWxkLWFzc2V0cycgd2lsbCBhY3R1YWxseSBkbyBhc3NldHMgYmVmb3JlIHN0YWNrcyAoaWYgaXQgY2FuKS4gVW5mb3J0dW5hdGVseSBpdCBpcyB0aGVcbiAgICogZGVmYXVsdCA6KFxuICAgKlxuICAgKiBCdXQgYmV0d2VlbiBzdGFjayBkZXBlbmRlbmNpZXMgYW5kIHB1Ymxpc2ggZGVwZW5kZW5jaWVzLCBzdGFjayBkZXBlbmRlbmNpZXMgZ28gZmlyc3RcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgUFJJT1JJVElFUzogUmVjb3JkPFdvcmtOb2RlWyd0eXBlJ10sIG51bWJlcj4gPSB7XG4gICAgJ2Fzc2V0LWJ1aWxkJzogMTAsXG4gICAgJ2Fzc2V0LXB1Ymxpc2gnOiAwLFxuICAgICdzdGFjayc6IDUsXG4gIH07XG4gIHByaXZhdGUgcmVhZG9ubHkgZ3JhcGg6IFdvcmtHcmFwaDtcbiAgcHJpdmF0ZSByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgaW9IZWxwZXI6IElvSGVscGVyLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJlYnVpbGRBc3NldHM6IGJvb2xlYW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBpZFByZWZpeCA9ICcnLFxuICApIHtcbiAgICB0aGlzLmdyYXBoID0gbmV3IFdvcmtHcmFwaCh7fSwgaW9IZWxwZXIpO1xuICAgIHRoaXMuaW9IZWxwZXIgPSBpb0hlbHBlcjtcbiAgfVxuXG4gIHByaXZhdGUgYWRkU3RhY2soYXJ0aWZhY3Q6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCkge1xuICAgIHRoaXMuZ3JhcGguYWRkTm9kZXMoe1xuICAgICAgdHlwZTogJ3N0YWNrJyxcbiAgICAgIGlkOiBgJHt0aGlzLmlkUHJlZml4fSR7YXJ0aWZhY3QuaWR9YCxcbiAgICAgIGRlcGVuZGVuY2llczogbmV3IFNldCh0aGlzLnN0YWNrQXJ0aWZhY3RJZHMob25seVN0YWNrcyhhcnRpZmFjdC5kZXBlbmRlbmNpZXMpKSksXG4gICAgICBzdGFjazogYXJ0aWZhY3QsXG4gICAgICBkZXBsb3ltZW50U3RhdGU6IERlcGxveW1lbnRTdGF0ZS5QRU5ESU5HLFxuICAgICAgcHJpb3JpdHk6IFdvcmtHcmFwaEJ1aWxkZXIuUFJJT1JJVElFUy5zdGFjayxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBPb2YsIHNlZSB0aGlzIHBhcmFtZXRlciBsaXN0XG4gICAqL1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxlblxuICBwcml2YXRlIGFkZEFzc2V0KHBhcmVudFN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QsIGFzc2V0TWFuaWZlc3RBcnRpZmFjdDogY3hhcGkuQXNzZXRNYW5pZmVzdEFydGlmYWN0LCBhc3NldE1hbmlmZXN0OiBBc3NldE1hbmlmZXN0LCBhc3NldDogSU1hbmlmZXN0RW50cnkpIHtcbiAgICAvLyBKdXN0IHRoZSBhcnRpZmFjdCBpZGVudGlmaWVyXG4gICAgY29uc3QgYXNzZXRJZCA9IGFzc2V0LmlkLmFzc2V0SWQ7XG5cbiAgICBjb25zdCBidWlsZElkID0gYGJ1aWxkLSR7YXNzZXRJZH0tJHtjb250ZW50SGFzaEFueShbYXNzZXRJZCwgYXNzZXQuZ2VuZXJpY1NvdXJjZV0pLnN1YnN0cmluZygwLCAxMCl9YDtcbiAgICBjb25zdCBwdWJsaXNoSWQgPSBgcHVibGlzaC0ke2Fzc2V0SWR9LSR7Y29udGVudEhhc2hBbnkoW2Fzc2V0SWQsIGFzc2V0LmdlbmVyaWNEZXN0aW5hdGlvbl0pLnN1YnN0cmluZygwLCAxMCl9YDtcblxuICAgIC8vIEJ1aWxkIG5vZGUgb25seSBnZXRzIGFkZGVkIG9uY2UgYmVjYXVzZSB0aGV5IGFyZSBhbGwgdGhlIHNhbWVcbiAgICBpZiAoIXRoaXMuZ3JhcGgudHJ5R2V0Tm9kZShidWlsZElkKSkge1xuICAgICAgY29uc3Qgbm9kZTogQXNzZXRCdWlsZE5vZGUgPSB7XG4gICAgICAgIHR5cGU6ICdhc3NldC1idWlsZCcsXG4gICAgICAgIGlkOiBidWlsZElkLFxuICAgICAgICBub3RlOiBhc3NldC5kaXNwbGF5TmFtZShmYWxzZSksXG4gICAgICAgIGRlcGVuZGVuY2llczogbmV3IFNldChbXG4gICAgICAgICAgLi4udGhpcy5zdGFja0FydGlmYWN0SWRzKGFzc2V0TWFuaWZlc3RBcnRpZmFjdC5kZXBlbmRlbmNpZXMpLFxuICAgICAgICAgIC8vIElmIHdlIGRpc2FibGUgcHJlYnVpbGQsIHRoZW4gYXNzZXRzIGluaGVyaXQgKHN0YWNrKSBkZXBlbmRlbmNpZXMgZnJvbSB0aGVpciBwYXJlbnQgc3RhY2tcbiAgICAgICAgICAuLi4hdGhpcy5wcmVidWlsZEFzc2V0cyA/IHRoaXMuc3RhY2tBcnRpZmFjdElkcyhvbmx5U3RhY2tzKHBhcmVudFN0YWNrLmRlcGVuZGVuY2llcykpIDogW10sXG4gICAgICAgIF0pLFxuICAgICAgICBwYXJlbnRTdGFjazogcGFyZW50U3RhY2ssXG4gICAgICAgIGFzc2V0TWFuaWZlc3RBcnRpZmFjdCxcbiAgICAgICAgYXNzZXRNYW5pZmVzdCxcbiAgICAgICAgYXNzZXQsXG4gICAgICAgIGRlcGxveW1lbnRTdGF0ZTogRGVwbG95bWVudFN0YXRlLlBFTkRJTkcsXG4gICAgICAgIHByaW9yaXR5OiBXb3JrR3JhcGhCdWlsZGVyLlBSSU9SSVRJRVNbJ2Fzc2V0LWJ1aWxkJ10sXG4gICAgICB9O1xuICAgICAgdGhpcy5ncmFwaC5hZGROb2Rlcyhub2RlKTtcbiAgICB9XG5cbiAgICBjb25zdCBwdWJsaXNoTm9kZSA9IHRoaXMuZ3JhcGgudHJ5R2V0Tm9kZShwdWJsaXNoSWQpO1xuICAgIGlmICghcHVibGlzaE5vZGUpIHtcbiAgICAgIHRoaXMuZ3JhcGguYWRkTm9kZXMoe1xuICAgICAgICB0eXBlOiAnYXNzZXQtcHVibGlzaCcsXG4gICAgICAgIGlkOiBwdWJsaXNoSWQsXG4gICAgICAgIG5vdGU6IGFzc2V0LmRpc3BsYXlOYW1lKHRydWUpLFxuICAgICAgICBkZXBlbmRlbmNpZXM6IG5ldyBTZXQoW1xuICAgICAgICAgIGJ1aWxkSWQsXG4gICAgICAgIF0pLFxuICAgICAgICBwYXJlbnRTdGFjayxcbiAgICAgICAgYXNzZXRNYW5pZmVzdEFydGlmYWN0LFxuICAgICAgICBhc3NldE1hbmlmZXN0LFxuICAgICAgICBhc3NldCxcbiAgICAgICAgZGVwbG95bWVudFN0YXRlOiBEZXBsb3ltZW50U3RhdGUuUEVORElORyxcbiAgICAgICAgcHJpb3JpdHk6IFdvcmtHcmFwaEJ1aWxkZXIuUFJJT1JJVElFU1snYXNzZXQtcHVibGlzaCddLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBpbmhlcml0ZWREZXAgb2YgdGhpcy5zdGFja0FydGlmYWN0SWRzKG9ubHlTdGFja3MocGFyZW50U3RhY2suZGVwZW5kZW5jaWVzKSkpIHtcbiAgICAgIC8vIFRoZSBhc3NldCBwdWJsaXNoIHN0ZXAgYWxzbyBkZXBlbmRzIG9uIHRoZSBzdGFja3MgdGhhdCB0aGUgcGFyZW50IGRlcGVuZHMgb24uXG4gICAgICAvLyBUaGlzIGlzIHB1cmVseSBjb3NtZXRpYzogaWYgd2UgZG9uJ3QgZG8gdGhpcywgdGhlIHByb2dyZXNzIHByaW50aW5nIG9mIGFzc2V0IHB1Ymxpc2hpbmdcbiAgICAgIC8vIGlzIGdvaW5nIHRvIGludGVyZmVyZSB3aXRoIHRoZSBwcm9ncmVzcyBiYXIgb2YgdGhlIHN0YWNrIGRlcGxveW1lbnQuIFdlIGNvdWxkIHJlbW92ZSB0aGlzXG4gICAgICAvLyBmb3Igb3ZlcmFsbCBmYXN0ZXIgZGVwbG95bWVudHMgaWYgd2UgZXZlciBoYXZlIGEgYmV0dGVyIG1ldGhvZCBvZiBwcm9ncmVzcyBkaXNwbGF5aW5nLlxuICAgICAgLy8gTm90ZTogdGhpcyBtYXkgaW50cm9kdWNlIGEgY3ljbGUgaWYgb25lIG9mIHRoZSBwYXJlbnQncyBkZXBlbmRlbmNpZXMgaXMgYW5vdGhlciBzdGFjayB0aGF0XG4gICAgICAvLyBkZXBlbmRzIG9uIHRoaXMgYXNzZXQuIFRvIHdvcmthcm91bmQgdGhpcyB3ZSByZW1vdmUgdGhlc2UgY3ljbGVzIG9uY2UgYWxsIG5vZGVzIGhhdmVcbiAgICAgIC8vIGJlZW4gYWRkZWQgdG8gdGhlIGdyYXBoLlxuICAgICAgdGhpcy5ncmFwaC5hZGREZXBlbmRlbmN5KHB1Ymxpc2hJZCwgaW5oZXJpdGVkRGVwKTtcbiAgICB9XG5cbiAgICAvLyBUaGlzIHdpbGwgd29yayB3aGV0aGVyIHRoZSBzdGFjayBub2RlIGhhcyBiZWVuIGFkZGVkIHlldCBvciBub3RcbiAgICB0aGlzLmdyYXBoLmFkZERlcGVuZGVuY3koYCR7dGhpcy5pZFByZWZpeH0ke3BhcmVudFN0YWNrLmlkfWAsIHB1Ymxpc2hJZCk7XG4gIH1cblxuICBwdWJsaWMgYnVpbGQoYXJ0aWZhY3RzOiBjeGFwaS5DbG91ZEFydGlmYWN0W10pOiBXb3JrR3JhcGgge1xuICAgIGNvbnN0IHBhcmVudFN0YWNrcyA9IHN0YWNrc0Zyb21Bc3NldHMoYXJ0aWZhY3RzKTtcblxuICAgIGZvciAoY29uc3QgYXJ0aWZhY3Qgb2YgYXJ0aWZhY3RzKSB7XG4gICAgICBpZiAoY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LmlzQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KGFydGlmYWN0KSkge1xuICAgICAgICB0aGlzLmFkZFN0YWNrKGFydGlmYWN0KTtcbiAgICAgIH0gZWxzZSBpZiAoY3hhcGkuQXNzZXRNYW5pZmVzdEFydGlmYWN0LmlzQXNzZXRNYW5pZmVzdEFydGlmYWN0KGFydGlmYWN0KSkge1xuICAgICAgICBjb25zdCBtYW5pZmVzdCA9IEFzc2V0TWFuaWZlc3QuZnJvbUZpbGUoYXJ0aWZhY3QuZmlsZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBtYW5pZmVzdC5lbnRyaWVzKSB7XG4gICAgICAgICAgY29uc3QgcGFyZW50U3RhY2sgPSBwYXJlbnRTdGFja3MuZ2V0KGFydGlmYWN0KTtcbiAgICAgICAgICBpZiAocGFyZW50U3RhY2sgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcignRm91bmQgYW4gYXNzZXQgbWFuaWZlc3QgdGhhdCBpcyBub3QgYXNzb2NpYXRlZCB3aXRoIGEgc3RhY2snKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5hZGRBc3NldChwYXJlbnRTdGFjaywgYXJ0aWZhY3QsIG1hbmlmZXN0LCBlbnRyeSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoY3hhcGkuTmVzdGVkQ2xvdWRBc3NlbWJseUFydGlmYWN0LmlzTmVzdGVkQ2xvdWRBc3NlbWJseUFydGlmYWN0KGFydGlmYWN0KSkge1xuICAgICAgICBjb25zdCBhc3NlbWJseSA9IG5ldyBjeGFwaS5DbG91ZEFzc2VtYmx5KGFydGlmYWN0LmZ1bGxQYXRoLCB7IHRvcG9Tb3J0OiBmYWxzZSB9KTtcbiAgICAgICAgY29uc3QgbmVzdGVkR3JhcGggPSBuZXcgV29ya0dyYXBoQnVpbGRlcihcbiAgICAgICAgICB0aGlzLmlvSGVscGVyLFxuICAgICAgICAgIHRoaXMucHJlYnVpbGRBc3NldHMsXG4gICAgICAgICAgYCR7dGhpcy5pZFByZWZpeH0ke2FydGlmYWN0LmlkfS5gLFxuICAgICAgICApLmJ1aWxkKGFzc2VtYmx5LmFydGlmYWN0cyk7XG4gICAgICAgIHRoaXMuZ3JhcGguYWJzb3JiKG5lc3RlZEdyYXBoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElnbm9yZSB3aGF0ZXZlciBlbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5ncmFwaC5yZW1vdmVVbmF2YWlsYWJsZURlcGVuZGVuY2llcygpO1xuXG4gICAgLy8gUmVtb3ZlIGFueSBwb3RlbnRpYWxseSBpbnRyb2R1Y2VkIGN5Y2xlcyBiZXR3ZWVuIGFzc2V0IHB1Ymxpc2hpbmcgYW5kIHRoZSBzdGFja3MgdGhhdCBkZXBlbmQgb24gdGhlbS5cbiAgICB0aGlzLnJlbW92ZVN0YWNrUHVibGlzaEN5Y2xlcygpO1xuXG4gICAgcmV0dXJuIHRoaXMuZ3JhcGg7XG4gIH1cblxuICBwcml2YXRlIHN0YWNrQXJ0aWZhY3RJZHMoZGVwczogY3hhcGkuQ2xvdWRBcnRpZmFjdFtdKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBkZXBzLmZsYXRNYXAoKGQpID0+IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdC5pc0Nsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdChkKSA/IFt0aGlzLnN0YWNrQXJ0aWZhY3RJZChkKV0gOiBbXSk7XG4gIH1cblxuICBwcml2YXRlIHN0YWNrQXJ0aWZhY3RJZChhcnRpZmFjdDogY3hhcGkuQ2xvdWRBcnRpZmFjdCk6IHN0cmluZyB7XG4gICAgaWYgKCFjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QuaXNDbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QoYXJ0aWZhY3QpKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBDYW4gb25seSBjYWxsIHRoaXMgb24gQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LCBnb3Q6ICR7YXJ0aWZhY3QuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGAke3RoaXMuaWRQcmVmaXh9JHthcnRpZmFjdC5pZH1gO1xuICB9XG5cbiAgLyoqXG4gICAqIFdlIG1heSBoYXZlIGFjY2lkZW50YWxseSBpbnRyb2R1Y2VkIGN5Y2xlcyBpbiBhbiBhdHRlbXB0IHRvIG1ha2UgdGhlIG1lc3NhZ2VzIHByaW50ZWQgdG8gdGhlXG4gICAqIGNvbnNvbGUgbm90IGludGVyZmVyZSB3aXRoIGVhY2ggb3RoZXIgdG9vIG11Y2guIFJlbW92ZSB0aGVtIGFnYWluLlxuICAgKi9cbiAgcHJpdmF0ZSByZW1vdmVTdGFja1B1Ymxpc2hDeWNsZXMoKSB7XG4gICAgY29uc3QgcHVibGlzaFN0ZXBzID0gdGhpcy5ncmFwaC5ub2Rlc09mVHlwZSgnYXNzZXQtcHVibGlzaCcpO1xuICAgIGZvciAoY29uc3QgcHVibGlzaFN0ZXAgb2YgcHVibGlzaFN0ZXBzKSB7XG4gICAgICBmb3IgKGNvbnN0IGRlcCBvZiBwdWJsaXNoU3RlcC5kZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgaWYgKHRoaXMuZ3JhcGgucmVhY2hhYmxlKGRlcCwgcHVibGlzaFN0ZXAuaWQpKSB7XG4gICAgICAgICAgcHVibGlzaFN0ZXAuZGVwZW5kZW5jaWVzLmRlbGV0ZShkZXApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHN0YWNrc0Zyb21Bc3NldHMoYXJ0aWZhY3RzOiBjeGFwaS5DbG91ZEFydGlmYWN0W10pIHtcbiAgY29uc3QgcmV0ID0gbmV3IE1hcDxjeGFwaS5Bc3NldE1hbmlmZXN0QXJ0aWZhY3QsIGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdD4oKTtcbiAgZm9yIChjb25zdCBzdGFjayBvZiBhcnRpZmFjdHMuZmlsdGVyKHggPT4gY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LmlzQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KHgpKSkge1xuICAgIGNvbnN0IGFzc2V0QXJ0aWZhY3RzID0gc3RhY2suZGVwZW5kZW5jaWVzLmZpbHRlcigoeCkgPT4gY3hhcGkuQXNzZXRNYW5pZmVzdEFydGlmYWN0LmlzQXNzZXRNYW5pZmVzdEFydGlmYWN0KHgpKTtcbiAgICBmb3IgKGNvbnN0IGFydCBvZiBhc3NldEFydGlmYWN0cykge1xuICAgICAgcmV0LnNldChhcnQsIHN0YWNrKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmV0O1xufVxuXG5mdW5jdGlvbiBvbmx5U3RhY2tzKGFydGlmYWN0czogY3hhcGkuQ2xvdWRBcnRpZmFjdFtdKSB7XG4gIHJldHVybiBhcnRpZmFjdHMuZmlsdGVyKHggPT4gY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LmlzQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KHgpKTtcbn1cbiJdfQ==