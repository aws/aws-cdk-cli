import { parseInvestigations } from '../../../lib/cli/util/investigations';

test('no value leaves every investigation at its default', () => {
  expect(parseInvestigations(undefined)).toBeUndefined();
});

test('a name enables an investigation and no-<name> disables it', () => {
  expect(parseInvestigations(['cloudtrail', 'no-ecs'])).toEqual({ cloudTrail: true, ecs: false });
});

test('accepts comma-separated values', () => {
  expect(parseInvestigations(['cloudtrail,no-ecs', 'hooks'])).toEqual({ cloudTrail: true, ecs: false, hooks: true });
});

test('all and none set every investigation, and later values win', () => {
  expect(parseInvestigations(['none', 'custom-resources'])).toEqual({
    cloudTrail: false,
    customResources: true,
    ecs: false,
    hooks: false,
  });
  expect(parseInvestigations(['all', 'no-cloudtrail'])).toEqual({
    cloudTrail: false,
    customResources: true,
    ecs: true,
    hooks: true,
  });
});

test.each([['cloud-trail'], ['no-'], ['NONE']])('rejects unknown investigation %p', (value) => {
  expect(() => parseInvestigations([value])).toThrow(/unknown investigation/);
});

test.each([['cloudtrail'], [true], [['cloudtrail', 1]]])('rejects a setting that is not a list of strings: %p', (value) => {
  expect(() => parseInvestigations(value)).toThrow(/must be a list of strings/);
});
