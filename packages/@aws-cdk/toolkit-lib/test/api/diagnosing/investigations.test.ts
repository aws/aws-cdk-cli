import { DEPLOY_INVESTIGATIONS, DIAGNOSE_INVESTIGATIONS, resolveInvestigations } from '../../../lib/api/diagnosing/investigations';

test('without overrides, the defaults apply', () => {
  expect(resolveInvestigations(DEPLOY_INVESTIGATIONS)).toEqual({ cloudTrail: false, customResources: true, ecs: true, hooks: false });
  expect(resolveInvestigations(DIAGNOSE_INVESTIGATIONS)).toEqual({ cloudTrail: true, customResources: true, ecs: true, hooks: true });
});

test('set overrides replace defaults; unset ones keep them', () => {
  expect(resolveInvestigations(DEPLOY_INVESTIGATIONS, { cloudTrail: true, ecs: false })).toEqual({
    cloudTrail: true,
    customResources: true,
    ecs: false,
    hooks: false,
  });
});

test('an explicitly undefined override keeps the default', () => {
  expect(resolveInvestigations(DIAGNOSE_INVESTIGATIONS, { hooks: undefined }).hooks).toBe(true);
});
