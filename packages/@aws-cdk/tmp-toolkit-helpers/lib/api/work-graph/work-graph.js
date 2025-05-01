"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkGraph = void 0;
const work_graph_types_1 = require("./work-graph-types");
const util_1 = require("../../util");
const private_1 = require("../io/private");
const toolkit_error_1 = require("../toolkit-error");
class WorkGraph {
    nodes;
    readyPool = [];
    lazyDependencies = new Map();
    ioHelper;
    error;
    constructor(nodes, ioHelper) {
        this.nodes = { ...nodes };
        this.ioHelper = ioHelper;
    }
    addNodes(...nodes) {
        for (const node of nodes) {
            if (this.nodes[node.id]) {
                throw new toolkit_error_1.ToolkitError(`Duplicate use of node id: ${node.id}`);
            }
            const ld = this.lazyDependencies.get(node.id);
            if (ld) {
                for (const x of ld) {
                    node.dependencies.add(x);
                }
                this.lazyDependencies.delete(node.id);
            }
            this.nodes[node.id] = node;
        }
    }
    removeNode(nodeId) {
        const id = typeof nodeId === 'string' ? nodeId : nodeId.id;
        const removedNode = this.nodes[id];
        this.lazyDependencies.delete(id);
        delete this.nodes[id];
        if (removedNode) {
            for (const node of Object.values(this.nodes)) {
                node.dependencies.delete(removedNode.id);
            }
        }
    }
    /**
     * Return all nodes of a given type
     */
    nodesOfType(type) {
        return Object.values(this.nodes).filter(n => n.type === type);
    }
    /**
     * Return all nodes that depend on a given node
     */
    dependees(nodeId) {
        const id = typeof nodeId === 'string' ? nodeId : nodeId.id;
        return Object.values(this.nodes).filter(n => n.dependencies.has(id));
    }
    /**
     * Add a dependency, that may come before or after the nodes involved
     */
    addDependency(fromId, toId) {
        const node = this.nodes[fromId];
        if (node) {
            node.dependencies.add(toId);
            return;
        }
        let lazyDeps = this.lazyDependencies.get(fromId);
        if (!lazyDeps) {
            lazyDeps = [];
            this.lazyDependencies.set(fromId, lazyDeps);
        }
        lazyDeps.push(toId);
    }
    tryGetNode(id) {
        return this.nodes[id];
    }
    node(id) {
        const ret = this.nodes[id];
        if (!ret) {
            throw new toolkit_error_1.ToolkitError(`No node with id ${id} among ${Object.keys(this.nodes)}`);
        }
        return ret;
    }
    absorb(graph) {
        this.addNodes(...Object.values(graph.nodes));
    }
    hasFailed() {
        return Object.values(this.nodes).some((n) => n.deploymentState === work_graph_types_1.DeploymentState.FAILED);
    }
    doParallel(concurrency, actions) {
        return this.forAllArtifacts(concurrency, async (x) => {
            switch (x.type) {
                case 'stack':
                    await actions.deployStack(x);
                    break;
                case 'asset-build':
                    await actions.buildAsset(x);
                    break;
                case 'asset-publish':
                    await actions.publishAsset(x);
                    break;
            }
        });
    }
    /**
     * Return the set of unblocked nodes
     */
    async ready() {
        await this.updateReadyPool();
        return this.readyPool;
    }
    forAllArtifacts(n, fn) {
        const graph = this;
        // If 'n' is a number, we limit all concurrency equally (effectively we will be using totalMax)
        // If 'n' is a record, we limit each job independently (effectively we will be using max)
        const max = typeof n === 'number' ?
            {
                'asset-build': n,
                'asset-publish': n,
                'stack': n,
            } : n;
        const totalMax = typeof n === 'number' ? n : sum(Object.values(n));
        return new Promise((ok, fail) => {
            let active = {
                'asset-build': 0,
                'asset-publish': 0,
                'stack': 0,
            };
            function totalActive() {
                return sum(Object.values(active));
            }
            start();
            function start() {
                graph.updateReadyPool().then(() => {
                    for (let i = 0; i < graph.readyPool.length;) {
                        const node = graph.readyPool[i];
                        if (active[node.type] < max[node.type] && totalActive() < totalMax) {
                            graph.readyPool.splice(i, 1);
                            startOne(node);
                        }
                        else {
                            i += 1;
                        }
                    }
                    if (totalActive() === 0) {
                        if (graph.done()) {
                            ok();
                        }
                        // wait for other active deploys to finish before failing
                        if (graph.hasFailed()) {
                            fail(graph.error);
                        }
                    }
                }).catch((e) => {
                    fail(e);
                });
            }
            function startOne(x) {
                x.deploymentState = work_graph_types_1.DeploymentState.DEPLOYING;
                active[x.type]++;
                void fn(x)
                    .finally(() => {
                    active[x.type]--;
                })
                    .then(() => {
                    graph.deployed(x);
                    start();
                }).catch((err) => {
                    // By recording the failure immediately as the queued task exits, we prevent the next
                    // queued task from starting.
                    graph.failed(x, err);
                    start();
                });
            }
        });
    }
    done() {
        return Object.values(this.nodes).every((n) => work_graph_types_1.DeploymentState.COMPLETED === n.deploymentState);
    }
    deployed(node) {
        node.deploymentState = work_graph_types_1.DeploymentState.COMPLETED;
    }
    failed(node, error) {
        this.error = error;
        node.deploymentState = work_graph_types_1.DeploymentState.FAILED;
        this.skipRest();
        this.readyPool.splice(0);
    }
    toString() {
        return [
            'digraph D {',
            ...Object.entries(this.nodes).flatMap(([id, node]) => renderNode(id, node)),
            '}',
        ].join('\n');
        function renderNode(id, node) {
            const ret = [];
            if (node.deploymentState === work_graph_types_1.DeploymentState.COMPLETED) {
                ret.push(`  ${gv(id, { style: 'filled', fillcolor: 'yellow', comment: node.note })};`);
            }
            else {
                ret.push(`  ${gv(id, { comment: node.note })};`);
            }
            for (const dep of node.dependencies) {
                ret.push(`  ${gv(id)} -> ${gv(dep)};`);
            }
            return ret;
        }
    }
    /**
     * Ensure all dependencies actually exist. This protects against scenarios such as the following:
     * StackA depends on StackB, but StackB is not selected to deploy. The dependency is redundant
     * and will be dropped.
     * This assumes the manifest comes uncorrupted so we will not fail if a dependency is not found.
     */
    removeUnavailableDependencies() {
        for (const node of Object.values(this.nodes)) {
            const removeDeps = Array.from(node.dependencies).filter((dep) => this.nodes[dep] === undefined);
            removeDeps.forEach((d) => {
                node.dependencies.delete(d);
            });
        }
    }
    /**
     * Remove all asset publishing steps for assets that are already published, and then build
     * that aren't used anymore.
     *
     * Do this in parallel, because there may be a lot of assets in an application (seen in practice: >100 assets)
     */
    async removeUnnecessaryAssets(isUnnecessary) {
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('Checking for previously published assets'));
        const publishes = this.nodesOfType('asset-publish');
        const classifiedNodes = await (0, util_1.parallelPromises)(8, publishes.map((assetNode) => async () => [assetNode, await isUnnecessary(assetNode)]));
        const alreadyPublished = classifiedNodes.filter(([_, unnecessary]) => unnecessary).map(([assetNode, _]) => assetNode);
        for (const assetNode of alreadyPublished) {
            this.removeNode(assetNode);
        }
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${publishes.length} total assets, ${publishes.length - alreadyPublished.length} still need to be published`));
        // Now also remove any asset build steps that don't have any dependencies on them anymore
        const unusedBuilds = this.nodesOfType('asset-build').filter(build => this.dependees(build).length === 0);
        for (const unusedBuild of unusedBuilds) {
            this.removeNode(unusedBuild);
        }
    }
    async updateReadyPool() {
        const activeCount = Object.values(this.nodes).filter((x) => x.deploymentState === work_graph_types_1.DeploymentState.DEPLOYING).length;
        const pendingCount = Object.values(this.nodes).filter((x) => x.deploymentState === work_graph_types_1.DeploymentState.PENDING).length;
        const newlyReady = Object.values(this.nodes).filter((x) => x.deploymentState === work_graph_types_1.DeploymentState.PENDING &&
            Array.from(x.dependencies).every((id) => this.node(id).deploymentState === work_graph_types_1.DeploymentState.COMPLETED));
        // Add newly available nodes to the ready pool
        for (const node of newlyReady) {
            node.deploymentState = work_graph_types_1.DeploymentState.QUEUED;
            this.readyPool.push(node);
        }
        // Remove nodes from the ready pool that have already started deploying
        retainOnly(this.readyPool, (node) => node.deploymentState === work_graph_types_1.DeploymentState.QUEUED);
        // Sort by reverse priority
        this.readyPool.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        if (this.readyPool.length === 0 && activeCount === 0 && pendingCount > 0) {
            const cycle = this.findCycle() ?? ['No cycle found!'];
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_TRACE.msg(`Cycle ${cycle.join(' -> ')} in graph ${this}`));
            throw new toolkit_error_1.ToolkitError(`Unable to make progress anymore, dependency cycle between remaining artifacts: ${cycle.join(' -> ')} (run with -vv for full graph)`);
        }
    }
    skipRest() {
        for (const node of Object.values(this.nodes)) {
            if ([work_graph_types_1.DeploymentState.QUEUED, work_graph_types_1.DeploymentState.PENDING].includes(node.deploymentState)) {
                node.deploymentState = work_graph_types_1.DeploymentState.SKIPPED;
            }
        }
    }
    /**
     * Find cycles in a graph
     *
     * Not the fastest, but effective and should be rare
     */
    findCycle() {
        const seen = new Set();
        const self = this;
        for (const nodeId of Object.keys(this.nodes)) {
            const cycle = recurse(nodeId, [nodeId]);
            if (cycle) {
                return cycle;
            }
        }
        return undefined;
        function recurse(nodeId, path) {
            if (seen.has(nodeId)) {
                return undefined;
            }
            try {
                for (const dep of self.nodes[nodeId].dependencies ?? []) {
                    const index = path.indexOf(dep);
                    if (index > -1) {
                        return [...path.slice(index), dep];
                    }
                    const cycle = recurse(dep, [...path, dep]);
                    if (cycle) {
                        return cycle;
                    }
                }
                return undefined;
            }
            finally {
                seen.add(nodeId);
            }
        }
    }
    /**
     * Whether the `end` node is reachable from the `start` node, following the dependency arrows
     */
    reachable(start, end) {
        const seen = new Set();
        const self = this;
        return recurse(start);
        function recurse(current) {
            if (seen.has(current)) {
                return false;
            }
            seen.add(current);
            if (current === end) {
                return true;
            }
            for (const dep of self.nodes[current].dependencies) {
                if (recurse(dep)) {
                    return true;
                }
            }
            return false;
        }
    }
}
exports.WorkGraph = WorkGraph;
function sum(xs) {
    let ret = 0;
    for (const x of xs) {
        ret += x;
    }
    return ret;
}
function retainOnly(xs, pred) {
    xs.splice(0, xs.length, ...xs.filter(pred));
}
function gv(id, attrs) {
    const attrString = Object.entries(attrs ?? {}).flatMap(([k, v]) => v !== undefined ? [`${k}="${v}"`] : []).join(',');
    return attrString ? `"${simplifyId(id)}" [${attrString}]` : `"${simplifyId(id)}"`;
}
function simplifyId(id) {
    return id.replace(/([0-9a-f]{6})[0-9a-f]{6,}/g, '$1');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29yay1ncmFwaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvd29yay1ncmFwaC93b3JrLWdyYXBoLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHlEQUFxRDtBQUNyRCxxQ0FBOEM7QUFDOUMsMkNBQWtEO0FBQ2xELG9EQUFnRDtBQUdoRCxNQUFhLFNBQVM7SUFDSixLQUFLLENBQTJCO0lBQy9CLFNBQVMsR0FBb0IsRUFBRSxDQUFDO0lBQ2hDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFvQixDQUFDO0lBQy9DLFFBQVEsQ0FBVztJQUU3QixLQUFLLENBQVM7SUFFckIsWUFBbUIsS0FBK0IsRUFBRSxRQUFrQjtRQUNwRSxJQUFJLENBQUMsS0FBSyxHQUFHLEVBQUUsR0FBRyxLQUFLLEVBQUUsQ0FBQztRQUMxQixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUMzQixDQUFDO0lBRU0sUUFBUSxDQUFDLEdBQUcsS0FBaUI7UUFDbEMsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUN6QixJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7Z0JBQ3hCLE1BQU0sSUFBSSw0QkFBWSxDQUFDLDZCQUE2QixJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNqRSxDQUFDO1lBRUQsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDOUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztnQkFDUCxLQUFLLE1BQU0sQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDO29CQUNuQixJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDM0IsQ0FBQztnQkFDRCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUN4QyxDQUFDO1lBRUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDO1FBQzdCLENBQUM7SUFDSCxDQUFDO0lBRU0sVUFBVSxDQUFDLE1BQXlCO1FBQ3pDLE1BQU0sRUFBRSxHQUFHLE9BQU8sTUFBTSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1FBQzNELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFbkMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUNqQyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFdEIsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixLQUFLLE1BQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQzdDLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUMzQyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNJLFdBQVcsQ0FBNkIsSUFBTztRQUNwRCxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFRLENBQUM7SUFDdkUsQ0FBQztJQUVEOztPQUVHO0lBQ0ksU0FBUyxDQUFDLE1BQXlCO1FBQ3hDLE1BQU0sRUFBRSxHQUFHLE9BQU8sTUFBTSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1FBQzNELE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUN2RSxDQUFDO0lBRUQ7O09BRUc7SUFDSSxhQUFhLENBQUMsTUFBYyxFQUFFLElBQVk7UUFDL0MsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNoQyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ1QsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDNUIsT0FBTztRQUNULENBQUM7UUFDRCxJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ2pELElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLFFBQVEsR0FBRyxFQUFFLENBQUM7WUFDZCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQztRQUM5QyxDQUFDO1FBQ0QsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN0QixDQUFDO0lBRU0sVUFBVSxDQUFDLEVBQVU7UUFDMUIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3hCLENBQUM7SUFFTSxJQUFJLENBQUMsRUFBVTtRQUNwQixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQzNCLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNULE1BQU0sSUFBSSw0QkFBWSxDQUFDLG1CQUFtQixFQUFFLFVBQVUsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ25GLENBQUM7UUFDRCxPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7SUFFTSxNQUFNLENBQUMsS0FBZ0I7UUFDNUIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7SUFDL0MsQ0FBQztJQUVPLFNBQVM7UUFDZixPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGVBQWUsS0FBSyxrQ0FBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQzdGLENBQUM7SUFFTSxVQUFVLENBQUMsV0FBd0IsRUFBRSxPQUF5QjtRQUNuRSxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsV0FBVyxFQUFFLEtBQUssRUFBRSxDQUFXLEVBQUUsRUFBRTtZQUM3RCxRQUFRLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDZixLQUFLLE9BQU87b0JBQ1YsTUFBTSxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUM3QixNQUFNO2dCQUNSLEtBQUssYUFBYTtvQkFDaEIsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUM1QixNQUFNO2dCQUNSLEtBQUssZUFBZTtvQkFDbEIsTUFBTSxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUM5QixNQUFNO1lBQ1YsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0ksS0FBSyxDQUFDLEtBQUs7UUFDaEIsTUFBTSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDN0IsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3hCLENBQUM7SUFFTyxlQUFlLENBQUMsQ0FBYyxFQUFFLEVBQWtDO1FBQ3hFLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQztRQUVuQiwrRkFBK0Y7UUFDL0YseUZBQXlGO1FBQ3pGLE1BQU0sR0FBRyxHQUFxQyxPQUFPLENBQUMsS0FBSyxRQUFRLENBQUMsQ0FBQztZQUNuRTtnQkFDRSxhQUFhLEVBQUUsQ0FBQztnQkFDaEIsZUFBZSxFQUFFLENBQUM7Z0JBQ2xCLE9BQU8sRUFBRSxDQUFDO2FBQ1gsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ1IsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFbkUsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRTtZQUM5QixJQUFJLE1BQU0sR0FBcUM7Z0JBQzdDLGFBQWEsRUFBRSxDQUFDO2dCQUNoQixlQUFlLEVBQUUsQ0FBQztnQkFDbEIsT0FBTyxFQUFFLENBQUM7YUFDWCxDQUFDO1lBQ0YsU0FBUyxXQUFXO2dCQUNsQixPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFDcEMsQ0FBQztZQUVELEtBQUssRUFBRSxDQUFDO1lBRVIsU0FBUyxLQUFLO2dCQUNaLEtBQUssQ0FBQyxlQUFlLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFO29CQUNoQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUksQ0FBQzt3QkFDN0MsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQzt3QkFFaEMsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksV0FBVyxFQUFFLEdBQUcsUUFBUSxFQUFFLENBQUM7NEJBQ25FLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQzs0QkFDN0IsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO3dCQUNqQixDQUFDOzZCQUFNLENBQUM7NEJBQ04sQ0FBQyxJQUFJLENBQUMsQ0FBQzt3QkFDVCxDQUFDO29CQUNILENBQUM7b0JBRUQsSUFBSSxXQUFXLEVBQUUsS0FBSyxDQUFDLEVBQUUsQ0FBQzt3QkFDeEIsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQzs0QkFDakIsRUFBRSxFQUFFLENBQUM7d0JBQ1AsQ0FBQzt3QkFDRCx5REFBeUQ7d0JBQ3pELElBQUksS0FBSyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUM7NEJBQ3RCLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7d0JBQ3BCLENBQUM7b0JBQ0gsQ0FBQztnQkFDSCxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRTtvQkFDYixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ1YsQ0FBQyxDQUFDLENBQUM7WUFDTCxDQUFDO1lBRUQsU0FBUyxRQUFRLENBQUMsQ0FBVztnQkFDM0IsQ0FBQyxDQUFDLGVBQWUsR0FBRyxrQ0FBZSxDQUFDLFNBQVMsQ0FBQztnQkFDOUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUNqQixLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUM7cUJBQ1AsT0FBTyxDQUFDLEdBQUcsRUFBRTtvQkFDWixNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ25CLENBQUMsQ0FBQztxQkFDRCxJQUFJLENBQUMsR0FBRyxFQUFFO29CQUNULEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQ2xCLEtBQUssRUFBRSxDQUFDO2dCQUNWLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFO29CQUNmLHFGQUFxRjtvQkFDckYsNkJBQTZCO29CQUM3QixLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQztvQkFDckIsS0FBSyxFQUFFLENBQUM7Z0JBQ1YsQ0FBQyxDQUFDLENBQUM7WUFDUCxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU8sSUFBSTtRQUNWLE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQ0FBZSxDQUFDLFNBQVMsS0FBSyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUM7SUFDakcsQ0FBQztJQUVPLFFBQVEsQ0FBQyxJQUFjO1FBQzdCLElBQUksQ0FBQyxlQUFlLEdBQUcsa0NBQWUsQ0FBQyxTQUFTLENBQUM7SUFDbkQsQ0FBQztJQUVPLE1BQU0sQ0FBQyxJQUFjLEVBQUUsS0FBYTtRQUMxQyxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztRQUNuQixJQUFJLENBQUMsZUFBZSxHQUFHLGtDQUFlLENBQUMsTUFBTSxDQUFDO1FBQzlDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNoQixJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUMzQixDQUFDO0lBRU0sUUFBUTtRQUNiLE9BQU87WUFDTCxhQUFhO1lBQ2IsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQztZQUMzRSxHQUFHO1NBQ0osQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFYixTQUFTLFVBQVUsQ0FBQyxFQUFVLEVBQUUsSUFBYztZQUM1QyxNQUFNLEdBQUcsR0FBRyxFQUFFLENBQUM7WUFDZixJQUFJLElBQUksQ0FBQyxlQUFlLEtBQUssa0NBQWUsQ0FBQyxTQUFTLEVBQUUsQ0FBQztnQkFDdkQsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUN6RixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ25ELENBQUM7WUFDRCxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDcEMsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3pDLENBQUM7WUFDRCxPQUFPLEdBQUcsQ0FBQztRQUNiLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSSw2QkFBNkI7UUFDbEMsS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzdDLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxTQUFTLENBQUMsQ0FBQztZQUVoRyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7Z0JBQ3ZCLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlCLENBQUMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNJLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxhQUF3RDtRQUMzRixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsMENBQTBDLENBQUMsQ0FBQyxDQUFDO1FBRXJHLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLENBQUM7UUFFcEQsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFBLHVCQUFnQixFQUM1QyxDQUFDLEVBQ0QsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsS0FBSyxJQUFHLEVBQUUsQ0FBQyxDQUFDLFNBQVMsRUFBRSxNQUFNLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBVSxDQUFDLENBQUMsQ0FBQztRQUVqRyxNQUFNLGdCQUFnQixHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxXQUFXLENBQUMsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3RILEtBQUssTUFBTSxTQUFTLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUN6QyxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzdCLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsR0FBRyxTQUFTLENBQUMsTUFBTSxrQkFBa0IsU0FBUyxDQUFDLE1BQU0sR0FBRyxnQkFBZ0IsQ0FBQyxNQUFNLDZCQUE2QixDQUFDLENBQUMsQ0FBQztRQUV2Syx5RkFBeUY7UUFDekYsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDLENBQUMsQ0FBQztRQUN6RyxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDL0IsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsZUFBZTtRQUMzQixNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxlQUFlLEtBQUssa0NBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDcEgsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsZUFBZSxLQUFLLGtDQUFlLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxDQUFDO1FBRW5ILE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQ3hELENBQUMsQ0FBQyxlQUFlLEtBQUssa0NBQWUsQ0FBQyxPQUFPO1lBQzdDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxlQUFlLEtBQUssa0NBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO1FBRXpHLDhDQUE4QztRQUM5QyxLQUFLLE1BQU0sSUFBSSxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQzlCLElBQUksQ0FBQyxlQUFlLEdBQUcsa0NBQWUsQ0FBQyxNQUFNLENBQUM7WUFDOUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDNUIsQ0FBQztRQUVELHVFQUF1RTtRQUN2RSxVQUFVLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGVBQWUsS0FBSyxrQ0FBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRXRGLDJCQUEyQjtRQUMzQixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxRQUFRLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVyRSxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxXQUFXLEtBQUssQ0FBQyxJQUFJLFlBQVksR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN6RSxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQ3RELE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsWUFBRSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxTQUFTLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3pHLE1BQU0sSUFBSSw0QkFBWSxDQUFDLGtGQUFrRixLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO1FBQy9KLENBQUM7SUFDSCxDQUFDO0lBRU8sUUFBUTtRQUNkLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxJQUFJLENBQUMsa0NBQWUsQ0FBQyxNQUFNLEVBQUUsa0NBQWUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7Z0JBQ3JGLElBQUksQ0FBQyxlQUFlLEdBQUcsa0NBQWUsQ0FBQyxPQUFPLENBQUM7WUFDakQsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNJLFNBQVM7UUFDZCxNQUFNLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1FBQy9CLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQztRQUNsQixLQUFLLE1BQU0sTUFBTSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0MsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFDeEMsSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDVixPQUFPLEtBQUssQ0FBQztZQUNmLENBQUM7UUFDSCxDQUFDO1FBQ0QsT0FBTyxTQUFTLENBQUM7UUFFakIsU0FBUyxPQUFPLENBQUMsTUFBYyxFQUFFLElBQWM7WUFDN0MsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBQ3JCLE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7WUFDRCxJQUFJLENBQUM7Z0JBQ0gsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFlBQVksSUFBSSxFQUFFLEVBQUUsQ0FBQztvQkFDeEQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDaEMsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQzt3QkFDZixPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO29CQUNyQyxDQUFDO29CQUVELE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO29CQUMzQyxJQUFJLEtBQUssRUFBRSxDQUFDO3dCQUNWLE9BQU8sS0FBSyxDQUFDO29CQUNmLENBQUM7Z0JBQ0gsQ0FBQztnQkFFRCxPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO29CQUFTLENBQUM7Z0JBQ1QsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUNuQixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNJLFNBQVMsQ0FBQyxLQUFhLEVBQUUsR0FBVztRQUN6QyxNQUFNLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1FBQy9CLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQztRQUNsQixPQUFPLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUV0QixTQUFTLE9BQU8sQ0FBQyxPQUFlO1lBQzlCLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUN0QixPQUFPLEtBQUssQ0FBQztZQUNmLENBQUM7WUFDRCxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRWxCLElBQUksT0FBTyxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUNwQixPQUFPLElBQUksQ0FBQztZQUNkLENBQUM7WUFDRCxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBQ25ELElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ2pCLE9BQU8sSUFBSSxDQUFDO2dCQUNkLENBQUM7WUFDSCxDQUFDO1lBQ0QsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBdFhELDhCQXNYQztBQVFELFNBQVMsR0FBRyxDQUFDLEVBQVk7SUFDdkIsSUFBSSxHQUFHLEdBQUcsQ0FBQyxDQUFDO0lBQ1osS0FBSyxNQUFNLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztRQUNuQixHQUFHLElBQUksQ0FBQyxDQUFDO0lBQ1gsQ0FBQztJQUNELE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQztBQUVELFNBQVMsVUFBVSxDQUFJLEVBQU8sRUFBRSxJQUF1QjtJQUNyRCxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQzlDLENBQUM7QUFFRCxTQUFTLEVBQUUsQ0FBQyxFQUFVLEVBQUUsS0FBMEM7SUFDaEUsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRXJILE9BQU8sVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxFQUFFLENBQUMsTUFBTSxVQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxVQUFVLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQztBQUNwRixDQUFDO0FBRUQsU0FBUyxVQUFVLENBQUMsRUFBVTtJQUM1QixPQUFPLEVBQUUsQ0FBQyxPQUFPLENBQUMsNEJBQTRCLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDeEQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgV29ya05vZGUsIFN0YWNrTm9kZSwgQXNzZXRCdWlsZE5vZGUsIEFzc2V0UHVibGlzaE5vZGUgfSBmcm9tICcuL3dvcmstZ3JhcGgtdHlwZXMnO1xuaW1wb3J0IHsgRGVwbG95bWVudFN0YXRlIH0gZnJvbSAnLi93b3JrLWdyYXBoLXR5cGVzJztcbmltcG9ydCB7IHBhcmFsbGVsUHJvbWlzZXMgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcbmV4cG9ydCB0eXBlIENvbmN1cnJlbmN5ID0gbnVtYmVyIHwgUmVjb3JkPFdvcmtOb2RlWyd0eXBlJ10sIG51bWJlcj47XG5cbmV4cG9ydCBjbGFzcyBXb3JrR3JhcGgge1xuICBwdWJsaWMgcmVhZG9ubHkgbm9kZXM6IFJlY29yZDxzdHJpbmcsIFdvcmtOb2RlPjtcbiAgcHJpdmF0ZSByZWFkb25seSByZWFkeVBvb2w6IEFycmF5PFdvcmtOb2RlPiA9IFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IGxhenlEZXBlbmRlbmNpZXMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nW10+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgaW9IZWxwZXI6IElvSGVscGVyO1xuXG4gIHB1YmxpYyBlcnJvcj86IEVycm9yO1xuXG4gIHB1YmxpYyBjb25zdHJ1Y3Rvcihub2RlczogUmVjb3JkPHN0cmluZywgV29ya05vZGU+LCBpb0hlbHBlcjogSW9IZWxwZXIpIHtcbiAgICB0aGlzLm5vZGVzID0geyAuLi5ub2RlcyB9O1xuICAgIHRoaXMuaW9IZWxwZXIgPSBpb0hlbHBlcjtcbiAgfVxuXG4gIHB1YmxpYyBhZGROb2RlcyguLi5ub2RlczogV29ya05vZGVbXSkge1xuICAgIGZvciAoY29uc3Qgbm9kZSBvZiBub2Rlcykge1xuICAgICAgaWYgKHRoaXMubm9kZXNbbm9kZS5pZF0pIHtcbiAgICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgRHVwbGljYXRlIHVzZSBvZiBub2RlIGlkOiAke25vZGUuaWR9YCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxkID0gdGhpcy5sYXp5RGVwZW5kZW5jaWVzLmdldChub2RlLmlkKTtcbiAgICAgIGlmIChsZCkge1xuICAgICAgICBmb3IgKGNvbnN0IHggb2YgbGQpIHtcbiAgICAgICAgICBub2RlLmRlcGVuZGVuY2llcy5hZGQoeCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sYXp5RGVwZW5kZW5jaWVzLmRlbGV0ZShub2RlLmlkKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5ub2Rlc1tub2RlLmlkXSA9IG5vZGU7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHJlbW92ZU5vZGUobm9kZUlkOiBzdHJpbmcgfCBXb3JrTm9kZSkge1xuICAgIGNvbnN0IGlkID0gdHlwZW9mIG5vZGVJZCA9PT0gJ3N0cmluZycgPyBub2RlSWQgOiBub2RlSWQuaWQ7XG4gICAgY29uc3QgcmVtb3ZlZE5vZGUgPSB0aGlzLm5vZGVzW2lkXTtcblxuICAgIHRoaXMubGF6eURlcGVuZGVuY2llcy5kZWxldGUoaWQpO1xuICAgIGRlbGV0ZSB0aGlzLm5vZGVzW2lkXTtcblxuICAgIGlmIChyZW1vdmVkTm9kZSkge1xuICAgICAgZm9yIChjb25zdCBub2RlIG9mIE9iamVjdC52YWx1ZXModGhpcy5ub2RlcykpIHtcbiAgICAgICAgbm9kZS5kZXBlbmRlbmNpZXMuZGVsZXRlKHJlbW92ZWROb2RlLmlkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIGFsbCBub2RlcyBvZiBhIGdpdmVuIHR5cGVcbiAgICovXG4gIHB1YmxpYyBub2Rlc09mVHlwZTxUIGV4dGVuZHMgV29ya05vZGVbJ3R5cGUnXT4odHlwZTogVCk6IEV4dHJhY3Q8V29ya05vZGUsIHsgdHlwZTogVCB9PltdIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLm5vZGVzKS5maWx0ZXIobiA9PiBuLnR5cGUgPT09IHR5cGUpIGFzIGFueTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gYWxsIG5vZGVzIHRoYXQgZGVwZW5kIG9uIGEgZ2l2ZW4gbm9kZVxuICAgKi9cbiAgcHVibGljIGRlcGVuZGVlcyhub2RlSWQ6IHN0cmluZyB8IFdvcmtOb2RlKSB7XG4gICAgY29uc3QgaWQgPSB0eXBlb2Ygbm9kZUlkID09PSAnc3RyaW5nJyA/IG5vZGVJZCA6IG5vZGVJZC5pZDtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLm5vZGVzKS5maWx0ZXIobiA9PiBuLmRlcGVuZGVuY2llcy5oYXMoaWQpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSBkZXBlbmRlbmN5LCB0aGF0IG1heSBjb21lIGJlZm9yZSBvciBhZnRlciB0aGUgbm9kZXMgaW52b2x2ZWRcbiAgICovXG4gIHB1YmxpYyBhZGREZXBlbmRlbmN5KGZyb21JZDogc3RyaW5nLCB0b0lkOiBzdHJpbmcpIHtcbiAgICBjb25zdCBub2RlID0gdGhpcy5ub2Rlc1tmcm9tSWRdO1xuICAgIGlmIChub2RlKSB7XG4gICAgICBub2RlLmRlcGVuZGVuY2llcy5hZGQodG9JZCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxldCBsYXp5RGVwcyA9IHRoaXMubGF6eURlcGVuZGVuY2llcy5nZXQoZnJvbUlkKTtcbiAgICBpZiAoIWxhenlEZXBzKSB7XG4gICAgICBsYXp5RGVwcyA9IFtdO1xuICAgICAgdGhpcy5sYXp5RGVwZW5kZW5jaWVzLnNldChmcm9tSWQsIGxhenlEZXBzKTtcbiAgICB9XG4gICAgbGF6eURlcHMucHVzaCh0b0lkKTtcbiAgfVxuXG4gIHB1YmxpYyB0cnlHZXROb2RlKGlkOiBzdHJpbmcpOiBXb3JrTm9kZSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMubm9kZXNbaWRdO1xuICB9XG5cbiAgcHVibGljIG5vZGUoaWQ6IHN0cmluZykge1xuICAgIGNvbnN0IHJldCA9IHRoaXMubm9kZXNbaWRdO1xuICAgIGlmICghcmV0KSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBObyBub2RlIHdpdGggaWQgJHtpZH0gYW1vbmcgJHtPYmplY3Qua2V5cyh0aGlzLm5vZGVzKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuXG4gIHB1YmxpYyBhYnNvcmIoZ3JhcGg6IFdvcmtHcmFwaCkge1xuICAgIHRoaXMuYWRkTm9kZXMoLi4uT2JqZWN0LnZhbHVlcyhncmFwaC5ub2RlcykpO1xuICB9XG5cbiAgcHJpdmF0ZSBoYXNGYWlsZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5ub2Rlcykuc29tZSgobikgPT4gbi5kZXBsb3ltZW50U3RhdGUgPT09IERlcGxveW1lbnRTdGF0ZS5GQUlMRUQpO1xuICB9XG5cbiAgcHVibGljIGRvUGFyYWxsZWwoY29uY3VycmVuY3k6IENvbmN1cnJlbmN5LCBhY3Rpb25zOiBXb3JrR3JhcGhBY3Rpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuZm9yQWxsQXJ0aWZhY3RzKGNvbmN1cnJlbmN5LCBhc3luYyAoeDogV29ya05vZGUpID0+IHtcbiAgICAgIHN3aXRjaCAoeC50eXBlKSB7XG4gICAgICAgIGNhc2UgJ3N0YWNrJzpcbiAgICAgICAgICBhd2FpdCBhY3Rpb25zLmRlcGxveVN0YWNrKHgpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdhc3NldC1idWlsZCc6XG4gICAgICAgICAgYXdhaXQgYWN0aW9ucy5idWlsZEFzc2V0KHgpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdhc3NldC1wdWJsaXNoJzpcbiAgICAgICAgICBhd2FpdCBhY3Rpb25zLnB1Ymxpc2hBc3NldCh4KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gdGhlIHNldCBvZiB1bmJsb2NrZWQgbm9kZXNcbiAgICovXG4gIHB1YmxpYyBhc3luYyByZWFkeSgpOiBQcm9taXNlPFJlYWRvbmx5QXJyYXk8V29ya05vZGU+PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVSZWFkeVBvb2woKTtcbiAgICByZXR1cm4gdGhpcy5yZWFkeVBvb2w7XG4gIH1cblxuICBwcml2YXRlIGZvckFsbEFydGlmYWN0cyhuOiBDb25jdXJyZW5jeSwgZm46ICh4OiBXb3JrTm9kZSkgPT4gUHJvbWlzZTx2b2lkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGdyYXBoID0gdGhpcztcblxuICAgIC8vIElmICduJyBpcyBhIG51bWJlciwgd2UgbGltaXQgYWxsIGNvbmN1cnJlbmN5IGVxdWFsbHkgKGVmZmVjdGl2ZWx5IHdlIHdpbGwgYmUgdXNpbmcgdG90YWxNYXgpXG4gICAgLy8gSWYgJ24nIGlzIGEgcmVjb3JkLCB3ZSBsaW1pdCBlYWNoIGpvYiBpbmRlcGVuZGVudGx5IChlZmZlY3RpdmVseSB3ZSB3aWxsIGJlIHVzaW5nIG1heClcbiAgICBjb25zdCBtYXg6IFJlY29yZDxXb3JrTm9kZVsndHlwZSddLCBudW1iZXI+ID0gdHlwZW9mIG4gPT09ICdudW1iZXInID9cbiAgICAgIHtcbiAgICAgICAgJ2Fzc2V0LWJ1aWxkJzogbixcbiAgICAgICAgJ2Fzc2V0LXB1Ymxpc2gnOiBuLFxuICAgICAgICAnc3RhY2snOiBuLFxuICAgICAgfSA6IG47XG4gICAgY29uc3QgdG90YWxNYXggPSB0eXBlb2YgbiA9PT0gJ251bWJlcicgPyBuIDogc3VtKE9iamVjdC52YWx1ZXMobikpO1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChvaywgZmFpbCkgPT4ge1xuICAgICAgbGV0IGFjdGl2ZTogUmVjb3JkPFdvcmtOb2RlWyd0eXBlJ10sIG51bWJlcj4gPSB7XG4gICAgICAgICdhc3NldC1idWlsZCc6IDAsXG4gICAgICAgICdhc3NldC1wdWJsaXNoJzogMCxcbiAgICAgICAgJ3N0YWNrJzogMCxcbiAgICAgIH07XG4gICAgICBmdW5jdGlvbiB0b3RhbEFjdGl2ZSgpIHtcbiAgICAgICAgcmV0dXJuIHN1bShPYmplY3QudmFsdWVzKGFjdGl2ZSkpO1xuICAgICAgfVxuXG4gICAgICBzdGFydCgpO1xuXG4gICAgICBmdW5jdGlvbiBzdGFydCgpIHtcbiAgICAgICAgZ3JhcGgudXBkYXRlUmVhZHlQb29sKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBncmFwaC5yZWFkeVBvb2wubGVuZ3RoOyApIHtcbiAgICAgICAgICAgIGNvbnN0IG5vZGUgPSBncmFwaC5yZWFkeVBvb2xbaV07XG5cbiAgICAgICAgICAgIGlmIChhY3RpdmVbbm9kZS50eXBlXSA8IG1heFtub2RlLnR5cGVdICYmIHRvdGFsQWN0aXZlKCkgPCB0b3RhbE1heCkge1xuICAgICAgICAgICAgICBncmFwaC5yZWFkeVBvb2wuc3BsaWNlKGksIDEpO1xuICAgICAgICAgICAgICBzdGFydE9uZShub2RlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodG90YWxBY3RpdmUoKSA9PT0gMCkge1xuICAgICAgICAgICAgaWYgKGdyYXBoLmRvbmUoKSkge1xuICAgICAgICAgICAgICBvaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gd2FpdCBmb3Igb3RoZXIgYWN0aXZlIGRlcGxveXMgdG8gZmluaXNoIGJlZm9yZSBmYWlsaW5nXG4gICAgICAgICAgICBpZiAoZ3JhcGguaGFzRmFpbGVkKCkpIHtcbiAgICAgICAgICAgICAgZmFpbChncmFwaC5lcnJvcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KS5jYXRjaCgoZSkgPT4ge1xuICAgICAgICAgIGZhaWwoZSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBzdGFydE9uZSh4OiBXb3JrTm9kZSkge1xuICAgICAgICB4LmRlcGxveW1lbnRTdGF0ZSA9IERlcGxveW1lbnRTdGF0ZS5ERVBMT1lJTkc7XG4gICAgICAgIGFjdGl2ZVt4LnR5cGVdKys7XG4gICAgICAgIHZvaWQgZm4oeClcbiAgICAgICAgICAuZmluYWxseSgoKSA9PiB7XG4gICAgICAgICAgICBhY3RpdmVbeC50eXBlXS0tO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgZ3JhcGguZGVwbG95ZWQoeCk7XG4gICAgICAgICAgICBzdGFydCgpO1xuICAgICAgICAgIH0pLmNhdGNoKChlcnIpID0+IHtcbiAgICAgICAgICAgIC8vIEJ5IHJlY29yZGluZyB0aGUgZmFpbHVyZSBpbW1lZGlhdGVseSBhcyB0aGUgcXVldWVkIHRhc2sgZXhpdHMsIHdlIHByZXZlbnQgdGhlIG5leHRcbiAgICAgICAgICAgIC8vIHF1ZXVlZCB0YXNrIGZyb20gc3RhcnRpbmcuXG4gICAgICAgICAgICBncmFwaC5mYWlsZWQoeCwgZXJyKTtcbiAgICAgICAgICAgIHN0YXJ0KCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGRvbmUoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5ub2RlcykuZXZlcnkoKG4pID0+IERlcGxveW1lbnRTdGF0ZS5DT01QTEVURUQgPT09IG4uZGVwbG95bWVudFN0YXRlKTtcbiAgfVxuXG4gIHByaXZhdGUgZGVwbG95ZWQobm9kZTogV29ya05vZGUpIHtcbiAgICBub2RlLmRlcGxveW1lbnRTdGF0ZSA9IERlcGxveW1lbnRTdGF0ZS5DT01QTEVURUQ7XG4gIH1cblxuICBwcml2YXRlIGZhaWxlZChub2RlOiBXb3JrTm9kZSwgZXJyb3I/OiBFcnJvcikge1xuICAgIHRoaXMuZXJyb3IgPSBlcnJvcjtcbiAgICBub2RlLmRlcGxveW1lbnRTdGF0ZSA9IERlcGxveW1lbnRTdGF0ZS5GQUlMRUQ7XG4gICAgdGhpcy5za2lwUmVzdCgpO1xuICAgIHRoaXMucmVhZHlQb29sLnNwbGljZSgwKTtcbiAgfVxuXG4gIHB1YmxpYyB0b1N0cmluZygpIHtcbiAgICByZXR1cm4gW1xuICAgICAgJ2RpZ3JhcGggRCB7JyxcbiAgICAgIC4uLk9iamVjdC5lbnRyaWVzKHRoaXMubm9kZXMpLmZsYXRNYXAoKFtpZCwgbm9kZV0pID0+IHJlbmRlck5vZGUoaWQsIG5vZGUpKSxcbiAgICAgICd9JyxcbiAgICBdLmpvaW4oJ1xcbicpO1xuXG4gICAgZnVuY3Rpb24gcmVuZGVyTm9kZShpZDogc3RyaW5nLCBub2RlOiBXb3JrTm9kZSk6IHN0cmluZ1tdIHtcbiAgICAgIGNvbnN0IHJldCA9IFtdO1xuICAgICAgaWYgKG5vZGUuZGVwbG95bWVudFN0YXRlID09PSBEZXBsb3ltZW50U3RhdGUuQ09NUExFVEVEKSB7XG4gICAgICAgIHJldC5wdXNoKGAgICR7Z3YoaWQsIHsgc3R5bGU6ICdmaWxsZWQnLCBmaWxsY29sb3I6ICd5ZWxsb3cnLCBjb21tZW50OiBub2RlLm5vdGUgfSl9O2ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0LnB1c2goYCAgJHtndihpZCwgeyBjb21tZW50OiBub2RlLm5vdGUgfSl9O2ApO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBkZXAgb2Ygbm9kZS5kZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgcmV0LnB1c2goYCAgJHtndihpZCl9IC0+ICR7Z3YoZGVwKX07YCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmV0O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmUgYWxsIGRlcGVuZGVuY2llcyBhY3R1YWxseSBleGlzdC4gVGhpcyBwcm90ZWN0cyBhZ2FpbnN0IHNjZW5hcmlvcyBzdWNoIGFzIHRoZSBmb2xsb3dpbmc6XG4gICAqIFN0YWNrQSBkZXBlbmRzIG9uIFN0YWNrQiwgYnV0IFN0YWNrQiBpcyBub3Qgc2VsZWN0ZWQgdG8gZGVwbG95LiBUaGUgZGVwZW5kZW5jeSBpcyByZWR1bmRhbnRcbiAgICogYW5kIHdpbGwgYmUgZHJvcHBlZC5cbiAgICogVGhpcyBhc3N1bWVzIHRoZSBtYW5pZmVzdCBjb21lcyB1bmNvcnJ1cHRlZCBzbyB3ZSB3aWxsIG5vdCBmYWlsIGlmIGEgZGVwZW5kZW5jeSBpcyBub3QgZm91bmQuXG4gICAqL1xuICBwdWJsaWMgcmVtb3ZlVW5hdmFpbGFibGVEZXBlbmRlbmNpZXMoKSB7XG4gICAgZm9yIChjb25zdCBub2RlIG9mIE9iamVjdC52YWx1ZXModGhpcy5ub2RlcykpIHtcbiAgICAgIGNvbnN0IHJlbW92ZURlcHMgPSBBcnJheS5mcm9tKG5vZGUuZGVwZW5kZW5jaWVzKS5maWx0ZXIoKGRlcCkgPT4gdGhpcy5ub2Rlc1tkZXBdID09PSB1bmRlZmluZWQpO1xuXG4gICAgICByZW1vdmVEZXBzLmZvckVhY2goKGQpID0+IHtcbiAgICAgICAgbm9kZS5kZXBlbmRlbmNpZXMuZGVsZXRlKGQpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZSBhbGwgYXNzZXQgcHVibGlzaGluZyBzdGVwcyBmb3IgYXNzZXRzIHRoYXQgYXJlIGFscmVhZHkgcHVibGlzaGVkLCBhbmQgdGhlbiBidWlsZFxuICAgKiB0aGF0IGFyZW4ndCB1c2VkIGFueW1vcmUuXG4gICAqXG4gICAqIERvIHRoaXMgaW4gcGFyYWxsZWwsIGJlY2F1c2UgdGhlcmUgbWF5IGJlIGEgbG90IG9mIGFzc2V0cyBpbiBhbiBhcHBsaWNhdGlvbiAoc2VlbiBpbiBwcmFjdGljZTogPjEwMCBhc3NldHMpXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmVtb3ZlVW5uZWNlc3NhcnlBc3NldHMoaXNVbm5lY2Vzc2FyeTogKHg6IEFzc2V0UHVibGlzaE5vZGUpID0+IFByb21pc2U8Ym9vbGVhbj4pIHtcbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKCdDaGVja2luZyBmb3IgcHJldmlvdXNseSBwdWJsaXNoZWQgYXNzZXRzJykpO1xuXG4gICAgY29uc3QgcHVibGlzaGVzID0gdGhpcy5ub2Rlc09mVHlwZSgnYXNzZXQtcHVibGlzaCcpO1xuXG4gICAgY29uc3QgY2xhc3NpZmllZE5vZGVzID0gYXdhaXQgcGFyYWxsZWxQcm9taXNlcyhcbiAgICAgIDgsXG4gICAgICBwdWJsaXNoZXMubWFwKChhc3NldE5vZGUpID0+IGFzeW5jKCkgPT4gW2Fzc2V0Tm9kZSwgYXdhaXQgaXNVbm5lY2Vzc2FyeShhc3NldE5vZGUpXSBhcyBjb25zdCkpO1xuXG4gICAgY29uc3QgYWxyZWFkeVB1Ymxpc2hlZCA9IGNsYXNzaWZpZWROb2Rlcy5maWx0ZXIoKFtfLCB1bm5lY2Vzc2FyeV0pID0+IHVubmVjZXNzYXJ5KS5tYXAoKFthc3NldE5vZGUsIF9dKSA9PiBhc3NldE5vZGUpO1xuICAgIGZvciAoY29uc3QgYXNzZXROb2RlIG9mIGFscmVhZHlQdWJsaXNoZWQpIHtcbiAgICAgIHRoaXMucmVtb3ZlTm9kZShhc3NldE5vZGUpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7cHVibGlzaGVzLmxlbmd0aH0gdG90YWwgYXNzZXRzLCAke3B1Ymxpc2hlcy5sZW5ndGggLSBhbHJlYWR5UHVibGlzaGVkLmxlbmd0aH0gc3RpbGwgbmVlZCB0byBiZSBwdWJsaXNoZWRgKSk7XG5cbiAgICAvLyBOb3cgYWxzbyByZW1vdmUgYW55IGFzc2V0IGJ1aWxkIHN0ZXBzIHRoYXQgZG9uJ3QgaGF2ZSBhbnkgZGVwZW5kZW5jaWVzIG9uIHRoZW0gYW55bW9yZVxuICAgIGNvbnN0IHVudXNlZEJ1aWxkcyA9IHRoaXMubm9kZXNPZlR5cGUoJ2Fzc2V0LWJ1aWxkJykuZmlsdGVyKGJ1aWxkID0+IHRoaXMuZGVwZW5kZWVzKGJ1aWxkKS5sZW5ndGggPT09IDApO1xuICAgIGZvciAoY29uc3QgdW51c2VkQnVpbGQgb2YgdW51c2VkQnVpbGRzKSB7XG4gICAgICB0aGlzLnJlbW92ZU5vZGUodW51c2VkQnVpbGQpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlUmVhZHlQb29sKCkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gT2JqZWN0LnZhbHVlcyh0aGlzLm5vZGVzKS5maWx0ZXIoKHgpID0+IHguZGVwbG95bWVudFN0YXRlID09PSBEZXBsb3ltZW50U3RhdGUuREVQTE9ZSU5HKS5sZW5ndGg7XG4gICAgY29uc3QgcGVuZGluZ0NvdW50ID0gT2JqZWN0LnZhbHVlcyh0aGlzLm5vZGVzKS5maWx0ZXIoKHgpID0+IHguZGVwbG95bWVudFN0YXRlID09PSBEZXBsb3ltZW50U3RhdGUuUEVORElORykubGVuZ3RoO1xuXG4gICAgY29uc3QgbmV3bHlSZWFkeSA9IE9iamVjdC52YWx1ZXModGhpcy5ub2RlcykuZmlsdGVyKCh4KSA9PlxuICAgICAgeC5kZXBsb3ltZW50U3RhdGUgPT09IERlcGxveW1lbnRTdGF0ZS5QRU5ESU5HICYmXG4gICAgICBBcnJheS5mcm9tKHguZGVwZW5kZW5jaWVzKS5ldmVyeSgoaWQpID0+IHRoaXMubm9kZShpZCkuZGVwbG95bWVudFN0YXRlID09PSBEZXBsb3ltZW50U3RhdGUuQ09NUExFVEVEKSk7XG5cbiAgICAvLyBBZGQgbmV3bHkgYXZhaWxhYmxlIG5vZGVzIHRvIHRoZSByZWFkeSBwb29sXG4gICAgZm9yIChjb25zdCBub2RlIG9mIG5ld2x5UmVhZHkpIHtcbiAgICAgIG5vZGUuZGVwbG95bWVudFN0YXRlID0gRGVwbG95bWVudFN0YXRlLlFVRVVFRDtcbiAgICAgIHRoaXMucmVhZHlQb29sLnB1c2gobm9kZSk7XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIG5vZGVzIGZyb20gdGhlIHJlYWR5IHBvb2wgdGhhdCBoYXZlIGFscmVhZHkgc3RhcnRlZCBkZXBsb3lpbmdcbiAgICByZXRhaW5Pbmx5KHRoaXMucmVhZHlQb29sLCAobm9kZSkgPT4gbm9kZS5kZXBsb3ltZW50U3RhdGUgPT09IERlcGxveW1lbnRTdGF0ZS5RVUVVRUQpO1xuXG4gICAgLy8gU29ydCBieSByZXZlcnNlIHByaW9yaXR5XG4gICAgdGhpcy5yZWFkeVBvb2wuc29ydCgoYSwgYikgPT4gKGIucHJpb3JpdHkgPz8gMCkgLSAoYS5wcmlvcml0eSA/PyAwKSk7XG5cbiAgICBpZiAodGhpcy5yZWFkeVBvb2wubGVuZ3RoID09PSAwICYmIGFjdGl2ZUNvdW50ID09PSAwICYmIHBlbmRpbmdDb3VudCA+IDApIHtcbiAgICAgIGNvbnN0IGN5Y2xlID0gdGhpcy5maW5kQ3ljbGUoKSA/PyBbJ05vIGN5Y2xlIGZvdW5kISddO1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX1RSQUNFLm1zZyhgQ3ljbGUgJHtjeWNsZS5qb2luKCcgLT4gJyl9IGluIGdyYXBoICR7dGhpc31gKSk7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBVbmFibGUgdG8gbWFrZSBwcm9ncmVzcyBhbnltb3JlLCBkZXBlbmRlbmN5IGN5Y2xlIGJldHdlZW4gcmVtYWluaW5nIGFydGlmYWN0czogJHtjeWNsZS5qb2luKCcgLT4gJyl9IChydW4gd2l0aCAtdnYgZm9yIGZ1bGwgZ3JhcGgpYCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBza2lwUmVzdCgpIHtcbiAgICBmb3IgKGNvbnN0IG5vZGUgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLm5vZGVzKSkge1xuICAgICAgaWYgKFtEZXBsb3ltZW50U3RhdGUuUVVFVUVELCBEZXBsb3ltZW50U3RhdGUuUEVORElOR10uaW5jbHVkZXMobm9kZS5kZXBsb3ltZW50U3RhdGUpKSB7XG4gICAgICAgIG5vZGUuZGVwbG95bWVudFN0YXRlID0gRGVwbG95bWVudFN0YXRlLlNLSVBQRUQ7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmQgY3ljbGVzIGluIGEgZ3JhcGhcbiAgICpcbiAgICogTm90IHRoZSBmYXN0ZXN0LCBidXQgZWZmZWN0aXZlIGFuZCBzaG91bGQgYmUgcmFyZVxuICAgKi9cbiAgcHVibGljIGZpbmRDeWNsZSgpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGZvciAoY29uc3Qgbm9kZUlkIG9mIE9iamVjdC5rZXlzKHRoaXMubm9kZXMpKSB7XG4gICAgICBjb25zdCBjeWNsZSA9IHJlY3Vyc2Uobm9kZUlkLCBbbm9kZUlkXSk7XG4gICAgICBpZiAoY3ljbGUpIHtcbiAgICAgICAgcmV0dXJuIGN5Y2xlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgZnVuY3Rpb24gcmVjdXJzZShub2RlSWQ6IHN0cmluZywgcGF0aDogc3RyaW5nW10pOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgICBpZiAoc2Vlbi5oYXMobm9kZUlkKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgZm9yIChjb25zdCBkZXAgb2Ygc2VsZi5ub2Rlc1tub2RlSWRdLmRlcGVuZGVuY2llcyA/PyBbXSkge1xuICAgICAgICAgIGNvbnN0IGluZGV4ID0gcGF0aC5pbmRleE9mKGRlcCk7XG4gICAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHJldHVybiBbLi4ucGF0aC5zbGljZShpbmRleCksIGRlcF07XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgY3ljbGUgPSByZWN1cnNlKGRlcCwgWy4uLnBhdGgsIGRlcF0pO1xuICAgICAgICAgIGlmIChjeWNsZSkge1xuICAgICAgICAgICAgcmV0dXJuIGN5Y2xlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBzZWVuLmFkZChub2RlSWQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBgZW5kYCBub2RlIGlzIHJlYWNoYWJsZSBmcm9tIHRoZSBgc3RhcnRgIG5vZGUsIGZvbGxvd2luZyB0aGUgZGVwZW5kZW5jeSBhcnJvd3NcbiAgICovXG4gIHB1YmxpYyByZWFjaGFibGUoc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHJlY3Vyc2Uoc3RhcnQpO1xuXG4gICAgZnVuY3Rpb24gcmVjdXJzZShjdXJyZW50OiBzdHJpbmcpIHtcbiAgICAgIGlmIChzZWVuLmhhcyhjdXJyZW50KSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBzZWVuLmFkZChjdXJyZW50KTtcblxuICAgICAgaWYgKGN1cnJlbnQgPT09IGVuZCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZGVwIG9mIHNlbGYubm9kZXNbY3VycmVudF0uZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgIGlmIChyZWN1cnNlKGRlcCkpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdvcmtHcmFwaEFjdGlvbnMge1xuICBkZXBsb3lTdGFjazogKHN0YWNrTm9kZTogU3RhY2tOb2RlKSA9PiBQcm9taXNlPHZvaWQ+O1xuICBidWlsZEFzc2V0OiAoYXNzZXROb2RlOiBBc3NldEJ1aWxkTm9kZSkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgcHVibGlzaEFzc2V0OiAoYXNzZXROb2RlOiBBc3NldFB1Ymxpc2hOb2RlKSA9PiBQcm9taXNlPHZvaWQ+O1xufVxuXG5mdW5jdGlvbiBzdW0oeHM6IG51bWJlcltdKSB7XG4gIGxldCByZXQgPSAwO1xuICBmb3IgKGNvbnN0IHggb2YgeHMpIHtcbiAgICByZXQgKz0geDtcbiAgfVxuICByZXR1cm4gcmV0O1xufVxuXG5mdW5jdGlvbiByZXRhaW5Pbmx5PEE+KHhzOiBBW10sIHByZWQ6ICh4OiBBKSA9PiBib29sZWFuKSB7XG4gIHhzLnNwbGljZSgwLCB4cy5sZW5ndGgsIC4uLnhzLmZpbHRlcihwcmVkKSk7XG59XG5cbmZ1bmN0aW9uIGd2KGlkOiBzdHJpbmcsIGF0dHJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPikge1xuICBjb25zdCBhdHRyU3RyaW5nID0gT2JqZWN0LmVudHJpZXMoYXR0cnMgPz8ge30pLmZsYXRNYXAoKFtrLCB2XSkgPT4gdiAhPT0gdW5kZWZpbmVkID8gW2Ake2t9PVwiJHt2fVwiYF0gOiBbXSkuam9pbignLCcpO1xuXG4gIHJldHVybiBhdHRyU3RyaW5nID8gYFwiJHtzaW1wbGlmeUlkKGlkKX1cIiBbJHthdHRyU3RyaW5nfV1gIDogYFwiJHtzaW1wbGlmeUlkKGlkKX1cImA7XG59XG5cbmZ1bmN0aW9uIHNpbXBsaWZ5SWQoaWQ6IHN0cmluZykge1xuICByZXR1cm4gaWQucmVwbGFjZSgvKFswLTlhLWZdezZ9KVswLTlhLWZdezYsfS9nLCAnJDEnKTtcbn1cbiJdfQ==