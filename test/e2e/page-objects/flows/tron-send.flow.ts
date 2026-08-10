import { WINDOW_TITLES } from '../../constants';
import { Driver } from '../../webdriver/driver';
import SnapTransactionConfirmation from '../pages/confirmations/snap-transaction-confirmation';
import ActivityTab from '../pages/home/activity-tab';
import HomePage from '../pages/home/homepage';
import NonEvmHomepage from '../pages/home/non-evm-homepage';
import SendPage from '../pages/send/send-page';
import { TRON_CHAIN_ID } from '../../tests/tron/mocks/common-tron';
import { switchToAccount } from './account-list.flow';
import {
  addNHdAccountsForTronDerivation,
  waitUntilAccountTreeSyncIdle,
} from './tron-account-derivation.flow';
import { login } from './login.flow';
import { switchToNetworkFromNetworkSelect } from './network.flow';
import { selectTronNetwork } from './tron-network.flow';

const TRON_CONFIRM_TIMEOUT_MS = 30_000;
const TRON_BALANCE_TIMEOUT_MS = 30_000;
const TRON_ACTIVITY_PENDING_OR_CONFIRMED_SELECTOR =
  '[data-tx-status="submitted"], [data-tx-status="approved"], [data-tx-status="unapproved"], [data-tx-status="pending"], [data-tx-status="confirmed"]';

type TronSendScreenOptions = {
  assetId?: string;
  driver: Driver;
  expectedNativeBalance?: string | null;
  expectedTokenBalance?: string;
  symbol: 'TRX' | 'USDT' | 'USDD' | 'HTX' | 'SEED';
};

export async function landOnTronSendScreen({
  driver,
  symbol,
  assetId,
  expectedNativeBalance = '6.072',
  expectedTokenBalance,
}: TronSendScreenOptions): Promise<SendPage> {
  await login(driver, { validateBalance: false });
  await selectTronNetwork(driver);

  return openTronSendScreen({
    assetId,
    driver,
    expectedNativeBalance,
    expectedTokenBalance,
    symbol,
  });
}

/**
 * Returns a shared Tron fixture to the extension homepage, selects one of the
 * pre-created multichain accounts, and opens Send for that account.
 *
 * @param options - Shared-suite Send options.
 * @param options.accountLabel - Multichain account label to select.
 * @returns The loaded Send page.
 */
export async function landOnTronSendScreenForAccount({
  accountLabel,
  ...sendOptions
}: TronSendScreenOptions & { accountLabel: string }): Promise<SendPage> {
  const { driver } = sendOptions;
  await driver.navigate();
  await switchToAccount(driver, accountLabel);
  await waitUntilAccountTreeSyncIdle(driver);

  return openTronSendScreen(sendOptions);
}

/**
 * Prepares an unlocked wallet for a suite that shares one Tron fixture.
 * Existing HD groups are created before Tron is enabled so BIP44 Stage 2 can
 * derive all corresponding Tron accounts in one account-tree synchronization.
 *
 * @param options - Shared-suite setup options.
 * @param options.driver - WebDriver instance.
 * @param options.totalAccounts - Total number of multichain account groups.
 */
export async function prepareSharedTronSendSuite({
  driver,
  totalAccounts,
}: {
  driver: Driver;
  totalAccounts: number;
}): Promise<void> {
  await login(driver, { validateBalance: false });
  await addNHdAccountsForTronDerivation(driver, totalAccounts);
  await switchToNetworkFromNetworkSelect(driver, 'Popular', 'Tron');
  await driver.navigate();
  await new HomePage(driver).checkPageIsLoaded();
  await waitUntilAccountTreeSyncIdle(driver);
}

async function openTronSendScreen({
  assetId,
  driver,
  expectedNativeBalance = '6.072',
  expectedTokenBalance,
  symbol,
}: TronSendScreenOptions): Promise<SendPage> {
  // Refresh re-hydrates the UI from background state so asynchronously-fetched
  // Snap balances appear reliably in the token list (same pattern as assets.spec).
  await driver.refresh();

  const home = new NonEvmHomepage(driver);
  await home.checkPageIsLoaded();
  // Wait for the live TRX balance to land on the homepage before navigating to
  // Send. Without this gate, Send opens with the cached "0 TRX available" and
  // every amount renders "Insufficient funds", leaving the Continue button
  // disabled. The local Tron node is seeded with 6.072 TRX in profiles.ts.
  if (expectedNativeBalance) {
    await home.checkExpectedTokenBalanceIsDisplayed(
      expectedNativeBalance,
      'TRX',
      TRON_BALANCE_TIMEOUT_MS,
    );
  }
  if (expectedTokenBalance) {
    await home.checkExpectedTokenBalanceIsDisplayed(
      expectedTokenBalance,
      symbol,
      TRON_BALANCE_TIMEOUT_MS,
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

async function waitForTronSendActivity(driver: Driver): Promise<void> {
  // Local java-tron can confirm before a pending row is observable.
  console.log('Waiting for Tron send activity (pending or confirmed)');
  await driver.wait(async () => {
    try {
      const activityItems = await driver.findElements(
        TRON_ACTIVITY_PENDING_OR_CONFIRMED_SELECTOR,
      );
      return activityItems.length >= 1;
    } catch {
      return false;
    }
  }, 30_000);
}

export async function confirmTronSendAndAssertActivity({
  driver,
  expectedAmount,
  expectedConfirmedTransactions = 1,
}: {
  driver: Driver;
  expectedAmount?: string;
  expectedConfirmedTransactions?: number;
}): Promise<void> {
  const snapConfirmation = new SnapTransactionConfirmation(driver);
  const extensionHandle = await driver.driver.getWindowHandle();
  let usingDialog = false;

  try {
    await driver.waitForWindowWithTitleToBePresent(WINDOW_TITLES.Dialog, 5_000);
    await driver.switchToWindowWithTitle(WINDOW_TITLES.Dialog);
    usingDialog = true;
  } catch {
    // Unified send may render confirmation inline in the extension popup.
  }

  await snapConfirmation.checkPageIsLoaded({
    timeout: TRON_CONFIRM_TIMEOUT_MS,
  });

  if (usingDialog) {
    await snapConfirmation.clickFooterConfirmButtonAndWaitForWindowToClose();
    await driver.switchToWindow(extensionHandle);
  } else {
    await snapConfirmation.clickFooterConfirmButton();
  }

  const homePage = new HomePage(driver);
  // Same mitigation as BTC Bug #43641: confirm may leave Assets/Home selected.
  await homePage.goToActivityList();

  const activityList = new ActivityTab(driver);
  await waitForTronSendActivity(driver);
  await activityList.checkConfirmedTxNumberDisplayedInActivity(
    expectedConfirmedTransactions,
  );
  if (expectedAmount) {
    await activityList.checkTxAmountInActivity(expectedAmount, 1);
  }
  await activityList.checkNoFailedTransactions();
}
