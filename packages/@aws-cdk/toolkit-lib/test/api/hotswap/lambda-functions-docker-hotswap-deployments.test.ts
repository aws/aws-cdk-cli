// import { UpdateResourceCommand } from '@aws-sdk/client-cloudcontrol';
// import { HotswapMode } from '../../../lib/api/hotswap';
// import { mockCloudControlClient } from '../../_helpers/mock-sdk';
// import * as setup from '../_helpers/hotswap-test-setup';

test('dummy', () => {
});

// let hotswapMockSdkProvider: setup.HotswapMockSdkProvider;

// beforeEach(() => {
//   hotswapMockSdkProvider = setup.setupHotswapTests();
// });

// describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
//   test(
//     'calls the updateLambdaCode() API when it receives only a code difference in a Lambda function',
//     async () => {
//       // GIVEN
//       setup.setCurrentCfnStackTemplate({
//         Resources: {
//           Func: {
//             Type: 'AWS::Lambda::Function',
//             Properties: {
//               Code: {
//                 ImageUri: 'current-image',
//               },
//               FunctionName: 'my-function',
//             },
//             Metadata: {
//               'aws:asset:path': 'old-path',
//             },
//           },
//         },
//       });
//       const cdkStackArtifact = setup.cdkStackArtifactOf({
//         template: {
//           Resources: {
//             Func: {
//               Type: 'AWS::Lambda::Function',
//               Properties: {
//                 Code: {
//                   ImageUri: 'new-image',
//                 },
//                 FunctionName: 'my-function',
//               },
//               Metadata: {
//                 'aws:asset:path': 'new-path',
//               },
//             },
//           },
//         },
//       });

//       // WHEN
//       const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

//       // THEN
//       expect(deployStackResult).not.toBeUndefined();
//       expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
//         TypeName: 'AWS::Lambda::Function',
//         Identifier: 'my-function',
//         PatchDocument: JSON.stringify([{ op: 'add', path: '/Code/ImageUri', value: 'new-image' }]),
//       });
//     },
//   );
// });
