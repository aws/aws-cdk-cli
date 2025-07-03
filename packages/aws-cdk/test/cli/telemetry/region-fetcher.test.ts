import { RegionFetcher } from '../../../lib/cli/telemetry/region-fetcher';

describe('RegionFetcher', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('fetches a valid region successfully', async () => {
    // GIVEN
    const mockRegion = jest.fn().mockResolvedValue('us-east-1');
    const mockStsClient = {
      config: {
        region: mockRegion,
      },
    } as any;

    const regionFetcher = new RegionFetcher(mockStsClient);

    // WHEN
    const region = await regionFetcher.fetch();

    // THEN
    expect(region).toBe('us-east-1');
    expect(mockRegion).toHaveBeenCalledTimes(1);
  });

  test('returns undefined when region fetching fails', async () => {
    // GIVEN
    const mockRegion = jest.fn().mockRejectedValue(new Error('Region fetch error'));
    const mockStsClient = {
      config: {
        region: mockRegion,
      },
    } as any;

    const regionFetcher = new RegionFetcher(mockStsClient);

    // WHEN
    const region = await regionFetcher.fetch();

    // THEN
    expect(region).toBeUndefined();
    expect(mockRegion).toHaveBeenCalledTimes(1);
  });
});
