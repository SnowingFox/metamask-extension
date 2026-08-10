import { Suite } from 'mocha';
import { EXPECTED_TRON_ADDRESSES_BY_INDEX } from '../../constants';
import FixtureBuilderV2 from '../../fixtures/fixture-builder-v2';
import { Driver } from '../../webdriver/driver';
import { TronNode } from '../../seeder/tron/node';
import { addMultipleAccounts } from '../../page-objects/flows/add-account.flow';
import { switchToAccount } from '../../page-objects/flows/account-list.flow';
import { login } from '../../page-objects/flows/login.flow';
import { selectTronNetwork } from '../../page-objects/flows/tron-network.flow';
import { waitUntilAccountTreeSyncIdle } from '../../page-objects/flows/tron-account-derivation.flow';
import { confirmTronSendAndAssertActivity } from '../../page-objects/flows/tron-send.flow';
import NonEvmHomepage from '../../page-objects/pages/home/non-evm-homepage';
import SendPage from '../../page-objects/pages/send/send-page';
import {
  TRON_LOW_TRX_WITH_USDT_ACCOUNT,
  TRON_PORTFOLIO_ACCOUNT,
  TRON_PORTFOLIO_TRX_BALANCE_IN_SUN,
} from './fixtures/environments';
import type { TronFixtureAccount } from './fixtures/with-tron-fixtures';
import { withTronFixtures } from './fixtures/with-tron-fixtures';
import { TRON_CHAIN_ID, TRON_RECIPIENT_ADDRESS } from './mocks/common-tron';

const TRON_SEND_FEE_BUFFER_IN_SUN = 1_000_000;

type TronFixtureContext = {
  driver: Driver;
  localNodes: unknown[];
};

function buildTronAccount(
  profile: TronFixtureAccount,
  index: number,
): TronFixtureAccount {
  return {
    ...profile,
    address: EXPECTED_TRON_ADDRESSES_BY_INDEX[index],
    assets: profile.assets?.map((asset) => ({ ...asset })),
  };
}

const TRON_BAD_ADDRESS_ACCOUNTS = [buildTronAccount(TRON_PORTFOLIO_ACCOUNT, 0)];
const TRON_EMPTY_AMOUNT_ACCOUNTS = [
  buildTronAccount(TRON_PORTFOLIO_ACCOUNT, 1),
];
const TRON_EXCESSIVE_AMOUNT_ACCOUNTS = [
  buildTronAccount(TRON_PORTFOLIO_ACCOUNT, 2),
];
const TRON_LOW_FEE_ACCOUNTS = [
  buildTronAccount(TRON_LOW_TRX_WITH_USDT_ACCOUNT, 3),
];
const TRON_PARTIAL_TRX_ACCOUNTS = [buildTronAccount(TRON_PORTFOLIO_ACCOUNT, 4)];
const TRON_FULL_TRX_ACCOUNTS = [buildTronAccount(TRON_PORTFOLIO_ACCOUNT, 5)];
const TRON_PARTIAL_USDT_ACCOUNTS = [
  buildTronAccount(TRON_PORTFOLIO_ACCOUNT, 6),
];
const TRON_FULL_USDT_ACCOUNTS = [buildTronAccount(TRON_PORTFOLIO_ACCOUNT, 7)];

const TRON_SEND_ACCOUNTS = [
  ...TRON_BAD_ADDRESS_ACCOUNTS,
  ...TRON_EMPTY_AMOUNT_ACCOUNTS,
  ...TRON_EXCESSIVE_AMOUNT_ACCOUNTS,
  ...TRON_LOW_FEE_ACCOUNTS,
  ...TRON_PARTIAL_TRX_ACCOUNTS,
  ...TRON_FULL_TRX_ACCOUNTS,
  ...TRON_PARTIAL_USDT_ACCOUNTS,
  ...TRON_FULL_USDT_ACCOUNTS,
];

const TRON_SEND_FIXTURES = new FixtureBuilderV2().build();

let resolveFixtureReady!: (context: TronFixtureContext) => void;
let rejectFixtureReady!: (error: unknown) => void;
const fixtureReady = new Promise<TronFixtureContext>((resolve, reject) => {
  resolveFixtureReady = resolve;
  rejectFixtureReady = reject;
});

let stopFixture!: () => void;
const fixtureStopped = new Promise<void>((resolve) => {
  stopFixture = resolve;
});

function formatSunAmount(amountInSun: number): string {
  const whole = Math.floor(amountInSun / 1_000_000);
  const fraction = String(amountInSun % 1_000_000).padStart(6, '0');
  return `${whole}.${fraction}`.replace(/\.?0+$/u, '');
}

function getTronTrc20AssetId(
  localNodes: unknown[],
  symbol: 'USDT' | 'USDD' | 'HTX' | 'SEED',
): string {
  const tronNode = localNodes.find(
    (node): node is TronNode => node instanceof TronNode,
  );
  const token = tronNode?.trc20Tokens[symbol];
  if (!token) {
    throw new Error(`Seeded ${symbol} token was not found on the Tron node`);
  }
  return `${TRON_CHAIN_ID}/trc20:${token.address}`;
}

type TronSendScreenOptions = {
  accountLabel: string;
  assetId?: string;
  driver: Driver;
  expectedNativeBalance?: string | null;
  expectedTokenBalance?: string;
  symbol: 'TRX' | 'USDT' | 'USDD' | 'HTX' | 'SEED';
};

async function prepareTronSendFixture(driver: Driver): Promise<void> {
  await login(driver, { validateBalance: false });
  await addMultipleAccounts({
    driver,
    numberOfAccounts: TRON_SEND_ACCOUNTS.length - 1,
  });
  await selectTronNetwork(driver);
  await waitUntilAccountTreeSyncIdle(driver);
}

async function openTronSendScreenForAccount({
  accountLabel,
  assetId,
  driver,
  expectedNativeBalance = '6.072',
  expectedTokenBalance,
  symbol,
}: TronSendScreenOptions): Promise<SendPage> {
  await driver.navigate();
  await switchToAccount(driver, accountLabel);
  await waitUntilAccountTreeSyncIdle(driver);
  await driver.refresh();

  const home = new NonEvmHomepage(driver);
  await home.checkPageIsLoaded();
  if (expectedNativeBalance) {
    await home.checkExpectedTokenBalanceIsDisplayed(
      expectedNativeBalance,
      'TRX',
    );
  }
  if (expectedTokenBalance) {
    await home.checkExpectedTokenBalanceIsDisplayed(
      expectedTokenBalance,
      symbol,
    );
  }

  const sendPage = new SendPage(driver);
  const searchParams = new URLSearchParams({ chainId: TRON_CHAIN_ID });
  if (assetId) {
    searchParams.set('asset', assetId);
  }
  await driver.openNewURL(
    `${driver.extensionUrl}/home.html#/send/amount-recipient?${searchParams.toString()}`,
  );
  await sendPage.checkSendFormIsLoaded();
  return sendPage;
}

describe('Tron Send', function (this: Suite) {
  this.timeout(180_000);

  let fixtureLifecycle: Promise<void> | undefined;

  before('Start shared Tron fixture', async function () {
    fixtureLifecycle = withTronFixtures(
      {
        accounts: TRON_SEND_ACCOUNTS,
        fixtures: TRON_SEND_FIXTURES,
        includeAnvil: false,
        title: 'Tron Send',
      },
      async (context: TronFixtureContext) => {
        try {
          await prepareTronSendFixture(context.driver);
          resolveFixtureReady(context);
          await fixtureStopped;
        } catch (error) {
          rejectFixtureReady(error);
          throw error;
        }
      },
    );
    void fixtureLifecycle.catch(rejectFixtureReady);
    await fixtureReady;
  });

  after('Stop shared Tron fixture', async function () {
    stopFixture();
    await fixtureLifecycle;
  });

  it('blocks Continue when a bad address is entered', async function () {
    const { driver } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
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
    const { driver } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
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
    const { driver } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
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

  it('blocks USDT send when TRX balance cannot cover energy fee', async function () {
    const { driver, localNodes } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
      accountLabel: 'Account 4',
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

  it('sends part of TRX balance and shows it pending then confirmed', async function () {
    const { driver } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
      accountLabel: 'Account 5',
      driver,
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
    });
  });

  it('sends fee-buffered TRX balance via manual full-amount entry', async function () {
    const { driver } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
      accountLabel: 'Account 6',
      driver,
      symbol: 'TRX',
    });
    await sendPage.fillRecipient({
      recipientAddress: TRON_RECIPIENT_ADDRESS,
    });
    const sendAmount = formatSunAmount(
      TRON_PORTFOLIO_TRX_BALANCE_IN_SUN - TRON_SEND_FEE_BUFFER_IN_SUN,
    );
    await sendPage.fillAmount(sendAmount);
    await sendPage.pressContinueButton();

    await confirmTronSendAndAssertActivity({ driver });
  });

  it('sends part of USDT balance and shows it pending then confirmed', async function () {
    const { driver, localNodes } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
      accountLabel: 'Account 7',
      assetId: getTronTrc20AssetId(localNodes, 'USDT'),
      driver,
      // Homepage rounds 2.804595 → 2.805 (same as assets.spec.ts).
      expectedTokenBalance: '2.805',
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
    });
  });

  it('sends total USDT balance via manual full-amount entry', async function () {
    const { driver, localNodes } = await fixtureReady;
    const sendPage = await openTronSendScreenForAccount({
      accountLabel: 'Account 8',
      assetId: getTronTrc20AssetId(localNodes, 'USDT'),
      driver,
      // Homepage rounds 2.804595 → 2.805 (same as assets.spec.ts).
      expectedTokenBalance: '2.805',
      symbol: 'USDT',
    });
    await sendPage.fillRecipient({
      recipientAddress: TRON_RECIPIENT_ADDRESS,
    });
    // Seeded USDT balance is 2_804_595 raw = 2.804595 USDT.
    // TRC20 has no fee buffer (fee paid in TRX).
    await sendPage.fillAmount('2.804595');
    await sendPage.waitForSendAmountBalance();
    await sendPage.pressContinueButton();

    // Activity may round the amount; presence + confirmed status is enough.
    await confirmTronSendAndAssertActivity({ driver });
  });
});
