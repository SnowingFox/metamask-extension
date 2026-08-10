import { TRON_ACCOUNT_ADDRESS } from '../tests/tron/mocks/common-tron';
import {
  GAS_FREE,
  HTX,
  SEED,
  TRX,
  USDD,
  USDT,
} from '../tests/tron/fixtures/tokens';
import { withFixtures } from '../helpers';
import { TronNode } from '../seeder/tron/node';
import {
  buildTronNodeOptions,
  withTronFixtures,
} from '../tests/tron/fixtures/with-tron-fixtures';

jest.mock('../helpers', () => ({
  withFixtures: jest.fn(),
}));

const withFixturesMock = jest.mocked(withFixtures);

describe('withTronFixtures', () => {
  beforeEach(() => {
    withFixturesMock.mockReset();
  });

  it('builds Tron local node options from explicit account assets', () => {
    expect(
      buildTronNodeOptions([
        {
          address: TRON_ACCOUNT_ADDRESS,
          assets: [
            { ...TRX, balance: 6_072_392, priceUsd: 0.29469 },
            { ...GAS_FREE, balance: '33333333', priceUsd: 0.000_000_001 },
            { ...HTX, balance: '3156454956836360132407885' },
            { ...SEED, balance: '89851311' },
            { ...USDD, balance: '289757448699320931' },
            { ...USDT, balance: '2804595', priceUsd: 0.999176 },
          ],
        },
      ]),
    ).toStrictEqual({
      initialBalances: {
        [TRON_ACCOUNT_ADDRESS]: 6_072_392,
      },
      trc10Balances: {
        [TRON_ACCOUNT_ADDRESS]: {
          GAS_FREE: '33333333',
        },
      },
      trc20Balances: {
        [TRON_ACCOUNT_ADDRESS]: {
          HTX: '3156454956836360132407885',
          SEED: '89851311',
          USDD: '289757448699320931',
          USDT: '2804595',
        },
      },
    });
  });

  it('exposes a borrowed Tron node without giving the fixture ownership', async () => {
    const borrowedTronNode = new TronNode();
    const afterLocalNodesStart = jest.fn();
    const testSuite = jest.fn();
    const withFixturesLocalNodes: unknown[] = [];

    withFixturesMock.mockImplementation(async (options, callback) => {
      const { afterLocalNodesStart: startLocalNodes } = options as {
        afterLocalNodesStart: (context: {
          localNodes: unknown[];
        }) => Promise<void>;
      };
      await startLocalNodes({
        localNodes: withFixturesLocalNodes,
      });
      await callback({ localNodes: withFixturesLocalNodes });
    });

    await withTronFixtures(
      {
        accounts: [{ address: TRON_ACCOUNT_ADDRESS }],
        afterLocalNodesStart,
        borrowedTronNode,
        includeAnvil: false,
      },
      testSuite,
    );

    expect(withFixturesMock).toHaveBeenCalledWith(
      expect.objectContaining({ localNodeOptions: ['none'] }),
      expect.any(Function),
    );
    expect(withFixturesLocalNodes).toStrictEqual([]);
    expect(afterLocalNodesStart).toHaveBeenCalledWith({
      localNodes: [borrowedTronNode],
    });
    expect(testSuite).toHaveBeenCalledWith(
      expect.objectContaining({ localNodes: [borrowedTronNode] }),
    );
  });
});
