"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceMigrator = void 0;
const chalk = require("chalk");
const fs = require("fs-extra");
const importer_1 = require("./importer");
const util_1 = require("../../util");
const private_1 = require("../io/private");
class ResourceMigrator {
    props;
    ioHelper;
    constructor(props) {
        this.props = props;
        this.ioHelper = props.ioHelper;
    }
    /**
     * Checks to see if a migrate.json file exists. If it does and the source is either `filepath` or
     * is in the same environment as the stack deployment, a new stack is created and the resources are
     * migrated to the stack using an IMPORT changeset. The normal deployment will resume after this is complete
     * to add back in any outputs and the CDKMetadata.
     */
    async tryMigrateResources(stacks, options) {
        const stack = stacks.stackArtifacts[0];
        const migrateDeployment = new importer_1.ResourceImporter(stack, {
            deployments: this.props.deployments,
            ioHelper: this.ioHelper,
        });
        const resourcesToImport = await this.tryGetResources(await migrateDeployment.resolveEnvironment());
        if (resourcesToImport) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(`${chalk.bold(stack.displayName)}: creating stack for resource migration...`));
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(`${chalk.bold(stack.displayName)}: importing resources into stack...`));
            await this.performResourceMigration(migrateDeployment, resourcesToImport, options);
            fs.rmSync('migrate.json');
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(`${chalk.bold(stack.displayName)}: applying CDKMetadata and Outputs to stack (if applicable)...`));
        }
    }
    /**
     * Creates a new stack with just the resources to be migrated
     */
    async performResourceMigration(migrateDeployment, resourcesToImport, options) {
        const startDeployTime = new Date().getTime();
        let elapsedDeployTime = 0;
        // Initial Deployment
        await migrateDeployment.importResourcesFromMigrate(resourcesToImport, {
            roleArn: options.roleArn,
            deploymentMethod: options.deploymentMethod,
            usePreviousParameters: true,
            rollback: options.rollback,
        });
        elapsedDeployTime = new Date().getTime() - startDeployTime;
        await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_I5002.msg(`'\n✨  Resource migration time: ${(0, util_1.formatTime)(elapsedDeployTime)}s\n'`, {
            duration: elapsedDeployTime,
        }));
    }
    async tryGetResources(environment) {
        try {
            const migrateFile = fs.readJsonSync('migrate.json', {
                encoding: 'utf-8',
            });
            const sourceEnv = migrateFile.Source.split(':');
            if (sourceEnv[0] === 'localfile' ||
                (sourceEnv[4] === environment.account && sourceEnv[3] === environment.region)) {
                return migrateFile.Resources;
            }
        }
        catch (e) {
            // Nothing to do
        }
        return undefined;
    }
}
exports.ResourceMigrator = ResourceMigrator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL3Jlc291cmNlLWltcG9ydC9taWdyYXRvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSwrQkFBK0I7QUFDL0IsK0JBQStCO0FBRS9CLHlDQUE4QztBQUM5QyxxQ0FBd0M7QUFHeEMsMkNBQWtEO0FBT2xELE1BQWEsZ0JBQWdCO0lBQ1YsS0FBSyxDQUF3QjtJQUM3QixRQUFRLENBQVc7SUFFcEMsWUFBbUIsS0FBNEI7UUFDN0MsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNJLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxNQUF1QixFQUFFLE9BQWdDO1FBQ3hGLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkMsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLDJCQUFnQixDQUFDLEtBQUssRUFBRTtZQUNwRCxXQUFXLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXO1lBQ25DLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtTQUN4QixDQUFDLENBQUM7UUFDSCxNQUFNLGlCQUFpQixHQUFHLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLGlCQUFpQixDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQztRQUVuRyxJQUFJLGlCQUFpQixFQUFFLENBQUM7WUFDdEIsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxZQUFFLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLDRDQUE0QyxDQUFDLENBQUMsQ0FBQztZQUN0SSxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMscUNBQXFDLENBQUMsQ0FBQyxDQUFDO1lBRS9ILE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLGlCQUFpQixFQUFFLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRW5GLEVBQUUsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUM7WUFDMUIsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxZQUFFLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLGdFQUFnRSxDQUFDLENBQUMsQ0FBQztRQUM1SixDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLHdCQUF3QixDQUNwQyxpQkFBbUMsRUFDbkMsaUJBQW9DLEVBQ3BDLE9BQWdDO1FBRWhDLE1BQU0sZUFBZSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDN0MsSUFBSSxpQkFBaUIsR0FBRyxDQUFDLENBQUM7UUFFMUIscUJBQXFCO1FBQ3JCLE1BQU0saUJBQWlCLENBQUMsMEJBQTBCLENBQUMsaUJBQWlCLEVBQUU7WUFDcEUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO1lBQ3hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7WUFDMUMscUJBQXFCLEVBQUUsSUFBSTtZQUMzQixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7U0FDM0IsQ0FBQyxDQUFDO1FBRUgsaUJBQWlCLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxlQUFlLENBQUM7UUFDM0QsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxZQUFFLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLGtDQUFrQyxJQUFBLGlCQUFVLEVBQUMsaUJBQWlCLENBQUMsTUFBTSxFQUFFO1lBQ3pILFFBQVEsRUFBRSxpQkFBaUI7U0FDNUIsQ0FBQyxDQUFDLENBQUM7SUFDTixDQUFDO0lBRU0sS0FBSyxDQUFDLGVBQWUsQ0FBQyxXQUE4QjtRQUN6RCxJQUFJLENBQUM7WUFDSCxNQUFNLFdBQVcsR0FBRyxFQUFFLENBQUMsWUFBWSxDQUFDLGNBQWMsRUFBRTtnQkFDbEQsUUFBUSxFQUFFLE9BQU87YUFDbEIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxTQUFTLEdBQUksV0FBVyxDQUFDLE1BQWlCLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzVELElBQ0UsU0FBUyxDQUFDLENBQUMsQ0FBQyxLQUFLLFdBQVc7Z0JBQzVCLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxLQUFLLFdBQVcsQ0FBQyxPQUFPLElBQUksU0FBUyxDQUFDLENBQUMsQ0FBQyxLQUFLLFdBQVcsQ0FBQyxNQUFNLENBQUMsRUFDN0UsQ0FBQztnQkFDRCxPQUFPLFdBQVcsQ0FBQyxTQUFTLENBQUM7WUFDL0IsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ1gsZ0JBQWdCO1FBQ2xCLENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0NBQ0Y7QUE3RUQsNENBNkVDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgKiBhcyBjeGFwaSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0ICogYXMgY2hhbGsgZnJvbSAnY2hhbGsnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IHR5cGUgeyBJbXBvcnREZXBsb3ltZW50T3B0aW9ucywgUmVzb3VyY2VzVG9JbXBvcnQgfSBmcm9tICcuL2ltcG9ydGVyJztcbmltcG9ydCB7IFJlc291cmNlSW1wb3J0ZXIgfSBmcm9tICcuL2ltcG9ydGVyJztcbmltcG9ydCB7IGZvcm1hdFRpbWUgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgU3RhY2tDb2xsZWN0aW9uIH0gZnJvbSAnLi4vY2xvdWQtYXNzZW1ibHknO1xuaW1wb3J0IHR5cGUgeyBEZXBsb3ltZW50cyB9IGZyb20gJy4uL2RlcGxveW1lbnRzJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb3VyY2VNaWdyYXRvclByb3BzIHtcbiAgZGVwbG95bWVudHM6IERlcGxveW1lbnRzO1xuICBpb0hlbHBlcjogSW9IZWxwZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBSZXNvdXJjZU1pZ3JhdG9yIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwcm9wczogUmVzb3VyY2VNaWdyYXRvclByb3BzO1xuICBwcml2YXRlIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcjtcblxuICBwdWJsaWMgY29uc3RydWN0b3IocHJvcHM6IFJlc291cmNlTWlncmF0b3JQcm9wcykge1xuICAgIHRoaXMucHJvcHMgPSBwcm9wcztcbiAgICB0aGlzLmlvSGVscGVyID0gcHJvcHMuaW9IZWxwZXI7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHRvIHNlZSBpZiBhIG1pZ3JhdGUuanNvbiBmaWxlIGV4aXN0cy4gSWYgaXQgZG9lcyBhbmQgdGhlIHNvdXJjZSBpcyBlaXRoZXIgYGZpbGVwYXRoYCBvclxuICAgKiBpcyBpbiB0aGUgc2FtZSBlbnZpcm9ubWVudCBhcyB0aGUgc3RhY2sgZGVwbG95bWVudCwgYSBuZXcgc3RhY2sgaXMgY3JlYXRlZCBhbmQgdGhlIHJlc291cmNlcyBhcmVcbiAgICogbWlncmF0ZWQgdG8gdGhlIHN0YWNrIHVzaW5nIGFuIElNUE9SVCBjaGFuZ2VzZXQuIFRoZSBub3JtYWwgZGVwbG95bWVudCB3aWxsIHJlc3VtZSBhZnRlciB0aGlzIGlzIGNvbXBsZXRlXG4gICAqIHRvIGFkZCBiYWNrIGluIGFueSBvdXRwdXRzIGFuZCB0aGUgQ0RLTWV0YWRhdGEuXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgdHJ5TWlncmF0ZVJlc291cmNlcyhzdGFja3M6IFN0YWNrQ29sbGVjdGlvbiwgb3B0aW9uczogSW1wb3J0RGVwbG95bWVudE9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdGFjayA9IHN0YWNrcy5zdGFja0FydGlmYWN0c1swXTtcbiAgICBjb25zdCBtaWdyYXRlRGVwbG95bWVudCA9IG5ldyBSZXNvdXJjZUltcG9ydGVyKHN0YWNrLCB7XG4gICAgICBkZXBsb3ltZW50czogdGhpcy5wcm9wcy5kZXBsb3ltZW50cyxcbiAgICAgIGlvSGVscGVyOiB0aGlzLmlvSGVscGVyLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc291cmNlc1RvSW1wb3J0ID0gYXdhaXQgdGhpcy50cnlHZXRSZXNvdXJjZXMoYXdhaXQgbWlncmF0ZURlcGxveW1lbnQucmVzb2x2ZUVudmlyb25tZW50KCkpO1xuXG4gICAgaWYgKHJlc291cmNlc1RvSW1wb3J0KSB7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfSU5GTy5tc2coYCR7Y2hhbGsuYm9sZChzdGFjay5kaXNwbGF5TmFtZSl9OiBjcmVhdGluZyBzdGFjayBmb3IgcmVzb3VyY2UgbWlncmF0aW9uLi4uYCkpO1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKGAke2NoYWxrLmJvbGQoc3RhY2suZGlzcGxheU5hbWUpfTogaW1wb3J0aW5nIHJlc291cmNlcyBpbnRvIHN0YWNrLi4uYCkpO1xuXG4gICAgICBhd2FpdCB0aGlzLnBlcmZvcm1SZXNvdXJjZU1pZ3JhdGlvbihtaWdyYXRlRGVwbG95bWVudCwgcmVzb3VyY2VzVG9JbXBvcnQsIG9wdGlvbnMpO1xuXG4gICAgICBmcy5ybVN5bmMoJ21pZ3JhdGUuanNvbicpO1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKGAke2NoYWxrLmJvbGQoc3RhY2suZGlzcGxheU5hbWUpfTogYXBwbHlpbmcgQ0RLTWV0YWRhdGEgYW5kIE91dHB1dHMgdG8gc3RhY2sgKGlmIGFwcGxpY2FibGUpLi4uYCkpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IHN0YWNrIHdpdGgganVzdCB0aGUgcmVzb3VyY2VzIHRvIGJlIG1pZ3JhdGVkXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHBlcmZvcm1SZXNvdXJjZU1pZ3JhdGlvbihcbiAgICBtaWdyYXRlRGVwbG95bWVudDogUmVzb3VyY2VJbXBvcnRlcixcbiAgICByZXNvdXJjZXNUb0ltcG9ydDogUmVzb3VyY2VzVG9JbXBvcnQsXG4gICAgb3B0aW9uczogSW1wb3J0RGVwbG95bWVudE9wdGlvbnMsXG4gICkge1xuICAgIGNvbnN0IHN0YXJ0RGVwbG95VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgIGxldCBlbGFwc2VkRGVwbG95VGltZSA9IDA7XG5cbiAgICAvLyBJbml0aWFsIERlcGxveW1lbnRcbiAgICBhd2FpdCBtaWdyYXRlRGVwbG95bWVudC5pbXBvcnRSZXNvdXJjZXNGcm9tTWlncmF0ZShyZXNvdXJjZXNUb0ltcG9ydCwge1xuICAgICAgcm9sZUFybjogb3B0aW9ucy5yb2xlQXJuLFxuICAgICAgZGVwbG95bWVudE1ldGhvZDogb3B0aW9ucy5kZXBsb3ltZW50TWV0aG9kLFxuICAgICAgdXNlUHJldmlvdXNQYXJhbWV0ZXJzOiB0cnVlLFxuICAgICAgcm9sbGJhY2s6IG9wdGlvbnMucm9sbGJhY2ssXG4gICAgfSk7XG5cbiAgICBlbGFwc2VkRGVwbG95VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gc3RhcnREZXBsb3lUaW1lO1xuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkNES19UT09MS0lUX0k1MDAyLm1zZyhgJ1xcbuKcqCAgUmVzb3VyY2UgbWlncmF0aW9uIHRpbWU6ICR7Zm9ybWF0VGltZShlbGFwc2VkRGVwbG95VGltZSl9c1xcbidgLCB7XG4gICAgICBkdXJhdGlvbjogZWxhcHNlZERlcGxveVRpbWUsXG4gICAgfSkpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHRyeUdldFJlc291cmNlcyhlbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQpOiBQcm9taXNlPFJlc291cmNlc1RvSW1wb3J0IHwgdW5kZWZpbmVkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1pZ3JhdGVGaWxlID0gZnMucmVhZEpzb25TeW5jKCdtaWdyYXRlLmpzb24nLCB7XG4gICAgICAgIGVuY29kaW5nOiAndXRmLTgnLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBzb3VyY2VFbnYgPSAobWlncmF0ZUZpbGUuU291cmNlIGFzIHN0cmluZykuc3BsaXQoJzonKTtcbiAgICAgIGlmIChcbiAgICAgICAgc291cmNlRW52WzBdID09PSAnbG9jYWxmaWxlJyB8fFxuICAgICAgICAoc291cmNlRW52WzRdID09PSBlbnZpcm9ubWVudC5hY2NvdW50ICYmIHNvdXJjZUVudlszXSA9PT0gZW52aXJvbm1lbnQucmVnaW9uKVxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiBtaWdyYXRlRmlsZS5SZXNvdXJjZXM7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gTm90aGluZyB0byBkb1xuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cblxuIl19