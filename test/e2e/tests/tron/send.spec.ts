import { Suite } from 'mocha';
import { EXPECTED_TRON_ADDRESSES_BY_INDEX } from '../../constants';
import FixtureBuilderV2 from '../../fixtures/fixture-builder-v2';
import { createSharedTronFixture } from '../../helpers/tron/shared-tron-fixture';
import {
  confirmTronSendAndAssertActivity,
  landOnTronSendScreenForAccount,
  prepareSharedTronSendSuite,
} from '../../page-objects/flows/tron-send.flow';
import { TronNode } from '../../seeder/tron/node';
import {
  TRON_LOW_TRX_WITH_USDT_ACCOUNT,
  TRON_PORTFOLIO_ACCOUNT,
} from './fixtures/environments';
import type { TronFixtureAccount } from './fixtures/with-tron-fixtures';
import { TRON_CHAIN_ID, TRON_RECIPIENT_ADDRESS } from './mocks/common-tron';

const TRON_SEND_FEE_BUFFER_IN_SUN = 1_000_000;
const TRON_SHARED_SEND_TRX_BALANCE_IN_SUN = 12_000_000;
const TRON_SHARED_SEND_USDT_BALANCE = '3804595';
const TRON_USDT_FULL_SEND_AMOUNT = '2804595';

function buildTronAccounts(
  profiles: readonly TronFixtureAccount[],
): TronFixtureAccount[] {
  return profiles.map((profile, index) => ({
    ...profile,
    address: EXPECTED_TRON_ADDRESSES_BY_INDEX[index],
    assets: profile.assets?.map((asset) => ({ ...asset })),
  }));
}

const TRON_SHARED_SUCCESS_ACCOUNT: TronFixtureAccount = {
  address: EXPECTED_TRON_ADDRESSES_BY_INDEX[0],
  assets: TRON_LOW_TRX_WITH_USDT_ACCOUNT.assets?.map((asset) => {
    if (asset.type === 'native') {
      return { ...asset, balance: TRON_SHARED_SEND_TRX_BALANCE_IN_SUN };
    }
    return { ...asset, balance: TRON_SHARED_SEND_USDT_BALANCE };
  }),
};

const TRON_LOW_FEE_ACCOUNT = buildTronAccounts([
  TRON_LOW_TRX_WITH_USDT_ACCOUNT,
]);

const TRON_NATIVE_BALANCE_PROFILE: TronFixtureAccount = {
  ...TRON_PORTFOLIO_ACCOUNT,
  assets: TRON_PORTFOLIO_ACCOUNT.assets?.filter(
    (asset) => asset.type === 'native',
  ),
};

const TRON_SEND_VALIDATION_ACCOUNTS = buildTronAccounts([
  TRON_NATIVE_BALANCE_PROFILE,
  TRON_NATIVE_BALANCE_PROFILE,
  TRON_NATIVE_BALANCE_PROFILE,
]);

function formatSunAmount(amountInSun: number): string {
  const whole = Math.floor(amountInSun / 1_000_000);
  const fraction = String(amountInSun % 1_000_000).padStart(6, '0');
  return `${whole}.${fraction}`.replace(/\.?0+$/u, '');
}

function getTronTrc20AssetId(
  localNodes: unknown[],
  symbol: 'USDT' | 'USDD' | 'HTX' | 'SEED',
): string {
  const token = getTronNode(localNodes).trc20Tokens[symbol];
  if (!token) {
    throw new Error(`Seeded ${symbol} token was not found on the Tron node`);
  }
  return `${TRON_CHAIN_ID}/trc20:${token.address}`;
}

function getTronNode(localNodes: unknown[]): TronNode {
  const tronNode = localNodes.find(
    (node): node is TronNode => node instanceof TronNode,
  );
  if (!tronNode) {
    throw new Error('Tron local node was not started');
  }
  return tronNode;
}

describe('Tron Send', function (this: Suite) {
  this.timeout(360_000);

  describe('successful sends', function () {
    const sharedTronFixture = createSharedTronFixture({
      accounts: [TRON_SHARED_SUCCESS_ACCOUNT],
      fixtures: new FixtureBuilderV2().build(),
      includeAnvil: false,
      title: 'Tron Send - successful sends',
    });

    before('Start shared successful-send fixture', async function () {
      const { driver } = await sharedTronFixture.start();
      await prepareSharedTronSendSuite({
        driver,
        totalAccounts: 1,
      });
    });

    after('Stop shared successful-send fixture', async function () {
      await sharedTronFixture.stop();
    });

    it('sends part of USDT balance and shows it pending then confirmed', async function () {
      const { driver, localNodes } = sharedTronFixture.getContext();
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 1',
        assetId: getTronTrc20AssetId(localNodes, 'USDT'),
        driver,
        expectedNativeBalance: '12',
        expectedTokenBalance: '3.805',
        symbol: 'USDT',
      });
      await sendPage.fillRecipient({
        recipientAddress: TRON_RECIPIENT_ADDRESS,
      });
      await sendPage.fillAmount('1');
      await sendPage.waitForSendAmountBalance();
      await sendPage.pressContinueButton();

      await confirmTronSendAndAssertActivity({
        driver,
        expectedAmount: '-1 USDT',
        expectedConfirmedTransactions: 1,
      });
      getTronNode(localNodes).recordTrc20Balance(
        TRON_SHARED_SUCCESS_ACCOUNT.address,
        'USDT',
        TRON_USDT_FULL_SEND_AMOUNT,
      );
    });

    it('sends total USDT balance via manual full-amount entry', async function () {
      const { driver, localNodes } = sharedTronFixture.getContext();
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 1',
        assetId: getTronTrc20AssetId(localNodes, 'USDT'),
        driver,
        expectedNativeBalance: null,
        symbol: 'USDT',
      });
      await sendPage.fillRecipient({
        recipientAddress: TRON_RECIPIENT_ADDRESS,
      });
      await sendPage.fillAmount('2.804595');
      await sendPage.waitForSendAmountBalance();
      await sendPage.pressContinueButton();

      await confirmTronSendAndAssertActivity({
        driver,
        expectedConfirmedTransactions: 2,
      });
    });

    it('sends part of TRX balance and shows it pending then confirmed', async function () {
      const { driver } = sharedTronFixture.getContext();
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 1',
        driver,
        expectedNativeBalance: null,
        symbol: 'TRX',
      });
      await sendPage.fillRecipient({
        recipientAddress: TRON_RECIPIENT_ADDRESS,
      });
      await sendPage.fillAmount('1');
      await sendPage.pressContinueButton();

      await confirmTronSendAndAssertActivity({
        driver,
        expectedAmount: '-1 TRX',
        expectedConfirmedTransactions: 3,
      });
    });

    it('sends fee-buffered TRX balance via manual full-amount entry', async function () {
      const { driver, localNodes } = sharedTronFixture.getContext();
      const nativeBalanceInSun = await getTronNode(localNodes).getNativeBalance(
        TRON_SHARED_SUCCESS_ACCOUNT.address,
      );
      const sendAmountInSun = nativeBalanceInSun - TRON_SEND_FEE_BUFFER_IN_SUN;
      if (sendAmountInSun <= 0) {
        throw new Error(
          `Expected more than ${TRON_SEND_FEE_BUFFER_IN_SUN} sun before the final TRX send, got ${nativeBalanceInSun}`,
        );
      }
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 1',
        driver,
        expectedNativeBalance: null,
        symbol: 'TRX',
      });
      await sendPage.fillRecipient({
        recipientAddress: TRON_RECIPIENT_ADDRESS,
      });
      await sendPage.fillAmount(formatSunAmount(sendAmountInSun));
      await sendPage.pressContinueButton();

      await confirmTronSendAndAssertActivity({
        driver,
        expectedConfirmedTransactions: 4,
      });
    });
  });

  /* eslint-disable mocha/no-hooks-for-single-case -- this case requires an isolated low-balance chain state */
  describe('low-fee case', function () {
    const sharedTronFixture = createSharedTronFixture({
      accounts: TRON_LOW_FEE_ACCOUNT,
      fixtures: new FixtureBuilderV2().build(),
      includeAnvil: false,
      title: 'Tron Send - low-fee case',
    });

    before('Start low-fee fixture', async function () {
      const { driver } = await sharedTronFixture.start();
      await prepareSharedTronSendSuite({ driver, totalAccounts: 1 });
    });

    after('Stop low-fee fixture', async function () {
      await sharedTronFixture.stop();
    });

    it('blocks USDT send when TRX balance cannot cover energy fee', async function () {
      const { driver, localNodes } = sharedTronFixture.getContext();
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 1',
        assetId: getTronTrc20AssetId(localNodes, 'USDT'),
        driver,
        expectedNativeBalance: null,
        symbol: 'USDT',
      });
      await sendPage.fillRecipient({
        recipientAddress: TRON_RECIPIENT_ADDRESS,
      });
      await sendPage.fillAmount('1');
      // With 1 sun TRX, Continue builds the TRC20 transaction then fails fee cover.
      await sendPage.pressContinueButton();
      await sendPage.checkInsufficientBalanceToCoverFeesError();
      await sendPage.checkContinueButtonIsDisabled();
    });
  });
  /* eslint-enable mocha/no-hooks-for-single-case */

  describe('validation cases', function () {
    const sharedTronFixture = createSharedTronFixture({
      accounts: TRON_SEND_VALIDATION_ACCOUNTS,
      fixtures: new FixtureBuilderV2().build(),
      includeAnvil: false,
      title: 'Tron Send - validation cases',
    });

    before('Start shared validation fixture', async function () {
      const { driver } = await sharedTronFixture.start();
      await prepareSharedTronSendSuite({
        driver,
        totalAccounts: TRON_SEND_VALIDATION_ACCOUNTS.length,
      });
    });

    after('Stop shared validation fixture', async function () {
      await sharedTronFixture.stop();
    });

    it('blocks Continue when a bad address is entered', async function () {
      const { driver } = sharedTronFixture.getContext();
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 1',
        driver,
        symbol: 'TRX',
      });
      await sendPage.fillRecipient({
        recipientAddress: 'not-a-valid-address',
        // The formatted recipient element never renders for an invalid
        // address, so skip the post-paste re-render wait.
        validAddress: false,
      });
      await sendPage.checkInvalidAddressError();
      await sendPage.checkContinueButtonIsDisabled();
    });

    it('blocks Continue when amount is empty', async function () {
      const { driver } = sharedTronFixture.getContext();
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 2',
        driver,
        symbol: 'TRX',
      });
      await sendPage.fillRecipient({
        recipientAddress: TRON_RECIPIENT_ADDRESS,
      });
      // Empty amount leaves Continue enabled; Tron snap rejects on submit and
      // surfaces transactionError on the Continue button.
      await sendPage.pressContinueButton();
      await sendPage.checkTransactionError();
      await sendPage.checkContinueButtonIsDisabled();
    });

    it('blocks Continue when amount exceeds balance', async function () {
      const { driver } = sharedTronFixture.getContext();
      const sendPage = await landOnTronSendScreenForAccount({
        accountLabel: 'Account 3',
        driver,
        symbol: 'TRX',
      });
      await sendPage.fillRecipient({
        recipientAddress: TRON_RECIPIENT_ADDRESS,
      });
      await sendPage.fillAmount('999999');
      await sendPage.checkInsufficientFundsError();
      await sendPage.checkContinueButtonIsDisabled();
    });
  });
});
