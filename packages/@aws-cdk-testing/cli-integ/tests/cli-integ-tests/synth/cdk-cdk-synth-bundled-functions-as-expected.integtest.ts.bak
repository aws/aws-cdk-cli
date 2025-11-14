import { existsSync } from 'fs';
import * as path from 'path';
import { integTest, withSamIntegrationFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'CDK synth bundled functions as expected',
  withSamIntegrationFixture(async (fixture) => {
    // Synth first
    await fixture.cdkSynth();

    const template = fixture.template('TestStack');

    const expectedBundledAssets = [
      {
        // Python Layer Version
        id: 'PythonLayerVersion39495CEF',
        files: [
          'python/layer_version_dependency.py',
          'python/geonamescache/__init__.py',
          'python/geonamescache-1.3.0.dist-info',
        ],
      },
      {
        // Layer Version
        id: 'LayerVersion3878DA3A',
        files: ['layer_version_dependency.py', 'requirements.txt'],
      },
      {
        // Bundled layer version
        id: 'BundledLayerVersionPythonRuntime6BADBD6E',
        files: [
          'python/layer_version_dependency.py',
          'python/geonamescache/__init__.py',
          'python/geonamescache-1.3.0.dist-info',
        ],
      },
      {
        // Python Function
        id: 'PythonFunction0BCF77FD',
        files: ['app.py', 'geonamescache/__init__.py', 'geonamescache-1.3.0.dist-info'],
      },
      {
        // Function
        id: 'FunctionPythonRuntime28CBDA05',
        files: ['app.py', 'requirements.txt'],
      },
      {
        // Bundled Function
        id: 'BundledFunctionPythonRuntime4D9A0918',
        files: ['app.py', 'geonamescache/__init__.py', 'geonamescache-1.3.0.dist-info'],
      },
      {
        // NodeJs Function
        id: 'NodejsFunction09C1F20F',
        files: ['index.js'],
      },
      {
        // Go Function
        id: 'GoFunctionCA95FBAA',
        files: ['bootstrap'],
      },
      {
        // Docker Image Function
        id: 'DockerImageFunction28B773E6',
        files: ['app.js', 'Dockerfile', 'package.json'],
      },
    ];

    for (const resource of expectedBundledAssets) {
      const assetPath = template.Resources[resource.id].Metadata['aws:asset:path'];
      for (const file of resource.files) {
        fixture.output.write(`validate Path ${file} for resource ${resource}`);
        expect(existsSync(path.join(fixture.integTestDir, 'cdk.out', assetPath, file))).toBeTruthy();
      }
    }
  }),
);

