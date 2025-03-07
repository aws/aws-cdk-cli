import { isMessageRelevantForLevel } from '../../../src/api/io/private/level-priority';

describe('IoMessageLevel', () => {
  test.each`
		msgLevel    | logLevel   | isRelevant
		${'error'}  | ${'trace'} | ${true}
		${'info'}   | ${'trace'} | ${true}
		${'result'} | ${'warn'}  | ${true}
		${'info'}   | ${'warn'}  | ${false}
		${'trace'}  | ${'error'} | ${false}
		${'warn'} | ${'result'}  | ${false}
	`('with msgLevel=$msgLevel and logLevel=$msgLevel, logging should be $shouldLog', async ({ msgLevel, logLevel, isRelevant }) => {
    expect(isMessageRelevantForLevel({ level: msgLevel }, logLevel)).toBe(isRelevant);
  });
});
