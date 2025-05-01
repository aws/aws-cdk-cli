import type * as cxapi from '@aws-cdk/cx-api';
import type { ImportDeploymentOptions, ResourcesToImport } from './importer';
import type { StackCollection } from '../cloud-assembly';
import type { Deployments } from '../deployments';
import { type IoHelper } from '../io/private';
export interface ResourceMigratorProps {
    deployments: Deployments;
    ioHelper: IoHelper;
}
export declare class ResourceMigrator {
    private readonly props;
    private readonly ioHelper;
    constructor(props: ResourceMigratorProps);
    /**
     * Checks to see if a migrate.json file exists. If it does and the source is either `filepath` or
     * is in the same environment as the stack deployment, a new stack is created and the resources are
     * migrated to the stack using an IMPORT changeset. The normal deployment will resume after this is complete
     * to add back in any outputs and the CDKMetadata.
     */
    tryMigrateResources(stacks: StackCollection, options: ImportDeploymentOptions): Promise<void>;
    /**
     * Creates a new stack with just the resources to be migrated
     */
    private performResourceMigration;
    tryGetResources(environment: cxapi.Environment): Promise<ResourcesToImport | undefined>;
}
