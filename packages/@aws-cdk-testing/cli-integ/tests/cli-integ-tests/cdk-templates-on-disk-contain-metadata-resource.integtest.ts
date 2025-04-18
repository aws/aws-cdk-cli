import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'templates on disk contain metadata resource, also in nested assemblies',
  withDefaultFixture(async (fixture) => {
    // Synth first, and switch on version reporting because cdk.json is disabling it
    await fixture.cdk(['synth', '--version-reporting=true']);

    // Load template from disk from root assembly
    const templateContents = await fixture.shell(['cat', 'cdk.out/*-lambda.template.json']);

    expect(JSON.parse(templateContents).Resources.CDKMetadata).toBeTruthy();

    // Load template from nested assembly
    const nestedTemplateContents = await fixture.shell([
      'cat',
      'cdk.out/assembly-*-stage/*StackInStage*.template.json',
    ]);

    expect(JSON.parse(nestedTemplateContents).Resources.CDKMetadata).toBeTruthy();
  }),
);

