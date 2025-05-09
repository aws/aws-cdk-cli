import type { AssemblyManifest } from '@aws-cdk/cloud-assembly-schema';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import type { ResourceLocation as CfnResourceLocation } from '@aws-sdk/client-cloudformation';
import type { ResourceLocation } from './cloudformation';

export interface ExcludeList {
  isExcluded(location: ResourceLocation): boolean;
}

export class ManifestExcludeList implements ExcludeList {
  private readonly excludedLocations: CfnResourceLocation[];

  constructor(manifest: AssemblyManifest) {
    this.excludedLocations = this.getExcludedLocations(manifest);
  }

  private getExcludedLocations(asmManifest: AssemblyManifest): CfnResourceLocation[] {
    // First, we need to filter the artifacts to only include CloudFormation stacks
    const stackManifests = Object.entries(asmManifest.artifacts ?? {}).filter(
      ([_, manifest]) => manifest.type === ArtifactType.AWS_CLOUDFORMATION_STACK,
    );

    const result: CfnResourceLocation[] = [];
    for (let [stackName, manifest] of stackManifests) {
      const locations = Object.values(manifest.metadata ?? {})
        // Then pick only the resources in each stack marked with DO_NOT_REFACTOR
        .filter((entries) =>
          entries.some((entry) => entry.type === ArtifactMetadataEntryType.DO_NOT_REFACTOR && entry.data === true),
        )
        // Finally, get the logical ID of each resource
        .map((entries) => {
          const logicalIdEntry = entries.find((entry) => entry.type === ArtifactMetadataEntryType.LOGICAL_ID);
          const location: CfnResourceLocation = {
            StackName: stackName,
            LogicalResourceId: logicalIdEntry!.data! as string,
          };
          return location;
        });
      result.push(...locations);
    }
    return result;
  }

  isExcluded(location: ResourceLocation): boolean {
    return this.excludedLocations.some(
      (loc) => loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId,
    );
  }
}

export class InMemoryExcludeList implements ExcludeList {
  private readonly excludedLocations: CfnResourceLocation[];
  private readonly excludedPaths: string[];

  constructor(items: string[]) {
    this.excludedLocations = [];
    this.excludedPaths = [];

    if (items.length === 0) {
      return;
    }

    const locationRegex = /^[A-Za-z0-9]+\.[A-Za-z0-9]+$/;

    items.forEach((item: string) => {
      if (locationRegex.test(item)) {
        const [stackName, logicalId] = item.split('.');
        this.excludedLocations.push({
          StackName: stackName,
          LogicalResourceId: logicalId,
        });
      } else {
        this.excludedPaths.push(item);
      }
    });
  }

  isExcluded(location: ResourceLocation): boolean {
    const containsLocation = this.excludedLocations.some((loc) => {
      return loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId;
    });

    const containsPath = this.excludedPaths.some((path) => location.toPath() === path);
    return containsLocation || containsPath;
  }
}

export class UnionExcludeList implements ExcludeList {
  constructor(private readonly excludeLists: ExcludeList[]) {
  }

  isExcluded(location: ResourceLocation): boolean {
    return this.excludeLists.some((excludeList) => excludeList.isExcluded(location));
  }
}

export class NeverExclude implements ExcludeList {
  isExcluded(_location: ResourceLocation): boolean {
    return false;
  }
}

export class AlwaysExclude implements ExcludeList {
  isExcluded(_location: ResourceLocation): boolean {
    return true;
  }
}

/**
 * Unsupported types for refactoring according to
 * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-refactoring.html
 */
export class UnsupportedTypes implements ExcludeList {
  private static readonly TYPES = [
    'AWS::ACMPCA::Certificate',
    'AWS::ACMPCA::CertificateAuthority',
    'AWS::ACMPCA::CertificateAuthorityActivation',
    'AWS::ApiGateway::BasePathMapping',
    'AWS::ApiGateway::Method',
    'AWS::AppConfig::ConfigurationProfile',
    'AWS::AppConfig::Deployment',
    'AWS::AppConfig::Environment',
    'AWS::AppConfig::Extension',
    'AWS::AppConfig::ExtensionAssociation',
    'AWS::AppStream::DirectoryConfig',
    'AWS::AppStream::StackFleetAssociation',
    'AWS::AppStream::StackUserAssociation',
    'AWS::AppStream::User',
    'AWS::BackupGateway::Hypervisor',
    'AWS::CodePipeline::CustomActionType',
    'AWS::Cognito::UserPoolRiskConfigurationAttachment',
    'AWS::Cognito::UserPoolUICustomizationAttachment',
    'AWS::Cognito::UserPoolUserToGroupAttachment',
    'AWS::Config::ConfigRule',
    'AWS::DataBrew::Dataset',
    'AWS::DataBrew::Job',
    'AWS::DataBrew::Project',
    'AWS::DataBrew::Recipe',
    'AWS::DataBrew::Ruleset',
    'AWS::DataBrew::Schedule',
    'AWS::DataZone::DataSource',
    'AWS::DataZone::Environment',
    'AWS::DataZone::EnvironmentBlueprintConfiguration',
    'AWS::DataZone::EnvironmentProfile',
    'AWS::DataZone::Project',
    'AWS::DataZone::SubscriptionTarget',
    'AWS::DynamoDB::GlobalTable',
    'AWS::EC2::LaunchTemplate',
    'AWS::EC2::SpotFleet',
    'AWS::EC2::VolumeAttachment',
    'AWS::EC2::VPCDHCPOptionsAssociation',
    'AWS::ElasticBeanstalk::ConfigurationTemplate',
    'AWS::FIS::ExperimentTemplate',
    'AWS::Glue::Schema',
    'AWS::GuardDuty::IPSet',
    'AWS::GuardDuty::PublishingDestination',
    'AWS::GuardDuty::ThreatIntelSet',
    'AWS::ImageBuilder::Component',
    'AWS::IoTFleetWise::Campaign',
    'AWS::IoTWireless::WirelessDeviceImportTask',
    'AWS::Lambda::EventInvokeConfig',
    'AWS::Lex::BotVersion',
    'AWS::M2::Application',
    'AWS::Maester::DocumentType',
    'AWS::MediaTailor::Channel',
    'AWS::MSK::Configuration',
    'AWS::MSK::ServerlessCluster',
    'AWS::NeptuneGraph::PrivateGraphEndpoint',
    'AWS::Omics::AnnotationStore',
    'AWS::Omics::ReferenceStore',
    'AWS::Omics::SequenceStore',
    'AWS::OpenSearchServerless::Collection',
    'AWS::Panorama::PackageVersion',
    'AWS::PCAConnectorAD::Connector',
    'AWS::PCAConnectorAD::DirectoryRegistration',
    'AWS::PCAConnectorAD::Template',
    'AWS::PCAConnectorAD::TemplateGroupAccessControlEntry',
    'AWS::QuickSight::Theme',
    'AWS::RefactorSpaces::Environment',
    'AWS::RefactorSpaces::Route',
    'AWS::RefactorSpaces::Service',
    'AWS::RoboMaker::RobotApplication',
    'AWS::RoboMaker::SimulationApplication',
    'AWS::SageMaker::InferenceComponen',
    'AWS::ServiceCatalog::PortfolioPrincipalAssociation',
    'AWS::ServiceCatalog::PortfolioProductAssociation',
    'AWS::ServiceCatalog::PortfolioShare',
    'AWS::ServiceCatalog::TagOptionAssociation',
    'AWS::ServiceCatalogAppRegistry::AttributeGroupAssociation',
    'AWS::ServiceCatalogAppRegistry::ResourceAssociation',
    'AWS::StepFunctions::StateMachineVersion',
    'AWS::Synthetics::Canary',
    'AWS::VoiceID::Domain',
    'AWS::WAFv2::IPSet',
    'AWS::WAFv2::RegexPatternSet',
    'AWS::WAFv2::RuleGroup',
    'AWS::WAFv2::WebACL',
  ];

  isExcluded(location: ResourceLocation): boolean {
    return UnsupportedTypes.TYPES.includes(location.getType());
  }
}

export function fromManifestAndExclusionList(manifest: AssemblyManifest, exclude?: string[]): ExcludeList {
  return new UnionExcludeList([new ManifestExcludeList(manifest), new InMemoryExcludeList(exclude ?? [])]);
}
