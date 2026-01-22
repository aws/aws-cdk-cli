import { UpdateDataSetCommand, UpdateDataSourceCommand, UpdateDashboardCommand, UpdateAnalysisCommand, UpdateTemplateCommand } from '@aws-sdk/client-quicksight';
import { HotswapMode } from '../../../lib/api/hotswap';
import { mockQuickSightClient } from '../../_helpers/mock-sdk';
import * as setup from '../_helpers/hotswap-test-setup';

let hotswapMockSdkProvider: setup.HotswapMockSdkProvider;

beforeEach(() => {
  hotswapMockSdkProvider = setup.setupHotswapTests();
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
  test('returns undefined when a new QuickSight DataSet is added', async () => {
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          DataSet: {
            Type: 'AWS::QuickSight::DataSet',
          },
        },
      },
    });

    if (hotswapMode === HotswapMode.FALL_BACK) {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).toBeUndefined();
    } else {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).not.toBeUndefined();
      expect(deployStackResult?.noOp).toEqual(true);
    }
    expect(mockQuickSightClient).not.toHaveReceivedCommand(UpdateDataSetCommand);
  });

  test('calls updateDataSet when PhysicalTableMap changes', async () => {
    setup.setCurrentCfnStackTemplate({
      Resources: {
        DataSet: {
          Type: 'AWS::QuickSight::DataSet',
          Properties: {
            AwsAccountId: '123456789012',
            DataSetId: 'my-dataset',
            Name: 'MyDataSet',
            ImportMode: 'SPICE',
            PhysicalTableMap: { old: {} },
          },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          DataSet: {
            Type: 'AWS::QuickSight::DataSet',
            Properties: {
              AwsAccountId: '123456789012',
              DataSetId: 'my-dataset',
              Name: 'MyDataSet',
              ImportMode: 'SPICE',
              PhysicalTableMap: { new: {} },
            },
          },
        },
      },
    });

    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    expect(deployStackResult).not.toBeUndefined();
    expect(mockQuickSightClient).toHaveReceivedCommandWith(UpdateDataSetCommand, {
      AwsAccountId: '123456789012',
      DataSetId: 'my-dataset',
      Name: 'MyDataSet',
      PhysicalTableMap: { new: {} },
      ImportMode: 'SPICE',
    });
  });

  test('calls updateDataSource when DataSourceParameters changes', async () => {
    setup.setCurrentCfnStackTemplate({
      Resources: {
        DataSource: {
          Type: 'AWS::QuickSight::DataSource',
          Properties: {
            AwsAccountId: '123456789012',
            DataSourceId: 'my-datasource',
            Name: 'MyDataSource',
            DataSourceParameters: { old: {} },
          },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          DataSource: {
            Type: 'AWS::QuickSight::DataSource',
            Properties: {
              AwsAccountId: '123456789012',
              DataSourceId: 'my-datasource',
              Name: 'MyDataSource',
              DataSourceParameters: { new: {} },
            },
          },
        },
      },
    });

    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    expect(deployStackResult).not.toBeUndefined();
    expect(mockQuickSightClient).toHaveReceivedCommandWith(UpdateDataSourceCommand, {
      AwsAccountId: '123456789012',
      DataSourceId: 'my-datasource',
      Name: 'MyDataSource',
      DataSourceParameters: { new: {} },
    });
  });

  test('calls updateDashboard when Definition changes', async () => {
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Dashboard: {
          Type: 'AWS::QuickSight::Dashboard',
          Properties: {
            AwsAccountId: '123456789012',
            DashboardId: 'my-dashboard',
            Name: 'MyDashboard',
            Definition: { old: {} },
          },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Dashboard: {
            Type: 'AWS::QuickSight::Dashboard',
            Properties: {
              AwsAccountId: '123456789012',
              DashboardId: 'my-dashboard',
              Name: 'MyDashboard',
              Definition: { new: {} },
            },
          },
        },
      },
    });

    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    expect(deployStackResult).not.toBeUndefined();
    expect(mockQuickSightClient).toHaveReceivedCommandWith(UpdateDashboardCommand, {
      AwsAccountId: '123456789012',
      DashboardId: 'my-dashboard',
      Name: 'MyDashboard',
      Definition: { new: {} },
    });
  });

  test('calls updateAnalysis when Definition changes', async () => {
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Analysis: {
          Type: 'AWS::QuickSight::Analysis',
          Properties: {
            AwsAccountId: '123456789012',
            AnalysisId: 'my-analysis',
            Name: 'MyAnalysis',
            Definition: { old: {} },
          },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Analysis: {
            Type: 'AWS::QuickSight::Analysis',
            Properties: {
              AwsAccountId: '123456789012',
              AnalysisId: 'my-analysis',
              Name: 'MyAnalysis',
              Definition: { new: {} },
            },
          },
        },
      },
    });

    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    expect(deployStackResult).not.toBeUndefined();
    expect(mockQuickSightClient).toHaveReceivedCommandWith(UpdateAnalysisCommand, {
      AwsAccountId: '123456789012',
      AnalysisId: 'my-analysis',
      Name: 'MyAnalysis',
      Definition: { new: {} },
    });
  });

  test('calls updateTemplate when Definition changes', async () => {
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Template: {
          Type: 'AWS::QuickSight::Template',
          Properties: {
            AwsAccountId: '123456789012',
            TemplateId: 'my-template',
            Name: 'MyTemplate',
            Definition: { old: {} },
          },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Template: {
            Type: 'AWS::QuickSight::Template',
            Properties: {
              AwsAccountId: '123456789012',
              TemplateId: 'my-template',
              Name: 'MyTemplate',
              Definition: { new: {} },
            },
          },
        },
      },
    });

    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    expect(deployStackResult).not.toBeUndefined();
    expect(mockQuickSightClient).toHaveReceivedCommandWith(UpdateTemplateCommand, {
      AwsAccountId: '123456789012',
      TemplateId: 'my-template',
      Name: 'MyTemplate',
      Definition: { new: {} },
    });
  });

  test('does not hotswap when non-hotswappable property changes', async () => {
    setup.setCurrentCfnStackTemplate({
      Resources: {
        DataSet: {
          Type: 'AWS::QuickSight::DataSet',
          Properties: {
            AwsAccountId: '123456789012',
            DataSetId: 'my-dataset',
            Name: 'MyDataSet',
            ImportMode: 'SPICE',
          },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          DataSet: {
            Type: 'AWS::QuickSight::DataSet',
            Properties: {
              AwsAccountId: '123456789012',
              DataSetId: 'my-dataset',
              Name: 'MyDataSet',
              ImportMode: 'DIRECT_QUERY',
            },
          },
        },
      },
    });

    if (hotswapMode === HotswapMode.FALL_BACK) {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).toBeUndefined();
    } else {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).not.toBeUndefined();
      expect(deployStackResult?.noOp).toEqual(true);
    }
    expect(mockQuickSightClient).not.toHaveReceivedCommand(UpdateDataSetCommand);
  });
});
