"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bootstrapper = void 0;
const path = require("path");
const deploy_bootstrap_1 = require("./deploy-bootstrap");
const legacy_template_1 = require("./legacy-template");
const util_1 = require("../../util");
const private_1 = require("../io/private");
const plugin_1 = require("../plugin");
const toolkit_error_1 = require("../toolkit-error");
const toolkit_info_1 = require("../toolkit-info");
class Bootstrapper {
    source;
    ioHelper;
    constructor(source = { source: 'default' }, ioHelper) {
        this.source = source;
        this.ioHelper = ioHelper;
    }
    bootstrapEnvironment(environment, sdkProvider, options = {}) {
        switch (this.source.source) {
            case 'legacy':
                return this.legacyBootstrap(environment, sdkProvider, options);
            case 'default':
                return this.modernBootstrap(environment, sdkProvider, options);
            case 'custom':
                return this.customBootstrap(environment, sdkProvider, options);
        }
    }
    async showTemplate(json) {
        const template = await this.loadTemplate();
        process.stdout.write(`${(0, util_1.serializeStructure)(template, json)}\n`);
    }
    /**
     * Deploy legacy bootstrap stack
     *
     */
    async legacyBootstrap(environment, sdkProvider, options = {}) {
        const params = options.parameters ?? {};
        if (params.trustedAccounts?.length) {
            throw new toolkit_error_1.ToolkitError('--trust can only be passed for the modern bootstrap experience.');
        }
        if (params.cloudFormationExecutionPolicies?.length) {
            throw new toolkit_error_1.ToolkitError('--cloudformation-execution-policies can only be passed for the modern bootstrap experience.');
        }
        if (params.createCustomerMasterKey !== undefined) {
            throw new toolkit_error_1.ToolkitError('--bootstrap-customer-key can only be passed for the modern bootstrap experience.');
        }
        if (params.qualifier) {
            throw new toolkit_error_1.ToolkitError('--qualifier can only be passed for the modern bootstrap experience.');
        }
        const toolkitStackName = options.toolkitStackName ?? toolkit_info_1.DEFAULT_TOOLKIT_STACK_NAME;
        const current = await deploy_bootstrap_1.BootstrapStack.lookup(sdkProvider, environment, toolkitStackName, this.ioHelper);
        return current.update(await this.loadTemplate(params), {}, {
            ...options,
            terminationProtection: options.terminationProtection ?? current.terminationProtection,
        });
    }
    /**
     * Deploy CI/CD-ready bootstrap stack from template
     *
     */
    async modernBootstrap(environment, sdkProvider, options = {}) {
        const params = options.parameters ?? {};
        const bootstrapTemplate = await this.loadTemplate();
        const toolkitStackName = options.toolkitStackName ?? toolkit_info_1.DEFAULT_TOOLKIT_STACK_NAME;
        const current = await deploy_bootstrap_1.BootstrapStack.lookup(sdkProvider, environment, toolkitStackName, this.ioHelper);
        const partition = await current.partition();
        if (params.createCustomerMasterKey !== undefined && params.kmsKeyId) {
            throw new toolkit_error_1.ToolkitError("You cannot pass '--bootstrap-kms-key-id' and '--bootstrap-customer-key' together. Specify one or the other");
        }
        // If people re-bootstrap, existing parameter values are reused so that people don't accidentally change the configuration
        // on their bootstrap stack (this happens automatically in deployStack). However, to do proper validation on the
        // combined arguments (such that if --trust has been given, --cloudformation-execution-policies is necessary as well)
        // we need to take this parameter reuse into account.
        //
        // Ideally we'd do this inside the template, but the `Rules` section of CFN
        // templates doesn't seem to be able to express the conditions that we need
        // (can't use Fn::Join or reference Conditions) so we do it here instead.
        const allTrusted = new Set([
            ...params.trustedAccounts ?? [],
            ...params.trustedAccountsForLookup ?? [],
        ]);
        const invalid = intersection(allTrusted, new Set(params.untrustedAccounts));
        if (invalid.size > 0) {
            throw new toolkit_error_1.ToolkitError(`Accounts cannot be both trusted and untrusted. Found: ${[...invalid].join(',')}`);
        }
        const removeUntrusted = (accounts) => accounts.filter(acc => !params.untrustedAccounts?.map(String).includes(String(acc)));
        const trustedAccounts = removeUntrusted(params.trustedAccounts ?? splitCfnArray(current.parameters.TrustedAccounts));
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(`Trusted accounts for deployment: ${trustedAccounts.length > 0 ? trustedAccounts.join(', ') : '(none)'}`));
        const trustedAccountsForLookup = removeUntrusted(params.trustedAccountsForLookup ?? splitCfnArray(current.parameters.TrustedAccountsForLookup));
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(`Trusted accounts for lookup: ${trustedAccountsForLookup.length > 0 ? trustedAccountsForLookup.join(', ') : '(none)'}`));
        const cloudFormationExecutionPolicies = params.cloudFormationExecutionPolicies ?? splitCfnArray(current.parameters.CloudFormationExecutionPolicies);
        if (trustedAccounts.length === 0 && cloudFormationExecutionPolicies.length === 0) {
            // For self-trust it's okay to default to AdministratorAccess, and it improves the usability of bootstrapping a lot.
            //
            // We don't actually make the implicitly policy a physical parameter. The template will infer it instead,
            // we simply do the UI advertising that behavior here.
            //
            // If we DID make it an explicit parameter, we wouldn't be able to tell the difference between whether
            // we inferred it or whether the user told us, and the sequence:
            //
            // $ cdk bootstrap
            // $ cdk bootstrap --trust 1234
            //
            // Would leave AdministratorAccess policies with a trust relationship, without the user explicitly
            // approving the trust policy.
            const implicitPolicy = `arn:${partition}:iam::aws:policy/AdministratorAccess`;
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Using default execution policy of '${implicitPolicy}'. Pass '--cloudformation-execution-policies' to customize.`));
        }
        else if (cloudFormationExecutionPolicies.length === 0) {
            throw new toolkit_error_1.ToolkitError(`Please pass \'--cloudformation-execution-policies\' when using \'--trust\' to specify deployment permissions. Try a managed policy of the form \'arn:${partition}:iam::aws:policy/<PolicyName>\'.`);
        }
        else {
            // Remind people what the current settings are
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(`Execution policies: ${cloudFormationExecutionPolicies.join(', ')}`));
        }
        // * If an ARN is given, that ARN. Otherwise:
        //   * '-' if customerKey = false
        //   * '' if customerKey = true
        //   * if customerKey is also not given
        //     * undefined if we already had a value in place (reusing what we had)
        //     * '-' if this is the first time we're deploying this stack (or upgrading from old to new bootstrap)
        const currentKmsKeyId = current.parameters.FileAssetsBucketKmsKeyId;
        const kmsKeyId = params.kmsKeyId ??
            (params.createCustomerMasterKey === true
                ? CREATE_NEW_KEY
                : params.createCustomerMasterKey === false || currentKmsKeyId === undefined
                    ? USE_AWS_MANAGED_KEY
                    : undefined);
        /* A permissions boundary can be provided via:
         *    - the flag indicating the example one should be used
         *    - the name indicating the custom permissions boundary to be used
         * Re-bootstrapping will NOT be blocked by either tightening or relaxing the permissions' boundary.
         */
        // InputPermissionsBoundary is an `any` type and if it is not defined it
        // appears as an empty string ''. We need to force it to evaluate an empty string
        // as undefined
        const currentPermissionsBoundary = current.parameters.InputPermissionsBoundary || undefined;
        const inputPolicyName = params.examplePermissionsBoundary
            ? CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY
            : params.customPermissionsBoundary;
        let policyName;
        if (inputPolicyName) {
            // If the example policy is not already in place, it must be created.
            const sdk = (await sdkProvider.forEnvironment(environment, plugin_1.Mode.ForWriting)).sdk;
            policyName = await this.getPolicyName(environment, sdk, inputPolicyName, partition, params);
        }
        if (currentPermissionsBoundary !== policyName) {
            if (!currentPermissionsBoundary) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Adding new permissions boundary ${policyName}`));
            }
            else if (!policyName) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Removing existing permissions boundary ${currentPermissionsBoundary}`));
            }
            else {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Changing permissions boundary from ${currentPermissionsBoundary} to ${policyName}`));
            }
        }
        return current.update(bootstrapTemplate, {
            FileAssetsBucketName: params.bucketName,
            FileAssetsBucketKmsKeyId: kmsKeyId,
            // Empty array becomes empty string
            TrustedAccounts: trustedAccounts.join(','),
            TrustedAccountsForLookup: trustedAccountsForLookup.join(','),
            CloudFormationExecutionPolicies: cloudFormationExecutionPolicies.join(','),
            Qualifier: params.qualifier,
            PublicAccessBlockConfiguration: params.publicAccessBlockConfiguration || params.publicAccessBlockConfiguration === undefined
                ? 'true'
                : 'false',
            InputPermissionsBoundary: policyName,
        }, {
            ...options,
            terminationProtection: options.terminationProtection ?? current.terminationProtection,
        });
    }
    async getPolicyName(environment, sdk, permissionsBoundary, partition, params) {
        if (permissionsBoundary !== CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY) {
            this.validatePolicyName(permissionsBoundary);
            return Promise.resolve(permissionsBoundary);
        }
        // if no Qualifier is supplied, resort to the default one
        const arn = await this.getExamplePermissionsBoundary(params.qualifier ?? 'hnb659fds', partition, environment.account, sdk);
        const policyName = arn.split('/').pop();
        if (!policyName) {
            throw new toolkit_error_1.ToolkitError('Could not retrieve the example permission boundary!');
        }
        return Promise.resolve(policyName);
    }
    async getExamplePermissionsBoundary(qualifier, partition, account, sdk) {
        const iam = sdk.iam();
        let policyName = `cdk-${qualifier}-permissions-boundary`;
        const arn = `arn:${partition}:iam::${account}:policy/${policyName}`;
        try {
            let getPolicyResp = await iam.getPolicy({ PolicyArn: arn });
            if (getPolicyResp.Policy) {
                return arn;
            }
        }
        catch (e) {
            // https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetPolicy.html#API_GetPolicy_Errors
            if (e.name === 'NoSuchEntity') {
                // noop, proceed with creating the policy
            }
            else {
                throw e;
            }
        }
        const policyDoc = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: ['*'],
                    Resource: '*',
                    Effect: 'Allow',
                    Sid: 'ExplicitAllowAll',
                },
                {
                    Condition: {
                        StringEquals: {
                            'iam:PermissionsBoundary': `arn:${partition}:iam::${account}:policy/cdk-${qualifier}-permissions-boundary`,
                        },
                    },
                    Action: [
                        'iam:CreateUser',
                        'iam:CreateRole',
                        'iam:PutRolePermissionsBoundary',
                        'iam:PutUserPermissionsBoundary',
                    ],
                    Resource: '*',
                    Effect: 'Allow',
                    Sid: 'DenyAccessIfRequiredPermBoundaryIsNotBeingApplied',
                },
                {
                    Action: [
                        'iam:CreatePolicyVersion',
                        'iam:DeletePolicy',
                        'iam:DeletePolicyVersion',
                        'iam:SetDefaultPolicyVersion',
                    ],
                    Resource: `arn:${partition}:iam::${account}:policy/cdk-${qualifier}-permissions-boundary`,
                    Effect: 'Deny',
                    Sid: 'DenyPermBoundaryIAMPolicyAlteration',
                },
                {
                    Action: ['iam:DeleteUserPermissionsBoundary', 'iam:DeleteRolePermissionsBoundary'],
                    Resource: '*',
                    Effect: 'Deny',
                    Sid: 'DenyRemovalOfPermBoundaryFromAnyUserOrRole',
                },
            ],
        };
        const request = {
            PolicyName: policyName,
            PolicyDocument: JSON.stringify(policyDoc),
        };
        const createPolicyResponse = await iam.createPolicy(request);
        if (createPolicyResponse.Policy?.Arn) {
            return createPolicyResponse.Policy.Arn;
        }
        else {
            throw new toolkit_error_1.ToolkitError(`Could not retrieve the example permission boundary ${arn}!`);
        }
    }
    validatePolicyName(permissionsBoundary) {
        // https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicy.html
        // Added support for policy names with a path
        // See https://github.com/aws/aws-cdk/issues/26320
        const regexp = /[\w+\/=,.@-]+/;
        const matches = regexp.exec(permissionsBoundary);
        if (!(matches && matches.length === 1 && matches[0] === permissionsBoundary)) {
            throw new toolkit_error_1.ToolkitError(`The permissions boundary name ${permissionsBoundary} does not match the IAM conventions.`);
        }
    }
    async customBootstrap(environment, sdkProvider, options = {}) {
        // Look at the template, decide whether it's most likely a legacy or modern bootstrap
        // template, and use the right bootstrapper for that.
        const version = (0, deploy_bootstrap_1.bootstrapVersionFromTemplate)(await this.loadTemplate());
        if (version === 0) {
            return this.legacyBootstrap(environment, sdkProvider, options);
        }
        else {
            return this.modernBootstrap(environment, sdkProvider, options);
        }
    }
    async loadTemplate(params = {}) {
        switch (this.source.source) {
            case 'custom':
                return (0, util_1.loadStructuredFile)(this.source.templateFile);
            case 'default':
                return (0, util_1.loadStructuredFile)(path.join((0, util_1.bundledPackageRootDir)(__dirname), 'lib', 'api', 'bootstrap', 'bootstrap-template.yaml'));
            case 'legacy':
                return (0, legacy_template_1.legacyBootstrapTemplate)(params);
        }
    }
}
exports.Bootstrapper = Bootstrapper;
/**
 * Magic parameter value that will cause the bootstrap-template.yml to NOT create a CMK but use the default key
 */
const USE_AWS_MANAGED_KEY = 'AWS_MANAGED_KEY';
/**
 * Magic parameter value that will cause the bootstrap-template.yml to create a CMK
 */
const CREATE_NEW_KEY = '';
/**
 * Parameter value indicating the use of the default, CDK provided permissions boundary for bootstrap-template.yml
 */
const CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY = 'CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY';
/**
 * Split an array-like CloudFormation parameter on ,
 *
 * An empty string is the empty array (instead of `['']`).
 */
function splitCfnArray(xs) {
    if (xs === '' || xs === undefined) {
        return [];
    }
    return xs.split(',');
}
function intersection(xs, ys) {
    return new Set(Array.from(xs).filter(x => ys.has(x)));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwLWVudmlyb25tZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9ib290c3RyYXAvYm9vdHN0cmFwLWVudmlyb25tZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZCQUE2QjtBQUc3Qix5REFBa0Y7QUFDbEYsdURBQTREO0FBQzVELHFDQUEyRjtBQUczRiwyQ0FBa0Q7QUFDbEQsc0NBQWlDO0FBQ2pDLG9EQUFnRDtBQUNoRCxrREFBNkQ7QUFJN0QsTUFBYSxZQUFZO0lBSUo7SUFIRixRQUFRLENBQVc7SUFFcEMsWUFDbUIsU0FBMEIsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLEVBQ2hFLFFBQWtCO1FBREQsV0FBTSxHQUFOLE1BQU0sQ0FBeUM7UUFHaEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7SUFDM0IsQ0FBQztJQUVNLG9CQUFvQixDQUN6QixXQUE4QixFQUM5QixXQUF3QixFQUN4QixVQUF1QyxFQUFFO1FBRXpDLFFBQVEsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUMzQixLQUFLLFFBQVE7Z0JBQ1gsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDakUsS0FBSyxTQUFTO2dCQUNaLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQ2pFLEtBQUssUUFBUTtnQkFDWCxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsV0FBVyxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNuRSxDQUFDO0lBQ0gsQ0FBQztJQUVNLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBYTtRQUNyQyxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztRQUMzQyxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUss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LElBQUksR0FBRyxDQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDM0QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgdHlwZSAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgdHlwZSB7IEJvb3RzdHJhcEVudmlyb25tZW50T3B0aW9ucywgQm9vdHN0cmFwcGluZ1BhcmFtZXRlcnMgfSBmcm9tICcuL2Jvb3RzdHJhcC1wcm9wcyc7XG5pbXBvcnQgeyBCb290c3RyYXBTdGFjaywgYm9vdHN0cmFwVmVyc2lvbkZyb21UZW1wbGF0ZSB9IGZyb20gJy4vZGVwbG95LWJvb3RzdHJhcCc7XG5pbXBvcnQgeyBsZWdhY3lCb290c3RyYXBUZW1wbGF0ZSB9IGZyb20gJy4vbGVnYWN5LXRlbXBsYXRlJztcbmltcG9ydCB7IGJ1bmRsZWRQYWNrYWdlUm9vdERpciwgbG9hZFN0cnVjdHVyZWRGaWxlLCBzZXJpYWxpemVTdHJ1Y3R1cmUgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgU0RLLCBTZGtQcm92aWRlciB9IGZyb20gJy4uL2F3cy1hdXRoJztcbmltcG9ydCB0eXBlIHsgU3VjY2Vzc2Z1bERlcGxveVN0YWNrUmVzdWx0IH0gZnJvbSAnLi4vZGVwbG95bWVudHMnO1xuaW1wb3J0IHsgSU8sIHR5cGUgSW9IZWxwZXIgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB7IE1vZGUgfSBmcm9tICcuLi9wbHVnaW4nO1xuaW1wb3J0IHsgVG9vbGtpdEVycm9yIH0gZnJvbSAnLi4vdG9vbGtpdC1lcnJvcic7XG5pbXBvcnQgeyBERUZBVUxUX1RPT0xLSVRfU1RBQ0tfTkFNRSB9IGZyb20gJy4uL3Rvb2xraXQtaW5mbyc7XG5cbmV4cG9ydCB0eXBlIEJvb3RzdHJhcFNvdXJjZSA9IHsgc291cmNlOiAnbGVnYWN5JyB9IHwgeyBzb3VyY2U6ICdkZWZhdWx0JyB9IHwgeyBzb3VyY2U6ICdjdXN0b20nOyB0ZW1wbGF0ZUZpbGU6IHN0cmluZyB9O1xuXG5leHBvcnQgY2xhc3MgQm9vdHN0cmFwcGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBzb3VyY2U6IEJvb3RzdHJhcFNvdXJjZSA9IHsgc291cmNlOiAnZGVmYXVsdCcgfSxcbiAgICBpb0hlbHBlcjogSW9IZWxwZXIsXG4gICkge1xuICAgIHRoaXMuaW9IZWxwZXIgPSBpb0hlbHBlcjtcbiAgfVxuXG4gIHB1YmxpYyBib290c3RyYXBFbnZpcm9ubWVudChcbiAgICBlbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQsXG4gICAgc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyLFxuICAgIG9wdGlvbnM6IEJvb3RzdHJhcEVudmlyb25tZW50T3B0aW9ucyA9IHt9LFxuICApOiBQcm9taXNlPFN1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdD4ge1xuICAgIHN3aXRjaCAodGhpcy5zb3VyY2Uuc291cmNlKSB7XG4gICAgICBjYXNlICdsZWdhY3knOlxuICAgICAgICByZXR1cm4gdGhpcy5sZWdhY3lCb290c3RyYXAoZW52aXJvbm1lbnQsIHNka1Byb3ZpZGVyLCBvcHRpb25zKTtcbiAgICAgIGNhc2UgJ2RlZmF1bHQnOlxuICAgICAgICByZXR1cm4gdGhpcy5tb2Rlcm5Cb290c3RyYXAoZW52aXJvbm1lbnQsIHNka1Byb3ZpZGVyLCBvcHRpb25zKTtcbiAgICAgIGNhc2UgJ2N1c3RvbSc6XG4gICAgICAgIHJldHVybiB0aGlzLmN1c3RvbUJvb3RzdHJhcChlbnZpcm9ubWVudCwgc2RrUHJvdmlkZXIsIG9wdGlvbnMpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzaG93VGVtcGxhdGUoanNvbjogYm9vbGVhbikge1xuICAgIGNvbnN0IHRlbXBsYXRlID0gYXdhaXQgdGhpcy5sb2FkVGVtcGxhdGUoKTtcbiAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShgJHtzZXJpYWxpemVTdHJ1Y3R1cmUodGVtcGxhdGUsIGpzb24pfVxcbmApO1xuICB9XG5cbiAgLyoqXG4gICAqIERlcGxveSBsZWdhY3kgYm9vdHN0cmFwIHN0YWNrXG4gICAqXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGxlZ2FjeUJvb3RzdHJhcChcbiAgICBlbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQsXG4gICAgc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyLFxuICAgIG9wdGlvbnM6IEJvb3RzdHJhcEVudmlyb25tZW50T3B0aW9ucyA9IHt9LFxuICApOiBQcm9taXNlPFN1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdD4ge1xuICAgIGNvbnN0IHBhcmFtcyA9IG9wdGlvbnMucGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGlmIChwYXJhbXMudHJ1c3RlZEFjY291bnRzPy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJy0tdHJ1c3QgY2FuIG9ubHkgYmUgcGFzc2VkIGZvciB0aGUgbW9kZXJuIGJvb3RzdHJhcCBleHBlcmllbmNlLicpO1xuICAgIH1cbiAgICBpZiAocGFyYW1zLmNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUG9saWNpZXM/Lmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcignLS1jbG91ZGZvcm1hdGlvbi1leGVjdXRpb24tcG9saWNpZXMgY2FuIG9ubHkgYmUgcGFzc2VkIGZvciB0aGUgbW9kZXJuIGJvb3RzdHJhcCBleHBlcmllbmNlLicpO1xuICAgIH1cbiAgICBpZiAocGFyYW1zLmNyZWF0ZUN1c3RvbWVyTWFzdGVyS2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJy0tYm9vdHN0cmFwLWN1c3RvbWVyLWtleSBjYW4gb25seSBiZSBwYXNzZWQgZm9yIHRoZSBtb2Rlcm4gYm9vdHN0cmFwIGV4cGVyaWVuY2UuJyk7XG4gICAgfVxuICAgIGlmIChwYXJhbXMucXVhbGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCctLXF1YWxpZmllciBjYW4gb25seSBiZSBwYXNzZWQgZm9yIHRoZSBtb2Rlcm4gYm9vdHN0cmFwIGV4cGVyaWVuY2UuJyk7XG4gICAgfVxuXG4gICAgY29uc3QgdG9vbGtpdFN0YWNrTmFtZSA9IG9wdGlvbnMudG9vbGtpdFN0YWNrTmFtZSA/PyBERUZBVUxUX1RPT0xLSVRfU1RBQ0tfTkFNRTtcbiAgICBjb25zdCBjdXJyZW50ID0gYXdhaXQgQm9vdHN0cmFwU3RhY2subG9va3VwKHNka1Byb3ZpZGVyLCBlbnZpcm9ubWVudCwgdG9vbGtpdFN0YWNrTmFtZSwgdGhpcy5pb0hlbHBlcik7XG4gICAgcmV0dXJuIGN1cnJlbnQudXBkYXRlKFxuICAgICAgYXdhaXQgdGhpcy5sb2FkVGVtcGxhdGUocGFyYW1zKSxcbiAgICAgIHt9LFxuICAgICAge1xuICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICB0ZXJtaW5hdGlvblByb3RlY3Rpb246IG9wdGlvbnMudGVybWluYXRpb25Qcm90ZWN0aW9uID8/IGN1cnJlbnQudGVybWluYXRpb25Qcm90ZWN0aW9uLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIERlcGxveSBDSS9DRC1yZWFkeSBib290c3RyYXAgc3RhY2sgZnJvbSB0ZW1wbGF0ZVxuICAgKlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBtb2Rlcm5Cb290c3RyYXAoXG4gICAgZW52aXJvbm1lbnQ6IGN4YXBpLkVudmlyb25tZW50LFxuICAgIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgICBvcHRpb25zOiBCb290c3RyYXBFbnZpcm9ubWVudE9wdGlvbnMgPSB7fSxcbiAgKTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJhbXMgPSBvcHRpb25zLnBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBib290c3RyYXBUZW1wbGF0ZSA9IGF3YWl0IHRoaXMubG9hZFRlbXBsYXRlKCk7XG5cbiAgICBjb25zdCB0b29sa2l0U3RhY2tOYW1lID0gb3B0aW9ucy50b29sa2l0U3RhY2tOYW1lID8/IERFRkFVTFRfVE9PTEtJVF9TVEFDS19OQU1FO1xuICAgIGNvbnN0IGN1cnJlbnQgPSBhd2FpdCBCb290c3RyYXBTdGFjay5sb29rdXAoc2RrUHJvdmlkZXIsIGVudmlyb25tZW50LCB0b29sa2l0U3RhY2tOYW1lLCB0aGlzLmlvSGVscGVyKTtcbiAgICBjb25zdCBwYXJ0aXRpb24gPSBhd2FpdCBjdXJyZW50LnBhcnRpdGlvbigpO1xuXG4gICAgaWYgKHBhcmFtcy5jcmVhdGVDdXN0b21lck1hc3RlcktleSAhPT0gdW5kZWZpbmVkICYmIHBhcmFtcy5rbXNLZXlJZCkge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihcbiAgICAgICAgXCJZb3UgY2Fubm90IHBhc3MgJy0tYm9vdHN0cmFwLWttcy1rZXktaWQnIGFuZCAnLS1ib290c3RyYXAtY3VzdG9tZXIta2V5JyB0b2dldGhlci4gU3BlY2lmeSBvbmUgb3IgdGhlIG90aGVyXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIElmIHBlb3BsZSByZS1ib290c3RyYXAsIGV4aXN0aW5nIHBhcmFtZXRlciB2YWx1ZXMgYXJlIHJldXNlZCBzbyB0aGF0IHBlb3BsZSBkb24ndCBhY2NpZGVudGFsbHkgY2hhbmdlIHRoZSBjb25maWd1cmF0aW9uXG4gICAgLy8gb24gdGhlaXIgYm9vdHN0cmFwIHN0YWNrICh0aGlzIGhhcHBlbnMgYXV0b21hdGljYWxseSBpbiBkZXBsb3lTdGFjaykuIEhvd2V2ZXIsIHRvIGRvIHByb3BlciB2YWxpZGF0aW9uIG9uIHRoZVxuICAgIC8vIGNvbWJpbmVkIGFyZ3VtZW50cyAoc3VjaCB0aGF0IGlmIC0tdHJ1c3QgaGFzIGJlZW4gZ2l2ZW4sIC0tY2xvdWRmb3JtYXRpb24tZXhlY3V0aW9uLXBvbGljaWVzIGlzIG5lY2Vzc2FyeSBhcyB3ZWxsKVxuICAgIC8vIHdlIG5lZWQgdG8gdGFrZSB0aGlzIHBhcmFtZXRlciByZXVzZSBpbnRvIGFjY291bnQuXG4gICAgLy9cbiAgICAvLyBJZGVhbGx5IHdlJ2QgZG8gdGhpcyBpbnNpZGUgdGhlIHRlbXBsYXRlLCBidXQgdGhlIGBSdWxlc2Agc2VjdGlvbiBvZiBDRk5cbiAgICAvLyB0ZW1wbGF0ZXMgZG9lc24ndCBzZWVtIHRvIGJlIGFibGUgdG8gZXhwcmVzcyB0aGUgY29uZGl0aW9ucyB0aGF0IHdlIG5lZWRcbiAgICAvLyAoY2FuJ3QgdXNlIEZuOjpKb2luIG9yIHJlZmVyZW5jZSBDb25kaXRpb25zKSBzbyB3ZSBkbyBpdCBoZXJlIGluc3RlYWQuXG4gICAgY29uc3QgYWxsVHJ1c3RlZCA9IG5ldyBTZXQoW1xuICAgICAgLi4ucGFyYW1zLnRydXN0ZWRBY2NvdW50cyA/PyBbXSxcbiAgICAgIC4uLnBhcmFtcy50cnVzdGVkQWNjb3VudHNGb3JMb29rdXAgPz8gW10sXG4gICAgXSk7XG4gICAgY29uc3QgaW52YWxpZCA9IGludGVyc2VjdGlvbihhbGxUcnVzdGVkLCBuZXcgU2V0KHBhcmFtcy51bnRydXN0ZWRBY2NvdW50cykpO1xuICAgIGlmIChpbnZhbGlkLnNpemUgPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBBY2NvdW50cyBjYW5ub3QgYmUgYm90aCB0cnVzdGVkIGFuZCB1bnRydXN0ZWQuIEZvdW5kOiAke1suLi5pbnZhbGlkXS5qb2luKCcsJyl9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVtb3ZlVW50cnVzdGVkID0gKGFjY291bnRzOiBzdHJpbmdbXSkgPT5cbiAgICAgIGFjY291bnRzLmZpbHRlcihhY2MgPT4gIXBhcmFtcy51bnRydXN0ZWRBY2NvdW50cz8ubWFwKFN0cmluZykuaW5jbHVkZXMoU3RyaW5nKGFjYykpKTtcblxuICAgIGNvbnN0IHRydXN0ZWRBY2NvdW50cyA9IHJlbW92ZVVudHJ1c3RlZChwYXJhbXMudHJ1c3RlZEFjY291bnRzID8/IHNwbGl0Q2ZuQXJyYXkoY3VycmVudC5wYXJhbWV0ZXJzLlRydXN0ZWRBY2NvdW50cykpO1xuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9JTkZPLm1zZyhcbiAgICAgIGBUcnVzdGVkIGFjY291bnRzIGZvciBkZXBsb3ltZW50OiAke3RydXN0ZWRBY2NvdW50cy5sZW5ndGggPiAwID8gdHJ1c3RlZEFjY291bnRzLmpvaW4oJywgJykgOiAnKG5vbmUpJ31gLFxuICAgICkpO1xuXG4gICAgY29uc3QgdHJ1c3RlZEFjY291bnRzRm9yTG9va3VwID0gcmVtb3ZlVW50cnVzdGVkKFxuICAgICAgcGFyYW1zLnRydXN0ZWRBY2NvdW50c0Zvckxvb2t1cCA/PyBzcGxpdENmbkFycmF5KGN1cnJlbnQucGFyYW1ldGVycy5UcnVzdGVkQWNjb3VudHNGb3JMb29rdXApLFxuICAgICk7XG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKFxuICAgICAgYFRydXN0ZWQgYWNjb3VudHMgZm9yIGxvb2t1cDogJHt0cnVzdGVkQWNjb3VudHNGb3JMb29rdXAubGVuZ3RoID4gMCA/IHRydXN0ZWRBY2NvdW50c0Zvckxvb2t1cC5qb2luKCcsICcpIDogJyhub25lKSd9YCxcbiAgICApKTtcblxuICAgIGNvbnN0IGNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUG9saWNpZXMgPVxuICAgICAgcGFyYW1zLmNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUG9saWNpZXMgPz8gc3BsaXRDZm5BcnJheShjdXJyZW50LnBhcmFtZXRlcnMuQ2xvdWRGb3JtYXRpb25FeGVjdXRpb25Qb2xpY2llcyk7XG4gICAgaWYgKHRydXN0ZWRBY2NvdW50cy5sZW5ndGggPT09IDAgJiYgY2xvdWRGb3JtYXRpb25FeGVjdXRpb25Qb2xpY2llcy5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEZvciBzZWxmLXRydXN0IGl0J3Mgb2theSB0byBkZWZhdWx0IHRvIEFkbWluaXN0cmF0b3JBY2Nlc3MsIGFuZCBpdCBpbXByb3ZlcyB0aGUgdXNhYmlsaXR5IG9mIGJvb3RzdHJhcHBpbmcgYSBsb3QuXG4gICAgICAvL1xuICAgICAgLy8gV2UgZG9uJ3QgYWN0dWFsbHkgbWFrZSB0aGUgaW1wbGljaXRseSBwb2xpY3kgYSBwaHlzaWNhbCBwYXJhbWV0ZXIuIFRoZSB0ZW1wbGF0ZSB3aWxsIGluZmVyIGl0IGluc3RlYWQsXG4gICAgICAvLyB3ZSBzaW1wbHkgZG8gdGhlIFVJIGFkdmVydGlzaW5nIHRoYXQgYmVoYXZpb3IgaGVyZS5cbiAgICAgIC8vXG4gICAgICAvLyBJZiB3ZSBESUQgbWFrZSBpdCBhbiBleHBsaWNpdCBwYXJhbWV0ZXIsIHdlIHdvdWxkbid0IGJlIGFibGUgdG8gdGVsbCB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIHdoZXRoZXJcbiAgICAgIC8vIHdlIGluZmVycmVkIGl0IG9yIHdoZXRoZXIgdGhlIHVzZXIgdG9sZCB1cywgYW5kIHRoZSBzZXF1ZW5jZTpcbiAgICAgIC8vXG4gICAgICAvLyAkIGNkayBib290c3RyYXBcbiAgICAgIC8vICQgY2RrIGJvb3RzdHJhcCAtLXRydXN0IDEyMzRcbiAgICAgIC8vXG4gICAgICAvLyBXb3VsZCBsZWF2ZSBBZG1pbmlzdHJhdG9yQWNjZXNzIHBvbGljaWVzIHdpdGggYSB0cnVzdCByZWxhdGlvbnNoaXAsIHdpdGhvdXQgdGhlIHVzZXIgZXhwbGljaXRseVxuICAgICAgLy8gYXBwcm92aW5nIHRoZSB0cnVzdCBwb2xpY3kuXG4gICAgICBjb25zdCBpbXBsaWNpdFBvbGljeSA9IGBhcm46JHtwYXJ0aXRpb259OmlhbTo6YXdzOnBvbGljeS9BZG1pbmlzdHJhdG9yQWNjZXNzYDtcbiAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9XQVJOLm1zZyhcbiAgICAgICAgYFVzaW5nIGRlZmF1bHQgZXhlY3V0aW9uIHBvbGljeSBvZiAnJHtpbXBsaWNpdFBvbGljeX0nLiBQYXNzICctLWNsb3VkZm9ybWF0aW9uLWV4ZWN1dGlvbi1wb2xpY2llcycgdG8gY3VzdG9taXplLmAsXG4gICAgICApKTtcbiAgICB9IGVsc2UgaWYgKGNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUG9saWNpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKFxuICAgICAgICBgUGxlYXNlIHBhc3MgXFwnLS1jbG91ZGZvcm1hdGlvbi1leGVjdXRpb24tcG9saWNpZXNcXCcgd2hlbiB1c2luZyBcXCctLXRydXN0XFwnIHRvIHNwZWNpZnkgZGVwbG95bWVudCBwZXJtaXNzaW9ucy4gVHJ5IGEgbWFuYWdlZCBwb2xpY3kgb2YgdGhlIGZvcm0gXFwnYXJuOiR7cGFydGl0aW9ufTppYW06OmF3czpwb2xpY3kvPFBvbGljeU5hbWU+XFwnLmAsXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1pbmQgcGVvcGxlIHdoYXQgdGhlIGN1cnJlbnQgc2V0dGluZ3MgYXJlXG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfSU5GTy5tc2coYEV4ZWN1dGlvbiBwb2xpY2llczogJHtjbG91ZEZvcm1hdGlvbkV4ZWN1dGlvblBvbGljaWVzLmpvaW4oJywgJyl9YCkpO1xuICAgIH1cblxuICAgIC8vICogSWYgYW4gQVJOIGlzIGdpdmVuLCB0aGF0IEFSTi4gT3RoZXJ3aXNlOlxuICAgIC8vICAgKiAnLScgaWYgY3VzdG9tZXJLZXkgPSBmYWxzZVxuICAgIC8vICAgKiAnJyBpZiBjdXN0b21lcktleSA9IHRydWVcbiAgICAvLyAgICogaWYgY3VzdG9tZXJLZXkgaXMgYWxzbyBub3QgZ2l2ZW5cbiAgICAvLyAgICAgKiB1bmRlZmluZWQgaWYgd2UgYWxyZWFkeSBoYWQgYSB2YWx1ZSBpbiBwbGFjZSAocmV1c2luZyB3aGF0IHdlIGhhZClcbiAgICAvLyAgICAgKiAnLScgaWYgdGhpcyBpcyB0aGUgZmlyc3QgdGltZSB3ZSdyZSBkZXBsb3lpbmcgdGhpcyBzdGFjayAob3IgdXBncmFkaW5nIGZyb20gb2xkIHRvIG5ldyBib290c3RyYXApXG4gICAgY29uc3QgY3VycmVudEttc0tleUlkID0gY3VycmVudC5wYXJhbWV0ZXJzLkZpbGVBc3NldHNCdWNrZXRLbXNLZXlJZDtcbiAgICBjb25zdCBrbXNLZXlJZCA9XG4gICAgICBwYXJhbXMua21zS2V5SWQgPz9cbiAgICAgIChwYXJhbXMuY3JlYXRlQ3VzdG9tZXJNYXN0ZXJLZXkgPT09IHRydWVcbiAgICAgICAgPyBDUkVBVEVfTkVXX0tFWVxuICAgICAgICA6IHBhcmFtcy5jcmVhdGVDdXN0b21lck1hc3RlcktleSA9PT0gZmFsc2UgfHwgY3VycmVudEttc0tleUlkID09PSB1bmRlZmluZWRcbiAgICAgICAgICA/IFVTRV9BV1NfTUFOQUdFRF9LRVlcbiAgICAgICAgICA6IHVuZGVmaW5lZCk7XG5cbiAgICAvKiBBIHBlcm1pc3Npb25zIGJvdW5kYXJ5IGNhbiBiZSBwcm92aWRlZCB2aWE6XG4gICAgICogICAgLSB0aGUgZmxhZyBpbmRpY2F0aW5nIHRoZSBleGFtcGxlIG9uZSBzaG91bGQgYmUgdXNlZFxuICAgICAqICAgIC0gdGhlIG5hbWUgaW5kaWNhdGluZyB0aGUgY3VzdG9tIHBlcm1pc3Npb25zIGJvdW5kYXJ5IHRvIGJlIHVzZWRcbiAgICAgKiBSZS1ib290c3RyYXBwaW5nIHdpbGwgTk9UIGJlIGJsb2NrZWQgYnkgZWl0aGVyIHRpZ2h0ZW5pbmcgb3IgcmVsYXhpbmcgdGhlIHBlcm1pc3Npb25zJyBib3VuZGFyeS5cbiAgICAgKi9cblxuICAgIC8vIElucHV0UGVybWlzc2lvbnNCb3VuZGFyeSBpcyBhbiBgYW55YCB0eXBlIGFuZCBpZiBpdCBpcyBub3QgZGVmaW5lZCBpdFxuICAgIC8vIGFwcGVhcnMgYXMgYW4gZW1wdHkgc3RyaW5nICcnLiBXZSBuZWVkIHRvIGZvcmNlIGl0IHRvIGV2YWx1YXRlIGFuIGVtcHR5IHN0cmluZ1xuICAgIC8vIGFzIHVuZGVmaW5lZFxuICAgIGNvbnN0IGN1cnJlbnRQZXJtaXNzaW9uc0JvdW5kYXJ5OiBzdHJpbmcgfCB1bmRlZmluZWQgPSBjdXJyZW50LnBhcmFtZXRlcnMuSW5wdXRQZXJtaXNzaW9uc0JvdW5kYXJ5IHx8IHVuZGVmaW5lZDtcbiAgICBjb25zdCBpbnB1dFBvbGljeU5hbWUgPSBwYXJhbXMuZXhhbXBsZVBlcm1pc3Npb25zQm91bmRhcnlcbiAgICAgID8gQ0RLX0JPT1RTVFJBUF9QRVJNSVNTSU9OU19CT1VOREFSWVxuICAgICAgOiBwYXJhbXMuY3VzdG9tUGVybWlzc2lvbnNCb3VuZGFyeTtcbiAgICBsZXQgcG9saWN5TmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGlmIChpbnB1dFBvbGljeU5hbWUpIHtcbiAgICAgIC8vIElmIHRoZSBleGFtcGxlIHBvbGljeSBpcyBub3QgYWxyZWFkeSBpbiBwbGFjZSwgaXQgbXVzdCBiZSBjcmVhdGVkLlxuICAgICAgY29uc3Qgc2RrID0gKGF3YWl0IHNka1Byb3ZpZGVyLmZvckVudmlyb25tZW50KGVudmlyb25tZW50LCBNb2RlLkZvcldyaXRpbmcpKS5zZGs7XG4gICAgICBwb2xpY3lOYW1lID0gYXdhaXQgdGhpcy5nZXRQb2xpY3lOYW1lKGVudmlyb25tZW50LCBzZGssIGlucHV0UG9saWN5TmFtZSwgcGFydGl0aW9uLCBwYXJhbXMpO1xuICAgIH1cbiAgICBpZiAoY3VycmVudFBlcm1pc3Npb25zQm91bmRhcnkgIT09IHBvbGljeU5hbWUpIHtcbiAgICAgIGlmICghY3VycmVudFBlcm1pc3Npb25zQm91bmRhcnkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX1dBUk4ubXNnKFxuICAgICAgICAgIGBBZGRpbmcgbmV3IHBlcm1pc3Npb25zIGJvdW5kYXJ5ICR7cG9saWN5TmFtZX1gLFxuICAgICAgICApKTtcbiAgICAgIH0gZWxzZSBpZiAoIXBvbGljeU5hbWUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX1dBUk4ubXNnKFxuICAgICAgICAgIGBSZW1vdmluZyBleGlzdGluZyBwZXJtaXNzaW9ucyBib3VuZGFyeSAke2N1cnJlbnRQZXJtaXNzaW9uc0JvdW5kYXJ5fWAsXG4gICAgICAgICkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX1dBUk4ubXNnKFxuICAgICAgICAgIGBDaGFuZ2luZyBwZXJtaXNzaW9ucyBib3VuZGFyeSBmcm9tICR7Y3VycmVudFBlcm1pc3Npb25zQm91bmRhcnl9IHRvICR7cG9saWN5TmFtZX1gLFxuICAgICAgICApKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY3VycmVudC51cGRhdGUoXG4gICAgICBib290c3RyYXBUZW1wbGF0ZSxcbiAgICAgIHtcbiAgICAgICAgRmlsZUFzc2V0c0J1Y2tldE5hbWU6IHBhcmFtcy5idWNrZXROYW1lLFxuICAgICAgICBGaWxlQXNzZXRzQnVja2V0S21zS2V5SWQ6IGttc0tleUlkLFxuICAgICAgICAvLyBFbXB0eSBhcnJheSBiZWNvbWVzIGVtcHR5IHN0cmluZ1xuICAgICAgICBUcnVzdGVkQWNjb3VudHM6IHRydXN0ZWRBY2NvdW50cy5qb2luKCcsJyksXG4gICAgICAgIFRydXN0ZWRBY2NvdW50c0Zvckxvb2t1cDogdHJ1c3RlZEFjY291bnRzRm9yTG9va3VwLmpvaW4oJywnKSxcbiAgICAgICAgQ2xvdWRGb3JtYXRpb25FeGVjdXRpb25Qb2xpY2llczogY2xvdWRGb3JtYXRpb25FeGVjdXRpb25Qb2xpY2llcy5qb2luKCcsJyksXG4gICAgICAgIFF1YWxpZmllcjogcGFyYW1zLnF1YWxpZmllcixcbiAgICAgICAgUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uOlxuICAgICAgICAgIHBhcmFtcy5wdWJsaWNBY2Nlc3NCbG9ja0NvbmZpZ3VyYXRpb24gfHwgcGFyYW1zLnB1YmxpY0FjY2Vzc0Jsb2NrQ29uZmlndXJhdGlvbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/ICd0cnVlJ1xuICAgICAgICAgICAgOiAnZmFsc2UnLFxuICAgICAgICBJbnB1dFBlcm1pc3Npb25zQm91bmRhcnk6IHBvbGljeU5hbWUsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICB0ZXJtaW5hdGlvblByb3RlY3Rpb246IG9wdGlvbnMudGVybWluYXRpb25Qcm90ZWN0aW9uID8/IGN1cnJlbnQudGVybWluYXRpb25Qcm90ZWN0aW9uLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRQb2xpY3lOYW1lKFxuICAgIGVudmlyb25tZW50OiBjeGFwaS5FbnZpcm9ubWVudCxcbiAgICBzZGs6IFNESyxcbiAgICBwZXJtaXNzaW9uc0JvdW5kYXJ5OiBzdHJpbmcsXG4gICAgcGFydGl0aW9uOiBzdHJpbmcsXG4gICAgcGFyYW1zOiBCb290c3RyYXBwaW5nUGFyYW1ldGVycyxcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAocGVybWlzc2lvbnNCb3VuZGFyeSAhPT0gQ0RLX0JPT1RTVFJBUF9QRVJNSVNTSU9OU19CT1VOREFSWSkge1xuICAgICAgdGhpcy52YWxpZGF0ZVBvbGljeU5hbWUocGVybWlzc2lvbnNCb3VuZGFyeSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHBlcm1pc3Npb25zQm91bmRhcnkpO1xuICAgIH1cbiAgICAvLyBpZiBubyBRdWFsaWZpZXIgaXMgc3VwcGxpZWQsIHJlc29ydCB0byB0aGUgZGVmYXVsdCBvbmVcbiAgICBjb25zdCBhcm4gPSBhd2FpdCB0aGlzLmdldEV4YW1wbGVQZXJtaXNzaW9uc0JvdW5kYXJ5KFxuICAgICAgcGFyYW1zLnF1YWxpZmllciA/PyAnaG5iNjU5ZmRzJyxcbiAgICAgIHBhcnRpdGlvbixcbiAgICAgIGVudmlyb25tZW50LmFjY291bnQsXG4gICAgICBzZGssXG4gICAgKTtcbiAgICBjb25zdCBwb2xpY3lOYW1lID0gYXJuLnNwbGl0KCcvJykucG9wKCk7XG4gICAgaWYgKCFwb2xpY3lOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCdDb3VsZCBub3QgcmV0cmlldmUgdGhlIGV4YW1wbGUgcGVybWlzc2lvbiBib3VuZGFyeSEnKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShwb2xpY3lOYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0RXhhbXBsZVBlcm1pc3Npb25zQm91bmRhcnkoXG4gICAgcXVhbGlmaWVyOiBzdHJpbmcsXG4gICAgcGFydGl0aW9uOiBzdHJpbmcsXG4gICAgYWNjb3VudDogc3RyaW5nLFxuICAgIHNkazogU0RLLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGlhbSA9IHNkay5pYW0oKTtcblxuICAgIGxldCBwb2xpY3lOYW1lID0gYGNkay0ke3F1YWxpZmllcn0tcGVybWlzc2lvbnMtYm91bmRhcnlgO1xuICAgIGNvbnN0IGFybiA9IGBhcm46JHtwYXJ0aXRpb259OmlhbTo6JHthY2NvdW50fTpwb2xpY3kvJHtwb2xpY3lOYW1lfWA7XG5cbiAgICB0cnkge1xuICAgICAgbGV0IGdldFBvbGljeVJlc3AgPSBhd2FpdCBpYW0uZ2V0UG9saWN5KHsgUG9saWN5QXJuOiBhcm4gfSk7XG4gICAgICBpZiAoZ2V0UG9saWN5UmVzcC5Qb2xpY3kpIHtcbiAgICAgICAgcmV0dXJuIGFybjtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9JQU0vbGF0ZXN0L0FQSVJlZmVyZW5jZS9BUElfR2V0UG9saWN5Lmh0bWwjQVBJX0dldFBvbGljeV9FcnJvcnNcbiAgICAgIGlmIChlLm5hbWUgPT09ICdOb1N1Y2hFbnRpdHknKSB7XG4gICAgICAgIC8vIG5vb3AsIHByb2NlZWQgd2l0aCBjcmVhdGluZyB0aGUgcG9saWN5XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHBvbGljeURvYyA9IHtcbiAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgIFN0YXRlbWVudDogW1xuICAgICAgICB7XG4gICAgICAgICAgQWN0aW9uOiBbJyonXSxcbiAgICAgICAgICBSZXNvdXJjZTogJyonLFxuICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICBTaWQ6ICdFeHBsaWNpdEFsbG93QWxsJyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIENvbmRpdGlvbjoge1xuICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAgICdpYW06UGVybWlzc2lvbnNCb3VuZGFyeSc6IGBhcm46JHtwYXJ0aXRpb259OmlhbTo6JHthY2NvdW50fTpwb2xpY3kvY2RrLSR7cXVhbGlmaWVyfS1wZXJtaXNzaW9ucy1ib3VuZGFyeWAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgQWN0aW9uOiBbXG4gICAgICAgICAgICAnaWFtOkNyZWF0ZVVzZXInLFxuICAgICAgICAgICAgJ2lhbTpDcmVhdGVSb2xlJyxcbiAgICAgICAgICAgICdpYW06UHV0Um9sZVBlcm1pc3Npb25zQm91bmRhcnknLFxuICAgICAgICAgICAgJ2lhbTpQdXRVc2VyUGVybWlzc2lvbnNCb3VuZGFyeScsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBSZXNvdXJjZTogJyonLFxuICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICBTaWQ6ICdEZW55QWNjZXNzSWZSZXF1aXJlZFBlcm1Cb3VuZGFyeUlzTm90QmVpbmdBcHBsaWVkJyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIEFjdGlvbjogW1xuICAgICAgICAgICAgJ2lhbTpDcmVhdGVQb2xpY3lWZXJzaW9uJyxcbiAgICAgICAgICAgICdpYW06RGVsZXRlUG9saWN5JyxcbiAgICAgICAgICAgICdpYW06RGVsZXRlUG9saWN5VmVyc2lvbicsXG4gICAgICAgICAgICAnaWFtOlNldERlZmF1bHRQb2xpY3lWZXJzaW9uJyxcbiAgICAgICAgICBdLFxuICAgICAgICAgIFJlc291cmNlOiBgYXJuOiR7cGFydGl0aW9ufTppYW06OiR7YWNjb3VudH06cG9saWN5L2Nkay0ke3F1YWxpZmllcn0tcGVybWlzc2lvbnMtYm91bmRhcnlgLFxuICAgICAgICAgIEVmZmVjdDogJ0RlbnknLFxuICAgICAgICAgIFNpZDogJ0RlbnlQZXJtQm91bmRhcnlJQU1Qb2xpY3lBbHRlcmF0aW9uJyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIEFjdGlvbjogWydpYW06RGVsZXRlVXNlclBlcm1pc3Npb25zQm91bmRhcnknLCAnaWFtOkRlbGV0ZVJvbGVQZXJtaXNzaW9uc0JvdW5kYXJ5J10sXG4gICAgICAgICAgUmVzb3VyY2U6ICcqJyxcbiAgICAgICAgICBFZmZlY3Q6ICdEZW55JyxcbiAgICAgICAgICBTaWQ6ICdEZW55UmVtb3ZhbE9mUGVybUJvdW5kYXJ5RnJvbUFueVVzZXJPclJvbGUnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBQb2xpY3lOYW1lOiBwb2xpY3lOYW1lLFxuICAgICAgUG9saWN5RG9jdW1lbnQ6IEpTT04uc3RyaW5naWZ5KHBvbGljeURvYyksXG4gICAgfTtcbiAgICBjb25zdCBjcmVhdGVQb2xpY3lSZXNwb25zZSA9IGF3YWl0IGlhbS5jcmVhdGVQb2xpY3kocmVxdWVzdCk7XG4gICAgaWYgKGNyZWF0ZVBvbGljeVJlc3BvbnNlLlBvbGljeT8uQXJuKSB7XG4gICAgICByZXR1cm4gY3JlYXRlUG9saWN5UmVzcG9uc2UuUG9saWN5LkFybjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgQ291bGQgbm90IHJldHJpZXZlIHRoZSBleGFtcGxlIHBlcm1pc3Npb24gYm91bmRhcnkgJHthcm59IWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVQb2xpY3lOYW1lKHBlcm1pc3Npb25zQm91bmRhcnk6IHN0cmluZykge1xuICAgIC8vIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9JQU0vbGF0ZXN0L0FQSVJlZmVyZW5jZS9BUElfQ3JlYXRlUG9saWN5Lmh0bWxcbiAgICAvLyBBZGRlZCBzdXBwb3J0IGZvciBwb2xpY3kgbmFtZXMgd2l0aCBhIHBhdGhcbiAgICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL2lzc3Vlcy8yNjMyMFxuICAgIGNvbnN0IHJlZ2V4cDogUmVnRXhwID0gL1tcXHcrXFwvPSwuQC1dKy87XG4gICAgY29uc3QgbWF0Y2hlcyA9IHJlZ2V4cC5leGVjKHBlcm1pc3Npb25zQm91bmRhcnkpO1xuICAgIGlmICghKG1hdGNoZXMgJiYgbWF0Y2hlcy5sZW5ndGggPT09IDEgJiYgbWF0Y2hlc1swXSA9PT0gcGVybWlzc2lvbnNCb3VuZGFyeSkpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYFRoZSBwZXJtaXNzaW9ucyBib3VuZGFyeSBuYW1lICR7cGVybWlzc2lvbnNCb3VuZGFyeX0gZG9lcyBub3QgbWF0Y2ggdGhlIElBTSBjb252ZW50aW9ucy5gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGN1c3RvbUJvb3RzdHJhcChcbiAgICBlbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQsXG4gICAgc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyLFxuICAgIG9wdGlvbnM6IEJvb3RzdHJhcEVudmlyb25tZW50T3B0aW9ucyA9IHt9LFxuICApOiBQcm9taXNlPFN1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdD4ge1xuICAgIC8vIExvb2sgYXQgdGhlIHRlbXBsYXRlLCBkZWNpZGUgd2hldGhlciBpdCdzIG1vc3QgbGlrZWx5IGEgbGVnYWN5IG9yIG1vZGVybiBib290c3RyYXBcbiAgICAvLyB0ZW1wbGF0ZSwgYW5kIHVzZSB0aGUgcmlnaHQgYm9vdHN0cmFwcGVyIGZvciB0aGF0LlxuICAgIGNvbnN0IHZlcnNpb24gPSBib290c3RyYXBWZXJzaW9uRnJvbVRlbXBsYXRlKGF3YWl0IHRoaXMubG9hZFRlbXBsYXRlKCkpO1xuICAgIGlmICh2ZXJzaW9uID09PSAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5sZWdhY3lCb290c3RyYXAoZW52aXJvbm1lbnQsIHNka1Byb3ZpZGVyLCBvcHRpb25zKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMubW9kZXJuQm9vdHN0cmFwKGVudmlyb25tZW50LCBzZGtQcm92aWRlciwgb3B0aW9ucyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkVGVtcGxhdGUocGFyYW1zOiBCb290c3RyYXBwaW5nUGFyYW1ldGVycyA9IHt9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBzd2l0Y2ggKHRoaXMuc291cmNlLnNvdXJjZSkge1xuICAgICAgY2FzZSAnY3VzdG9tJzpcbiAgICAgICAgcmV0dXJuIGxvYWRTdHJ1Y3R1cmVkRmlsZSh0aGlzLnNvdXJjZS50ZW1wbGF0ZUZpbGUpO1xuICAgICAgY2FzZSAnZGVmYXVsdCc6XG4gICAgICAgIHJldHVybiBsb2FkU3RydWN0dXJlZEZpbGUocGF0aC5qb2luKGJ1bmRsZWRQYWNrYWdlUm9vdERpcihfX2Rpcm5hbWUpLCAnbGliJywgJ2FwaScsICdib290c3RyYXAnLCAnYm9vdHN0cmFwLXRlbXBsYXRlLnlhbWwnKSk7XG4gICAgICBjYXNlICdsZWdhY3knOlxuICAgICAgICByZXR1cm4gbGVnYWN5Qm9vdHN0cmFwVGVtcGxhdGUocGFyYW1zKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBNYWdpYyBwYXJhbWV0ZXIgdmFsdWUgdGhhdCB3aWxsIGNhdXNlIHRoZSBib290c3RyYXAtdGVtcGxhdGUueW1sIHRvIE5PVCBjcmVhdGUgYSBDTUsgYnV0IHVzZSB0aGUgZGVmYXVsdCBrZXlcbiAqL1xuY29uc3QgVVNFX0FXU19NQU5BR0VEX0tFWSA9ICdBV1NfTUFOQUdFRF9LRVknO1xuXG4vKipcbiAqIE1hZ2ljIHBhcmFtZXRlciB2YWx1ZSB0aGF0IHdpbGwgY2F1c2UgdGhlIGJvb3RzdHJhcC10ZW1wbGF0ZS55bWwgdG8gY3JlYXRlIGEgQ01LXG4gKi9cbmNvbnN0IENSRUFURV9ORVdfS0VZID0gJyc7XG4vKipcbiAqIFBhcmFtZXRlciB2YWx1ZSBpbmRpY2F0aW5nIHRoZSB1c2Ugb2YgdGhlIGRlZmF1bHQsIENESyBwcm92aWRlZCBwZXJtaXNzaW9ucyBib3VuZGFyeSBmb3IgYm9vdHN0cmFwLXRlbXBsYXRlLnltbFxuICovXG5jb25zdCBDREtfQk9PVFNUUkFQX1BFUk1JU1NJT05TX0JPVU5EQVJZID0gJ0NES19CT09UU1RSQVBfUEVSTUlTU0lPTlNfQk9VTkRBUlknO1xuXG4vKipcbiAqIFNwbGl0IGFuIGFycmF5LWxpa2UgQ2xvdWRGb3JtYXRpb24gcGFyYW1ldGVyIG9uICxcbiAqXG4gKiBBbiBlbXB0eSBzdHJpbmcgaXMgdGhlIGVtcHR5IGFycmF5IChpbnN0ZWFkIG9mIGBbJyddYCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0Q2ZuQXJyYXkoeHM6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZ1tdIHtcbiAgaWYgKHhzID09PSAnJyB8fCB4cyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIHJldHVybiB4cy5zcGxpdCgnLCcpO1xufVxuXG5mdW5jdGlvbiBpbnRlcnNlY3Rpb248QT4oeHM6IFNldDxBPiwgeXM6IFNldDxBPik6IFNldDxBPiB7XG4gIHJldHVybiBuZXcgU2V0PEE+KEFycmF5LmZyb20oeHMpLmZpbHRlcih4ID0+IHlzLmhhcyh4KSkpO1xufVxuIl19