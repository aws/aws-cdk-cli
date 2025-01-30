"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const yargs = require("yargs");
const list_1 = require("./list");
const logging_1 = require("./logging");
const publish_1 = require("./publish");
const lib_1 = require("../lib");
async function main() {
    const argv = yargs
        .usage('$0 <cmd> [args]')
        .option('verbose', {
        alias: 'v',
        type: 'boolean',
        desc: 'Increase logging verbosity',
        count: true,
        default: 0,
    })
        .option('path', {
        alias: 'p',
        type: 'string',
        desc: 'The path (file or directory) to load the assets from. If a directory, ' +
            `the file '${lib_1.AssetManifest.DEFAULT_FILENAME}' will be loaded from it.`,
        default: '.',
        requiresArg: true,
    })
        .command('ls', 'List assets from the given manifest', (command) => command, wrapHandler(async (args) => {
        await (0, list_1.list)(args);
    }))
        .command('publish [ASSET..]', 'Publish assets in the given manifest', (command) => command
        .option('profile', {
        type: 'string',
        describe: 'Profile to use from AWS Credentials file',
    })
        .positional('ASSET', {
        type: 'string',
        array: true,
        describe: 'Assets to publish (format: "ASSET[:DEST]"), default all',
    }), wrapHandler(async (args) => {
        await (0, publish_1.publish)({
            path: args.path,
            assets: args.ASSET,
            profile: args.profile,
        });
    }))
        .demandCommand()
        .help()
        .strict() // Error on wrong command
        .version(logging_1.VERSION)
        .showHelpOnFail(false).argv;
    // Evaluating .argv triggers the parsing but the command gets implicitly executed,
    // so we don't need the output.
    Array.isArray(argv);
}
/**
 * Wrap a command's handler with standard pre- and post-work
 */
function wrapHandler(handler) {
    return async (argv) => {
        if (argv.verbose) {
            (0, logging_1.setLogThreshold)('verbose');
        }
        await handler(argv);
    };
}
main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e.stack);
    process.exitCode = 1;
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLWFzc2V0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNkay1hc3NldHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSwrQkFBK0I7QUFDL0IsaUNBQThCO0FBQzlCLHVDQUFxRDtBQUNyRCx1Q0FBb0M7QUFDcEMsZ0NBQXVDO0FBRXZDLEtBQUssVUFBVSxJQUFJO0lBQ2pCLE1BQU0sSUFBSSxHQUFHLEtBQUs7U0FDZixLQUFLLENBQUMsaUJBQWlCLENBQUM7U0FDeEIsTUFBTSxDQUFDLFNBQVMsRUFBRTtRQUNqQixLQUFLLEVBQUUsR0FBRztRQUNWLElBQUksRUFBRSxTQUFTO1FBQ2YsSUFBSSxFQUFFLDRCQUE0QjtRQUNsQyxLQUFLLEVBQUUsSUFBSTtRQUNYLE9BQU8sRUFBRSxDQUFDO0tBQ1gsQ0FBQztTQUNELE1BQU0sQ0FBQyxNQUFNLEVBQUU7UUFDZCxLQUFLLEVBQUUsR0FBRztRQUNWLElBQUksRUFBRSxRQUFRO1FBQ2QsSUFBSSxFQUNGLHdFQUF3RTtZQUN4RSxhQUFhLG1CQUFhLENBQUMsZ0JBQWdCLDJCQUEyQjtRQUN4RSxPQUFPLEVBQUUsR0FBRztRQUNaLFdBQVcsRUFBRSxJQUFJO0tBQ2xCLENBQUM7U0FDRCxPQUFPLENBQ04sSUFBSSxFQUNKLHFDQUFxQyxFQUNyQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsT0FBTyxFQUNwQixXQUFXLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFO1FBQ3pCLE1BQU0sSUFBQSxXQUFJLEVBQUMsSUFBSSxDQUFDLENBQUM7SUFDbkIsQ0FBQyxDQUFDLENBQ0g7U0FDQSxPQUFPLENBQ04sbUJBQW1CLEVBQ25CLHNDQUFzQyxFQUN0QyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQ1YsT0FBTztTQUNKLE1BQU0sQ0FBQyxTQUFTLEVBQUU7UUFDakIsSUFBSSxFQUFFLFFBQVE7UUFDZCxRQUFRLEVBQUUsMENBQTBDO0tBQ3JELENBQUM7U0FDRCxVQUFVLENBQUMsT0FBTyxFQUFFO1FBQ25CLElBQUksRUFBRSxRQUFRO1FBQ2QsS0FBSyxFQUFFLElBQUk7UUFDWCxRQUFRLEVBQUUseURBQXlEO0tBQ3BFLENBQUMsRUFDTixXQUFXLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFO1FBQ3pCLE1BQU0sSUFBQSxpQkFBTyxFQUFDO1lBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2YsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ2xCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztTQUN0QixDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FDSDtTQUNBLGFBQWEsRUFBRTtTQUNmLElBQUksRUFBRTtTQUNOLE1BQU0sRUFBRSxDQUFDLHlCQUF5QjtTQUNsQyxPQUFPLENBQUMsaUJBQU8sQ0FBQztTQUNoQixjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDO0lBRTlCLGtGQUFrRjtJQUNsRiwrQkFBK0I7SUFDL0IsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN0QixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLFdBQVcsQ0FBb0MsT0FBNkI7SUFDbkYsT0FBTyxLQUFLLEVBQUUsSUFBTyxFQUFFLEVBQUU7UUFDdkIsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDakIsSUFBQSx5QkFBZSxFQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzdCLENBQUM7UUFDRCxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN0QixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7SUFDakIsc0NBQXNDO0lBQ3RDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3ZCLE9BQU8sQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgeWFyZ3MgZnJvbSAneWFyZ3MnO1xuaW1wb3J0IHsgbGlzdCB9IGZyb20gJy4vbGlzdCc7XG5pbXBvcnQgeyBzZXRMb2dUaHJlc2hvbGQsIFZFUlNJT04gfSBmcm9tICcuL2xvZ2dpbmcnO1xuaW1wb3J0IHsgcHVibGlzaCB9IGZyb20gJy4vcHVibGlzaCc7XG5pbXBvcnQgeyBBc3NldE1hbmlmZXN0IH0gZnJvbSAnLi4vbGliJztcblxuYXN5bmMgZnVuY3Rpb24gbWFpbigpIHtcbiAgY29uc3QgYXJndiA9IHlhcmdzXG4gICAgLnVzYWdlKCckMCA8Y21kPiBbYXJnc10nKVxuICAgIC5vcHRpb24oJ3ZlcmJvc2UnLCB7XG4gICAgICBhbGlhczogJ3YnLFxuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgZGVzYzogJ0luY3JlYXNlIGxvZ2dpbmcgdmVyYm9zaXR5JyxcbiAgICAgIGNvdW50OiB0cnVlLFxuICAgICAgZGVmYXVsdDogMCxcbiAgICB9KVxuICAgIC5vcHRpb24oJ3BhdGgnLCB7XG4gICAgICBhbGlhczogJ3AnLFxuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBkZXNjOlxuICAgICAgICAnVGhlIHBhdGggKGZpbGUgb3IgZGlyZWN0b3J5KSB0byBsb2FkIHRoZSBhc3NldHMgZnJvbS4gSWYgYSBkaXJlY3RvcnksICcgK1xuICAgICAgICBgdGhlIGZpbGUgJyR7QXNzZXRNYW5pZmVzdC5ERUZBVUxUX0ZJTEVOQU1FfScgd2lsbCBiZSBsb2FkZWQgZnJvbSBpdC5gLFxuICAgICAgZGVmYXVsdDogJy4nLFxuICAgICAgcmVxdWlyZXNBcmc6IHRydWUsXG4gICAgfSlcbiAgICAuY29tbWFuZChcbiAgICAgICdscycsXG4gICAgICAnTGlzdCBhc3NldHMgZnJvbSB0aGUgZ2l2ZW4gbWFuaWZlc3QnLFxuICAgICAgKGNvbW1hbmQpID0+IGNvbW1hbmQsXG4gICAgICB3cmFwSGFuZGxlcihhc3luYyAoYXJncykgPT4ge1xuICAgICAgICBhd2FpdCBsaXN0KGFyZ3MpO1xuICAgICAgfSlcbiAgICApXG4gICAgLmNvbW1hbmQoXG4gICAgICAncHVibGlzaCBbQVNTRVQuLl0nLFxuICAgICAgJ1B1Ymxpc2ggYXNzZXRzIGluIHRoZSBnaXZlbiBtYW5pZmVzdCcsXG4gICAgICAoY29tbWFuZCkgPT5cbiAgICAgICAgY29tbWFuZFxuICAgICAgICAgIC5vcHRpb24oJ3Byb2ZpbGUnLCB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIGRlc2NyaWJlOiAnUHJvZmlsZSB0byB1c2UgZnJvbSBBV1MgQ3JlZGVudGlhbHMgZmlsZScsXG4gICAgICAgICAgfSlcbiAgICAgICAgICAucG9zaXRpb25hbCgnQVNTRVQnLCB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIGFycmF5OiB0cnVlLFxuICAgICAgICAgICAgZGVzY3JpYmU6ICdBc3NldHMgdG8gcHVibGlzaCAoZm9ybWF0OiBcIkFTU0VUWzpERVNUXVwiKSwgZGVmYXVsdCBhbGwnLFxuICAgICAgICAgIH0pLFxuICAgICAgd3JhcEhhbmRsZXIoYXN5bmMgKGFyZ3MpID0+IHtcbiAgICAgICAgYXdhaXQgcHVibGlzaCh7XG4gICAgICAgICAgcGF0aDogYXJncy5wYXRoLFxuICAgICAgICAgIGFzc2V0czogYXJncy5BU1NFVCxcbiAgICAgICAgICBwcm9maWxlOiBhcmdzLnByb2ZpbGUsXG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICApXG4gICAgLmRlbWFuZENvbW1hbmQoKVxuICAgIC5oZWxwKClcbiAgICAuc3RyaWN0KCkgLy8gRXJyb3Igb24gd3JvbmcgY29tbWFuZFxuICAgIC52ZXJzaW9uKFZFUlNJT04pXG4gICAgLnNob3dIZWxwT25GYWlsKGZhbHNlKS5hcmd2O1xuXG4gIC8vIEV2YWx1YXRpbmcgLmFyZ3YgdHJpZ2dlcnMgdGhlIHBhcnNpbmcgYnV0IHRoZSBjb21tYW5kIGdldHMgaW1wbGljaXRseSBleGVjdXRlZCxcbiAgLy8gc28gd2UgZG9uJ3QgbmVlZCB0aGUgb3V0cHV0LlxuICBBcnJheS5pc0FycmF5KGFyZ3YpO1xufVxuXG4vKipcbiAqIFdyYXAgYSBjb21tYW5kJ3MgaGFuZGxlciB3aXRoIHN0YW5kYXJkIHByZS0gYW5kIHBvc3Qtd29ya1xuICovXG5mdW5jdGlvbiB3cmFwSGFuZGxlcjxBIGV4dGVuZHMgeyB2ZXJib3NlPzogbnVtYmVyIH0sIFI+KGhhbmRsZXI6ICh4OiBBKSA9PiBQcm9taXNlPFI+KSB7XG4gIHJldHVybiBhc3luYyAoYXJndjogQSkgPT4ge1xuICAgIGlmIChhcmd2LnZlcmJvc2UpIHtcbiAgICAgIHNldExvZ1RocmVzaG9sZCgndmVyYm9zZScpO1xuICAgIH1cbiAgICBhd2FpdCBoYW5kbGVyKGFyZ3YpO1xuICB9O1xufVxuXG5tYWluKCkuY2F0Y2goKGUpID0+IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvcihlLnN0YWNrKTtcbiAgcHJvY2Vzcy5leGl0Q29kZSA9IDE7XG59KTtcbiJdfQ==