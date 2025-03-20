"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runIntegrationTests = runIntegrationTests;
exports.runIntegrationTestsInParallel = runIntegrationTestsInParallel;
const common_1 = require("./common");
const logger = require("../logger");
const utils_1 = require("../utils");
/**
 * Run Integration tests.
 */
async function runIntegrationTests(options) {
    logger.highlight('\nRunning integration tests for failed tests...\n');
    logger.print('Running in parallel across %sregions: %s', options.profiles ? `profiles ${options.profiles.join(', ')} and ` : '', options.regions.join(', '));
    const totalTests = options.tests.length;
    const responses = await runIntegrationTestsInParallel(options);
    logger.highlight('\nTest Results: \n');
    (0, common_1.printSummary)(totalTests, responses.failedTests.length);
    return {
        success: responses.failedTests.length === 0,
        metrics: responses.metrics,
    };
}
/**
 * Returns a list of AccountWorkers based on the list of regions and profiles
 * given to the CLI.
 */
function getAccountWorkers(regions, profiles) {
    const workers = [];
    function pushWorker(profile) {
        for (const region of regions) {
            workers.push({
                region,
                profile,
            });
        }
    }
    if (profiles && profiles.length > 0) {
        for (const profile of profiles ?? []) {
            pushWorker(profile);
        }
    }
    else {
        pushWorker();
    }
    return workers;
}
/**
 * Runs a set of integration tests in parallel across a list of AWS regions.
 * Only a single test can be run at a time in a given region. Once a region
 * is done running a test, the next test will be pulled from the queue
 */
async function runIntegrationTestsInParallel(options) {
    const queue = options.tests;
    const results = {
        metrics: [],
        failedTests: [],
    };
    const accountWorkers = getAccountWorkers(options.regions, options.profiles);
    async function runTest(worker) {
        const start = Date.now();
        const tests = {};
        do {
            const test = queue.pop();
            if (!test)
                break;
            const testStart = Date.now();
            logger.highlight(`Running test ${test.fileName} in ${worker.profile ? worker.profile + '/' : ''}${worker.region}`);
            const response = await options.pool.exec('integTestWorker', [{
                    watch: options.watch,
                    region: worker.region,
                    profile: worker.profile,
                    tests: [test],
                    clean: options.clean,
                    dryRun: options.dryRun,
                    verbosity: options.verbosity,
                    updateWorkflow: options.updateWorkflow,
                }], {
                on: common_1.printResults,
            });
            results.failedTests.push(...(0, utils_1.flatten)(response));
            tests[test.fileName] = (Date.now() - testStart) / 1000;
        } while (queue.length > 0);
        const metrics = {
            region: worker.region,
            profile: worker.profile,
            duration: (Date.now() - start) / 1000,
            tests,
        };
        if (Object.keys(tests).length > 0) {
            results.metrics.push(metrics);
        }
    }
    const workers = accountWorkers.map((worker) => runTest(worker));
    // Workers are their own concurrency limits
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all(workers);
    return results;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZWctdGVzdC13b3JrZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnRlZy10ZXN0LXdvcmtlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQStDQSxrREFlQztBQWlERCxzRUFrREM7QUEvSkQscUNBQXNEO0FBQ3RELG9DQUFvQztBQUVwQyxvQ0FBbUM7QUF1Q25DOztHQUVHO0FBQ0ksS0FBSyxVQUFVLG1CQUFtQixDQUFDLE9BQTRCO0lBQ3BFLE1BQU0sQ0FBQyxTQUFTLENBQUMsbURBQW1ELENBQUMsQ0FBQztJQUN0RSxNQUFNLENBQUMsS0FBSyxDQUNWLDBDQUEwQyxFQUMxQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxZQUFZLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUEsQ0FBQyxDQUFDLEVBQUUsRUFDckUsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUM5QixNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztJQUV4QyxNQUFNLFNBQVMsR0FBRyxNQUFNLDZCQUE2QixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQy9ELE1BQU0sQ0FBQyxTQUFTLENBQUMsb0JBQW9CLENBQUMsQ0FBQztJQUN2QyxJQUFBLHFCQUFZLEVBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdkQsT0FBTztRQUNMLE9BQU8sRUFBRSxTQUFTLENBQUMsV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDO1FBQzNDLE9BQU8sRUFBRSxTQUFTLENBQUMsT0FBTztLQUMzQixDQUFDO0FBQ0osQ0FBQztBQW9CRDs7O0dBR0c7QUFDSCxTQUFTLGlCQUFpQixDQUFDLE9BQWlCLEVBQUUsUUFBbUI7SUFDL0QsTUFBTSxPQUFPLEdBQW9CLEVBQUUsQ0FBQztJQUNwQyxTQUFTLFVBQVUsQ0FBQyxP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QyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2xDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2hDLENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxPQUFPLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7SUFDaEUsMkNBQTJDO0lBQzNDLHdFQUF3RTtJQUN4RSxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDM0IsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlICogYXMgd29ya2VycG9vbCBmcm9tICd3b3JrZXJwb29sJztcbmltcG9ydCB0eXBlIHsgSW50ZWdCYXRjaFJlc3BvbnNlLCBJbnRlZ1Rlc3RPcHRpb25zLCBJbnRlZ1J1bm5lck1ldHJpY3MgfSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgeyBwcmludFJlc3VsdHMsIHByaW50U3VtbWFyeSB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCAqIGFzIGxvZ2dlciBmcm9tICcuLi9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBJbnRlZ1Rlc3RJbmZvIH0gZnJvbSAnLi4vcnVubmVyL2ludGVncmF0aW9uLXRlc3RzJztcbmltcG9ydCB7IGZsYXR0ZW4gfSBmcm9tICcuLi91dGlscyc7XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYW4gaW50ZWdyYXRpb24gdGVzdCBiYXRjaFxuICovXG5leHBvcnQgaW50ZXJmYWNlIEludGVnVGVzdEJhdGNoUmVxdWVzdCBleHRlbmRzIEludGVnVGVzdE9wdGlvbnMge1xuICAvKipcbiAgICogVGhlIEFXUyByZWdpb24gdG8gcnVuIHRoaXMgYmF0Y2ggaW5cbiAgICovXG4gIHJlYWRvbmx5IHJlZ2lvbjogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgQVdTIHByb2ZpbGUgdG8gdXNlIHdoZW4gcnVubmluZyB0aGlzIHRlc3RcbiAgICovXG4gIHJlYWRvbmx5IHByb2ZpbGU/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgcnVubmluZyBhbGwgaW50ZWdyYXRpb24gdGVzdHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJbnRlZ1Rlc3RSdW5PcHRpb25zIGV4dGVuZHMgSW50ZWdUZXN0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgcmVnaW9ucyB0byBydW4gdGhlIGludGVncmF0aW9uIHRlc3RzIGFjcm9zcy5cbiAgICogVGhpcyBhbGxvd3MgdGhlIHJ1bm5lciB0byBydW4gaW50ZWdyYXRpb24gdGVzdHMgaW4gcGFyYWxsZWxcbiAgICovXG4gIHJlYWRvbmx5IHJlZ2lvbnM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBMaXN0IG9mIEFXUyBwcm9maWxlcy4gVGhpcyB3aWxsIGJlIHVzZWQgaW4gY29uanVuY3Rpb24gd2l0aCBgcmVnaW9uc2BcbiAgICogdG8gcnVuIHRlc3RzIGluIHBhcmFsbGVsIGFjcm9zcyBhY2NvdW50cyArIHJlZ2lvbnNcbiAgICovXG4gIHJlYWRvbmx5IHByb2ZpbGVzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIFRoZSB3b3JrZXJwb29sIHRvIHVzZVxuICAgKi9cbiAgcmVhZG9ubHkgcG9vbDogd29ya2VycG9vbC5Xb3JrZXJQb29sO1xufVxuXG4vKipcbiAqIFJ1biBJbnRlZ3JhdGlvbiB0ZXN0cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bkludGVncmF0aW9uVGVzdHMob3B0aW9uczogSW50ZWdUZXN0UnVuT3B0aW9ucyk6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtZXRyaWNzOiBJbnRlZ1J1bm5lck1ldHJpY3NbXSB9PiB7XG4gIGxvZ2dlci5oaWdobGlnaHQoJ1xcblJ1bm5pbmcgaW50ZWdyYXRpb24gdGVzdHMgZm9yIGZhaWxlZCB0ZXN0cy4uLlxcbicpO1xuICBsb2dnZXIucHJpbnQoXG4gICAgJ1J1bm5pbmcgaW4gcGFyYWxsZWwgYWNyb3NzICVzcmVnaW9uczogJXMnLFxuICAgIG9wdGlvbnMucHJvZmlsZXMgPyBgcHJvZmlsZXMgJHtvcHRpb25zLnByb2ZpbGVzLmpvaW4oJywgJyl9IGFuZCBgOiAnJyxcbiAgICBvcHRpb25zLnJlZ2lvbnMuam9pbignLCAnKSk7XG4gIGNvbnN0IHRvdGFsVGVzdHMgPSBvcHRpb25zLnRlc3RzLmxlbmd0aDtcblxuICBjb25zdCByZXNwb25zZXMgPSBhd2FpdCBydW5JbnRlZ3JhdGlvblRlc3RzSW5QYXJhbGxlbChvcHRpb25zKTtcbiAgbG9nZ2VyLmhpZ2hsaWdodCgnXFxuVGVzdCBSZXN1bHRzOiBcXG4nKTtcbiAgcHJpbnRTdW1tYXJ5KHRvdGFsVGVzdHMsIHJlc3BvbnNlcy5mYWlsZWRUZXN0cy5sZW5ndGgpO1xuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IHJlc3BvbnNlcy5mYWlsZWRUZXN0cy5sZW5ndGggPT09IDAsXG4gICAgbWV0cmljczogcmVzcG9uc2VzLm1ldHJpY3MsXG4gIH07XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIHdvcmtlciBmb3IgYSBzaW5nbGUgYWNjb3VudCArIHJlZ2lvblxuICovXG5pbnRlcmZhY2UgQWNjb3VudFdvcmtlciB7XG4gIC8qKlxuICAgKiBUaGUgcmVnaW9uIHRoZSB3b3JrZXIgc2hvdWxkIHJ1biBpblxuICAgKi9cbiAgcmVhZG9ubHkgcmVnaW9uOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBBV1MgcHJvZmlsZSB0aGF0IHRoZSB3b3JrZXIgc2hvdWxkIHVzZVxuICAgKiBUaGlzIHdpbGwgYmUgcGFzc2VkIGFzIHRoZSAnLS1wcm9maWxlJyBvcHRpb24gdG8gdGhlIENESyBDTElcbiAgICpcbiAgICogQGRlZmF1bHQgLSBkZWZhdWx0IHByb2ZpbGVcbiAgICovXG4gIHJlYWRvbmx5IHByb2ZpbGU/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogUmV0dXJucyBhIGxpc3Qgb2YgQWNjb3VudFdvcmtlcnMgYmFzZWQgb24gdGhlIGxpc3Qgb2YgcmVnaW9ucyBhbmQgcHJvZmlsZXNcbiAqIGdpdmVuIHRvIHRoZSBDTEkuXG4gKi9cbmZ1bmN0aW9uIGdldEFjY291bnRXb3JrZXJzKHJlZ2lvbnM6IHN0cmluZ1tdLCBwcm9maWxlcz86IHN0cmluZ1tdKTogQWNjb3VudFdvcmtlcltdIHtcbiAgY29uc3Qgd29ya2VyczogQWNjb3VudFdvcmtlcltdID0gW107XG4gIGZ1bmN0aW9uIHB1c2hXb3JrZXIocHJvZmlsZT86IHN0cmluZykge1xuICAgIGZvciAoY29uc3QgcmVnaW9uIG9mIHJlZ2lvbnMpIHtcbiAgICAgIHdvcmtlcnMucHVzaCh7XG4gICAgICAgIHJlZ2lvbixcbiAgICAgICAgcHJvZmlsZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICBpZiAocHJvZmlsZXMgJiYgcHJvZmlsZXMubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgcHJvZmlsZSBvZiBwcm9maWxlcyA/PyBbXSkge1xuICAgICAgcHVzaFdvcmtlcihwcm9maWxlKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgcHVzaFdvcmtlcigpO1xuICB9XG4gIHJldHVybiB3b3JrZXJzO1xufVxuXG4vKipcbiAqIFJ1bnMgYSBzZXQgb2YgaW50ZWdyYXRpb24gdGVzdHMgaW4gcGFyYWxsZWwgYWNyb3NzIGEgbGlzdCBvZiBBV1MgcmVnaW9ucy5cbiAqIE9ubHkgYSBzaW5nbGUgdGVzdCBjYW4gYmUgcnVuIGF0IGEgdGltZSBpbiBhIGdpdmVuIHJlZ2lvbi4gT25jZSBhIHJlZ2lvblxuICogaXMgZG9uZSBydW5uaW5nIGEgdGVzdCwgdGhlIG5leHQgdGVzdCB3aWxsIGJlIHB1bGxlZCBmcm9tIHRoZSBxdWV1ZVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuSW50ZWdyYXRpb25UZXN0c0luUGFyYWxsZWwoXG4gIG9wdGlvbnM6IEludGVnVGVzdFJ1bk9wdGlvbnMsXG4pOiBQcm9taXNlPEludGVnQmF0Y2hSZXNwb25zZT4ge1xuICBjb25zdCBxdWV1ZSA9IG9wdGlvbnMudGVzdHM7XG4gIGNvbnN0IHJlc3VsdHM6IEludGVnQmF0Y2hSZXNwb25zZSA9IHtcbiAgICBtZXRyaWNzOiBbXSxcbiAgICBmYWlsZWRUZXN0czogW10sXG4gIH07XG4gIGNvbnN0IGFjY291bnRXb3JrZXJzOiBBY2NvdW50V29ya2VyW10gPSBnZXRBY2NvdW50V29ya2VycyhvcHRpb25zLnJlZ2lvbnMsIG9wdGlvbnMucHJvZmlsZXMpO1xuXG4gIGFzeW5jIGZ1bmN0aW9uIHJ1blRlc3Qod29ya2VyOiBBY2NvdW50V29ya2VyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHRlc3RzOiB7IFt0ZXN0TmFtZTogc3RyaW5nXTogbnVtYmVyIH0gPSB7fTtcbiAgICBkbyB7XG4gICAgICBjb25zdCB0ZXN0ID0gcXVldWUucG9wKCk7XG4gICAgICBpZiAoIXRlc3QpIGJyZWFrO1xuICAgICAgY29uc3QgdGVzdFN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICAgIGxvZ2dlci5oaWdobGlnaHQoYFJ1bm5pbmcgdGVzdCAke3Rlc3QuZmlsZU5hbWV9IGluICR7d29ya2VyLnByb2ZpbGUgPyB3b3JrZXIucHJvZmlsZSArICcvJyA6ICcnfSR7d29ya2VyLnJlZ2lvbn1gKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBJbnRlZ1Rlc3RJbmZvW11bXSA9IGF3YWl0IG9wdGlvbnMucG9vbC5leGVjKCdpbnRlZ1Rlc3RXb3JrZXInLCBbe1xuICAgICAgICB3YXRjaDogb3B0aW9ucy53YXRjaCxcbiAgICAgICAgcmVnaW9uOiB3b3JrZXIucmVnaW9uLFxuICAgICAgICBwcm9maWxlOiB3b3JrZXIucHJvZmlsZSxcbiAgICAgICAgdGVzdHM6IFt0ZXN0XSxcbiAgICAgICAgY2xlYW46IG9wdGlvbnMuY2xlYW4sXG4gICAgICAgIGRyeVJ1bjogb3B0aW9ucy5kcnlSdW4sXG4gICAgICAgIHZlcmJvc2l0eTogb3B0aW9ucy52ZXJib3NpdHksXG4gICAgICAgIHVwZGF0ZVdvcmtmbG93OiBvcHRpb25zLnVwZGF0ZVdvcmtmbG93LFxuICAgICAgfV0sIHtcbiAgICAgICAgb246IHByaW50UmVzdWx0cyxcbiAgICAgIH0pO1xuXG4gICAgICByZXN1bHRzLmZhaWxlZFRlc3RzLnB1c2goLi4uZmxhdHRlbihyZXNwb25zZSkpO1xuICAgICAgdGVzdHNbdGVzdC5maWxlTmFtZV0gPSAoRGF0ZS5ub3coKSAtIHRlc3RTdGFydCkgLyAxMDAwO1xuICAgIH0gd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApO1xuICAgIGNvbnN0IG1ldHJpY3M6IEludGVnUnVubmVyTWV0cmljcyA9IHtcbiAgICAgIHJlZ2lvbjogd29ya2VyLnJlZ2lvbixcbiAgICAgIHByb2ZpbGU6IHdvcmtlci5wcm9maWxlLFxuICAgICAgZHVyYXRpb246IChEYXRlLm5vdygpIC0gc3RhcnQpIC8gMTAwMCxcbiAgICAgIHRlc3RzLFxuICAgIH07XG4gICAgaWYgKE9iamVjdC5rZXlzKHRlc3RzKS5sZW5ndGggPiAwKSB7XG4gICAgICByZXN1bHRzLm1ldHJpY3MucHVzaChtZXRyaWNzKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCB3b3JrZXJzID0gYWNjb3VudFdvcmtlcnMubWFwKCh3b3JrZXIpID0+IHJ1blRlc3Qod29ya2VyKSk7XG4gIC8vIFdvcmtlcnMgYXJlIHRoZWlyIG93biBjb25jdXJyZW5jeSBsaW1pdHNcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEBjZGtsYWJzL3Byb21pc2VhbGwtbm8tdW5ib3VuZGVkLXBhcmFsbGVsaXNtXG4gIGF3YWl0IFByb21pc2UuYWxsKHdvcmtlcnMpO1xuICByZXR1cm4gcmVzdWx0cztcbn1cbiJdfQ==