"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeResourceDigests = computeResourceDigests;
exports.hashObject = hashObject;
const crypto = require("node:crypto");
const util_1 = require("@aws-cdk/cloudformation-diff/lib/diff/util");
/**
 * Computes the digest for each resource in the template.
 *
 * Conceptually, the digest is computed as:
 *
 *     d(resource) = hash(type + physicalId)                       , if physicalId is defined
 *                 = hash(type + properties + dependencies.map(d)) , otherwise
 *
 * where `hash` is a cryptographic hash function. In other words, if a resource has
 * a physical ID, we use the physical ID plus its type to uniquely identify
 * that resource. In this case, the digest can be computed from these two fields
 * alone. A corollary is that such resources can be renamed and have their
 * properties updated at the same time, and still be considered equivalent.
 *
 * Otherwise, the digest is computed from its type, its own properties (that is,
 * excluding properties that refer to other resources), and the digests of each of
 * its dependencies.
 *
 * The digest of a resource, defined recursively this way, remains stable even if
 * one or more of its dependencies gets renamed. Since the resources in a
 * CloudFormation template form a directed acyclic graph, this function is
 * well-defined.
 */
function computeResourceDigests(template) {
    const resources = template.Resources || {};
    const graph = {};
    const reverseGraph = {};
    // 1. Build adjacency lists
    for (const id of Object.keys(resources)) {
        graph[id] = new Set();
        reverseGraph[id] = new Set();
    }
    // 2. Detect dependencies by searching for Ref/Fn::GetAtt
    const findDependencies = (value) => {
        if (!value || typeof value !== 'object')
            return [];
        if (Array.isArray(value)) {
            return value.flatMap(findDependencies);
        }
        if ('Ref' in value) {
            return [value.Ref];
        }
        if ('Fn::GetAtt' in value) {
            const refTarget = Array.isArray(value['Fn::GetAtt']) ? value['Fn::GetAtt'][0] : value['Fn::GetAtt'].split('.')[0];
            return [refTarget];
        }
        if ('DependsOn' in value) {
            return [value.DependsOn];
        }
        return Object.values(value).flatMap(findDependencies);
    };
    for (const [id, res] of Object.entries(resources)) {
        const deps = findDependencies(res || {});
        for (const dep of deps) {
            if (dep in resources && dep !== id) {
                graph[id].add(dep);
                reverseGraph[dep].add(id);
            }
        }
    }
    // 3. Topological sort
    const outDegree = Object.keys(graph).reduce((acc, k) => {
        acc[k] = graph[k].size;
        return acc;
    }, {});
    const queue = Object.keys(outDegree).filter((k) => outDegree[k] === 0);
    const order = [];
    while (queue.length > 0) {
        const node = queue.shift();
        order.push(node);
        for (const nxt of reverseGraph[node]) {
            outDegree[nxt]--;
            if (outDegree[nxt] === 0) {
                queue.push(nxt);
            }
        }
    }
    // 4. Compute digests in sorted order
    const result = {};
    for (const id of order) {
        const resource = resources[id];
        const resourceProperties = resource.Properties ?? {};
        const model = (0, util_1.loadResourceModel)(resource.Type);
        const identifier = intersection(Object.keys(resourceProperties), model?.primaryIdentifier ?? []);
        let toHash;
        if (identifier.length === model?.primaryIdentifier?.length) {
            // The resource has a physical ID defined, so we can
            // use the ID and the type as the identity of the resource.
            toHash =
                resource.Type +
                    identifier
                        .sort()
                        .map((attr) => JSON.stringify(resourceProperties[attr]))
                        .join('');
        }
        else {
            // The resource does not have a physical ID defined, so we need to
            // compute the digest based on its properties and dependencies.
            const depDigests = Array.from(graph[id]).map((d) => result[d]);
            const propertiesHash = hashObject(stripReferences(stripConstructPath(resource)));
            toHash = resource.Type + propertiesHash + depDigests.join('');
        }
        result[id] = crypto.createHash('sha256').update(toHash).digest('hex');
    }
    return result;
}
function hashObject(obj) {
    const hash = crypto.createHash('sha256');
    function addToHash(value) {
        if (value == null) {
            addToHash('null');
        }
        else if (typeof value === 'object') {
            if (Array.isArray(value)) {
                value.forEach(addToHash);
            }
            else {
                Object.keys(value)
                    .sort()
                    .forEach((key) => {
                    hash.update(key);
                    addToHash(value[key]);
                });
            }
        }
        else {
            hash.update(typeof value + value.toString());
        }
    }
    addToHash(obj);
    return hash.digest('hex');
}
/**
 * Removes sub-properties containing Ref or Fn::GetAtt to avoid hashing
 * references themselves but keeps the property structure.
 */
function stripReferences(value) {
    if (!value || typeof value !== 'object')
        return value;
    if (Array.isArray(value)) {
        return value.map(stripReferences);
    }
    if ('Ref' in value) {
        return { __cloud_ref__: 'Ref' };
    }
    if ('Fn::GetAtt' in value) {
        return { __cloud_ref__: 'Fn::GetAtt' };
    }
    if ('DependsOn' in value) {
        return { __cloud_ref__: 'DependsOn' };
    }
    const result = {};
    for (const [k, v] of Object.entries(value)) {
        result[k] = stripReferences(v);
    }
    return result;
}
function stripConstructPath(resource) {
    if (resource?.Metadata?.['aws:cdk:path'] == null) {
        return resource;
    }
    const copy = JSON.parse(JSON.stringify(resource));
    delete copy.Metadata['aws:cdk:path'];
    return copy;
}
function intersection(a, b) {
    return a.filter((value) => b.includes(value));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlnZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9yZWZhY3RvcmluZy9kaWdlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEyQkEsd0RBMEZDO0FBRUQsZ0NBd0JDO0FBL0lELHNDQUFzQztBQUN0QyxxRUFBK0U7QUFHL0U7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQkc7QUFDSCxTQUFnQixzQkFBc0IsQ0FBQyxRQUFnQztJQUNyRSxNQUFNLFNBQVMsR0FBRyxRQUFRLENBQUMsU0FBUyxJQUFJLEVBQUUsQ0FBQztJQUMzQyxNQUFNLEtBQUssR0FBZ0MsRUFBRSxDQUFDO0lBQzlDLE1BQU0sWUFBWSxHQUFnQyxFQUFFLENBQUM7SUFFckQsMkJBQTJCO0lBQzNCLEtBQUssTUFBTSxFQUFFLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3hDLEtBQUssQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ3RCLFlBQVksQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQy9CLENBQUM7SUFFRCx5REFBeUQ7SUFDekQsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLEtBQVUsRUFBWSxFQUFFO1FBQ2hELElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUTtZQUFFLE9BQU8sRUFBRSxDQUFDO1FBQ25ELElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3pCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ3pDLENBQUM7UUFDRCxJQUFJLEtBQUssSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNuQixPQUFPLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLENBQUM7UUFDRCxJQUFJLFlBQVksSUFBSSxLQUFLLEVBQUUsQ0FBQztZ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QUFDLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDaEQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBsb2FkUmVzb3VyY2VNb2RlbCB9IGZyb20gJ0Bhd3MtY2RrL2Nsb3VkZm9ybWF0aW9uLWRpZmYvbGliL2RpZmYvdXRpbCc7XG5pbXBvcnQgdHlwZSB7IENsb3VkRm9ybWF0aW9uVGVtcGxhdGUgfSBmcm9tICcuL2Nsb3VkZm9ybWF0aW9uJztcblxuLyoqXG4gKiBDb21wdXRlcyB0aGUgZGlnZXN0IGZvciBlYWNoIHJlc291cmNlIGluIHRoZSB0ZW1wbGF0ZS5cbiAqXG4gKiBDb25jZXB0dWFsbHksIHRoZSBkaWdlc3QgaXMgY29tcHV0ZWQgYXM6XG4gKlxuICogICAgIGQocmVzb3VyY2UpID0gaGFzaCh0eXBlICsgcGh5c2ljYWxJZCkgICAgICAgICAgICAgICAgICAgICAgICwgaWYgcGh5c2ljYWxJZCBpcyBkZWZpbmVkXG4gKiAgICAgICAgICAgICAgICAgPSBoYXNoKHR5cGUgKyBwcm9wZXJ0aWVzICsgZGVwZW5kZW5jaWVzLm1hcChkKSkgLCBvdGhlcndpc2VcbiAqXG4gKiB3aGVyZSBgaGFzaGAgaXMgYSBjcnlwdG9ncmFwaGljIGhhc2ggZnVuY3Rpb24uIEluIG90aGVyIHdvcmRzLCBpZiBhIHJlc291cmNlIGhhc1xuICogYSBwaHlzaWNhbCBJRCwgd2UgdXNlIHRoZSBwaHlzaWNhbCBJRCBwbHVzIGl0cyB0eXBlIHRvIHVuaXF1ZWx5IGlkZW50aWZ5XG4gKiB0aGF0IHJlc291cmNlLiBJbiB0aGlzIGNhc2UsIHRoZSBkaWdlc3QgY2FuIGJlIGNvbXB1dGVkIGZyb20gdGhlc2UgdHdvIGZpZWxkc1xuICogYWxvbmUuIEEgY29yb2xsYXJ5IGlzIHRoYXQgc3VjaCByZXNvdXJjZXMgY2FuIGJlIHJlbmFtZWQgYW5kIGhhdmUgdGhlaXJcbiAqIHByb3BlcnRpZXMgdXBkYXRlZCBhdCB0aGUgc2FtZSB0aW1lLCBhbmQgc3RpbGwgYmUgY29uc2lkZXJlZCBlcXVpdmFsZW50LlxuICpcbiAqIE90aGVyd2lzZSwgdGhlIGRpZ2VzdCBpcyBjb21wdXRlZCBmcm9tIGl0cyB0eXBlLCBpdHMgb3duIHByb3BlcnRpZXMgKHRoYXQgaXMsXG4gKiBleGNsdWRpbmcgcHJvcGVydGllcyB0aGF0IHJlZmVyIHRvIG90aGVyIHJlc291cmNlcyksIGFuZCB0aGUgZGlnZXN0cyBvZiBlYWNoIG9mXG4gKiBpdHMgZGVwZW5kZW5jaWVzLlxuICpcbiAqIFRoZSBkaWdlc3Qgb2YgYSByZXNvdXJjZSwgZGVmaW5lZCByZWN1cnNpdmVseSB0aGlzIHdheSwgcmVtYWlucyBzdGFibGUgZXZlbiBpZlxuICogb25lIG9yIG1vcmUgb2YgaXRzIGRlcGVuZGVuY2llcyBnZXRzIHJlbmFtZWQuIFNpbmNlIHRoZSByZXNvdXJjZXMgaW4gYVxuICogQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgZm9ybSBhIGRpcmVjdGVkIGFjeWNsaWMgZ3JhcGgsIHRoaXMgZnVuY3Rpb24gaXNcbiAqIHdlbGwtZGVmaW5lZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVSZXNvdXJjZURpZ2VzdHModGVtcGxhdGU6IENsb3VkRm9ybWF0aW9uVGVtcGxhdGUpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgcmVzb3VyY2VzID0gdGVtcGxhdGUuUmVzb3VyY2VzIHx8IHt9O1xuICBjb25zdCBncmFwaDogUmVjb3JkPHN0cmluZywgU2V0PHN0cmluZz4+ID0ge307XG4gIGNvbnN0IHJldmVyc2VHcmFwaDogUmVjb3JkPHN0cmluZywgU2V0PHN0cmluZz4+ID0ge307XG5cbiAgLy8gMS4gQnVpbGQgYWRqYWNlbmN5IGxpc3RzXG4gIGZvciAoY29uc3QgaWQgb2YgT2JqZWN0LmtleXMocmVzb3VyY2VzKSkge1xuICAgIGdyYXBoW2lkXSA9IG5ldyBTZXQoKTtcbiAgICByZXZlcnNlR3JhcGhbaWRdID0gbmV3IFNldCgpO1xuICB9XG5cbiAgLy8gMi4gRGV0ZWN0IGRlcGVuZGVuY2llcyBieSBzZWFyY2hpbmcgZm9yIFJlZi9Gbjo6R2V0QXR0XG4gIGNvbnN0IGZpbmREZXBlbmRlbmNpZXMgPSAodmFsdWU6IGFueSk6IHN0cmluZ1tdID0+IHtcbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiBbXTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5mbGF0TWFwKGZpbmREZXBlbmRlbmNpZXMpO1xuICAgIH1cbiAgICBpZiAoJ1JlZicgaW4gdmFsdWUpIHtcbiAgICAgIHJldHVybiBbdmFsdWUuUmVmXTtcbiAgICB9XG4gICAgaWYgKCdGbjo6R2V0QXR0JyBpbiB2YWx1ZSkge1xuICAgICAgY29uc3QgcmVmVGFyZ2V0ID0gQXJyYXkuaXNBcnJheSh2YWx1ZVsnRm46OkdldEF0dCddKSA/IHZhbHVlWydGbjo6R2V0QXR0J11bMF0gOiB2YWx1ZVsnRm46OkdldEF0dCddLnNwbGl0KCcuJylbMF07XG4gICAgICByZXR1cm4gW3JlZlRhcmdldF07XG4gICAgfVxuICAgIGlmICgnRGVwZW5kc09uJyBpbiB2YWx1ZSkge1xuICAgICAgcmV0dXJuIFt2YWx1ZS5EZXBlbmRzT25dO1xuICAgIH1cbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh2YWx1ZSkuZmxhdE1hcChmaW5kRGVwZW5kZW5jaWVzKTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IFtpZCwgcmVzXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZXMpKSB7XG4gICAgY29uc3QgZGVwcyA9IGZpbmREZXBlbmRlbmNpZXMocmVzIHx8IHt9KTtcbiAgICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgICBpZiAoZGVwIGluIHJlc291cmNlcyAmJiBkZXAgIT09IGlkKSB7XG4gICAgICAgIGdyYXBoW2lkXS5hZGQoZGVwKTtcbiAgICAgICAgcmV2ZXJzZUdyYXBoW2RlcF0uYWRkKGlkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyAzLiBUb3BvbG9naWNhbCBzb3J0XG4gIGNvbnN0IG91dERlZ3JlZSA9IE9iamVjdC5rZXlzKGdyYXBoKS5yZWR1Y2UoKGFjYywgaykgPT4ge1xuICAgIGFjY1trXSA9IGdyYXBoW2tdLnNpemU7XG4gICAgcmV0dXJuIGFjYztcbiAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgbnVtYmVyPik7XG5cbiAgY29uc3QgcXVldWUgPSBPYmplY3Qua2V5cyhvdXREZWdyZWUpLmZpbHRlcigoaykgPT4gb3V0RGVncmVlW2tdID09PSAwKTtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG5cbiAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBub2RlID0gcXVldWUuc2hpZnQoKSE7XG4gICAgb3JkZXIucHVzaChub2RlKTtcbiAgICBmb3IgKGNvbnN0IG54dCBvZiByZXZlcnNlR3JhcGhbbm9kZV0pIHtcbiAgICAgIG91dERlZ3JlZVtueHRdLS07XG4gICAgICBpZiAob3V0RGVncmVlW254dF0gPT09IDApIHtcbiAgICAgICAgcXVldWUucHVzaChueHQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIDQuIENvbXB1dGUgZGlnZXN0cyBpbiBzb3J0ZWQgb3JkZXJcbiAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGZvciAoY29uc3QgaWQgb2Ygb3JkZXIpIHtcbiAgICBjb25zdCByZXNvdXJjZSA9IHJlc291cmNlc1tpZF07XG4gICAgY29uc3QgcmVzb3VyY2VQcm9wZXJ0aWVzID0gcmVzb3VyY2UuUHJvcGVydGllcyA/PyB7fTtcbiAgICBjb25zdCBtb2RlbCA9IGxvYWRSZXNvdXJjZU1vZGVsKHJlc291cmNlLlR5cGUpO1xuICAgIGNvbnN0IGlkZW50aWZpZXIgPSBpbnRlcnNlY3Rpb24oT2JqZWN0LmtleXMocmVzb3VyY2VQcm9wZXJ0aWVzKSwgbW9kZWw/LnByaW1hcnlJZGVudGlmaWVyID8/IFtdKTtcbiAgICBsZXQgdG9IYXNoOiBzdHJpbmc7XG5cbiAgICBpZiAoaWRlbnRpZmllci5sZW5ndGggPT09IG1vZGVsPy5wcmltYXJ5SWRlbnRpZmllcj8ubGVuZ3RoKSB7XG4gICAgICAvLyBUaGUgcmVzb3VyY2UgaGFzIGEgcGh5c2ljYWwgSUQgZGVmaW5lZCwgc28gd2UgY2FuXG4gICAgICAvLyB1c2UgdGhlIElEIGFuZCB0aGUgdHlwZSBhcyB0aGUgaWRlbnRpdHkgb2YgdGhlIHJlc291cmNlLlxuICAgICAgdG9IYXNoID1cbiAgICAgICAgcmVzb3VyY2UuVHlwZSArXG4gICAgICAgIGlkZW50aWZpZXJcbiAgICAgICAgICAuc29ydCgpXG4gICAgICAgICAgLm1hcCgoYXR0cikgPT4gSlNPTi5zdHJpbmdpZnkocmVzb3VyY2VQcm9wZXJ0aWVzW2F0dHJdKSlcbiAgICAgICAgICAuam9pbignJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoZSByZXNvdXJjZSBkb2VzIG5vdCBoYXZlIGEgcGh5c2ljYWwgSUQgZGVmaW5lZCwgc28gd2UgbmVlZCB0b1xuICAgICAgLy8gY29tcHV0ZSB0aGUgZGlnZXN0IGJhc2VkIG9uIGl0cyBwcm9wZXJ0aWVzIGFuZCBkZXBlbmRlbmNpZXMuXG4gICAgICBjb25zdCBkZXBEaWdlc3RzID0gQXJyYXkuZnJvbShncmFwaFtpZF0pLm1hcCgoZCkgPT4gcmVzdWx0W2RdKTtcbiAgICAgIGNvbnN0IHByb3BlcnRpZXNIYXNoID0gaGFzaE9iamVjdChzdHJpcFJlZmVyZW5jZXMoc3RyaXBDb25zdHJ1Y3RQYXRoKHJlc291cmNlKSkpO1xuICAgICAgdG9IYXNoID0gcmVzb3VyY2UuVHlwZSArIHByb3BlcnRpZXNIYXNoICsgZGVwRGlnZXN0cy5qb2luKCcnKTtcbiAgICB9XG5cbiAgICByZXN1bHRbaWRdID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZSh0b0hhc2gpLmRpZ2VzdCgnaGV4Jyk7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzaE9iamVjdChvYmo6IGFueSk6IHN0cmluZyB7XG4gIGNvbnN0IGhhc2ggPSBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMjU2Jyk7XG5cbiAgZnVuY3Rpb24gYWRkVG9IYXNoKHZhbHVlOiBhbnkpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgYWRkVG9IYXNoKCdudWxsJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdmFsdWUuZm9yRWFjaChhZGRUb0hhc2gpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgT2JqZWN0LmtleXModmFsdWUpXG4gICAgICAgICAgLnNvcnQoKVxuICAgICAgICAgIC5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgICAgICAgIGhhc2gudXBkYXRlKGtleSk7XG4gICAgICAgICAgICBhZGRUb0hhc2godmFsdWVba2V5XSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGhhc2gudXBkYXRlKHR5cGVvZiB2YWx1ZSArIHZhbHVlLnRvU3RyaW5nKCkpO1xuICAgIH1cbiAgfVxuXG4gIGFkZFRvSGFzaChvYmopO1xuICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKipcbiAqIFJlbW92ZXMgc3ViLXByb3BlcnRpZXMgY29udGFpbmluZyBSZWYgb3IgRm46OkdldEF0dCB0byBhdm9pZCBoYXNoaW5nXG4gKiByZWZlcmVuY2VzIHRoZW1zZWx2ZXMgYnV0IGtlZXBzIHRoZSBwcm9wZXJ0eSBzdHJ1Y3R1cmUuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwUmVmZXJlbmNlcyh2YWx1ZTogYW55KTogYW55IHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSByZXR1cm4gdmFsdWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5tYXAoc3RyaXBSZWZlcmVuY2VzKTtcbiAgfVxuICBpZiAoJ1JlZicgaW4gdmFsdWUpIHtcbiAgICByZXR1cm4geyBfX2Nsb3VkX3JlZl9fOiAnUmVmJyB9O1xuICB9XG4gIGlmICgnRm46OkdldEF0dCcgaW4gdmFsdWUpIHtcbiAgICByZXR1cm4geyBfX2Nsb3VkX3JlZl9fOiAnRm46OkdldEF0dCcgfTtcbiAgfVxuICBpZiAoJ0RlcGVuZHNPbicgaW4gdmFsdWUpIHtcbiAgICByZXR1cm4geyBfX2Nsb3VkX3JlZl9fOiAnRGVwZW5kc09uJyB9O1xuICB9XG4gIGNvbnN0IHJlc3VsdDogYW55ID0ge307XG4gIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkge1xuICAgIHJlc3VsdFtrXSA9IHN0cmlwUmVmZXJlbmNlcyh2KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBzdHJpcENvbnN0cnVjdFBhdGgocmVzb3VyY2U6IGFueSk6IGFueSB7XG4gIGlmIChyZXNvdXJjZT8uTWV0YWRhdGE/LlsnYXdzOmNkazpwYXRoJ10gPT0gbnVsbCkge1xuICAgIHJldHVybiByZXNvdXJjZTtcbiAgfVxuXG4gIGNvbnN0IGNvcHkgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHJlc291cmNlKSk7XG4gIGRlbGV0ZSBjb3B5Lk1ldGFkYXRhWydhd3M6Y2RrOnBhdGgnXTtcbiAgcmV0dXJuIGNvcHk7XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdGlvbjxUPihhOiBUW10sIGI6IFRbXSk6IFRbXSB7XG4gIHJldHVybiBhLmZpbHRlcigodmFsdWUpID0+IGIuaW5jbHVkZXModmFsdWUpKTtcbn1cbiJdfQ==