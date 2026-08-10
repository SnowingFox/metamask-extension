import { createDeferredPromise } from '@metamask/utils';
import { Suite } from 'mocha';
import { EXPECTED_TRON_ADDRESSES_BY_INDEX } from '../../constants';
import FixtureBuilderV2 from '../../fixtures/fixture-builder-v2';
import { Driver } from '../../webdriver/driver';
import { login } from '../../page-objects/flows/login.flow';
import {
  selectAllNetworksFromNetworkSelect,
  switchToNetworkFromNetworkSelect,
} from '../../page-objects/flows/network.flow';
import {
  addNHdAccountsForTronDerivation,
  waitUntilAccountTreeSyncIdle,
} from '../../page-objects/flows/tron-account-derivation.flow';
import AccountListPage from '../../page-objects/pages/account-list-page';
import HomePage from '../../page-objects/pages/home/homepage';
import TokensTab from '../../page-objects/pages/home/tokens-tab';
import TronAssetDetailsPage from '../../page-objects/pages/asset/tron-asset-details';
import {
  EMPTY_TRON_ACCOUNT,
  TRON_PORTFOLIO_ACCOUNT,
  TRON_PORTFOLIO_LOW_VALUE_ASSET_NAMES,
  TRON_PORTFOLIO_MAIN_LIST_ASSET_NAMES,
} from './fixtures/environments';
import {
  withTronFixtures,
  type TronFixtureAccount,
} from './fixtures/with-tron-fixtures';

/** Max wait for Tron Snap balances to appear in the token list after refresh. */
const TRON_ASSET_LIST_TIMEOUT_MS = 30_000;

/**
 * Enables the batch-sell remote flag so native coin overflow uses the More menu
 * (Receive + Batch sell) rather than the legacy sole-default button layout.
 */
const TRON_ASSETS_REMOTE_FEATURE_FLAGS = {
  remoteFeatureFlags: {
    batchSell: { enabled: true },
  },
} as const;

/** Runtime override so batchSell survives client-config flag refresh in E2E. */
const TRON_ASSETS_MANIFEST_FLAGS = {
  remoteFeatureFlags: {
    batchSell: { enabled: true },
  },
} as const;

const TRON_ASSETS_EMPTY_ACCOUNT_LABEL = 'Account 1';
const TRON_ASSETS_PORTFOLIO_ACCOUNT_LABEL = 'Account 2';

const TRON_ASSETS_FIXTURE_STATE = {
  fixtures: new FixtureBuilderV2()
    .withShowNativeTokenAsMainBalanceDisabled()
    .withRemoteFeatureFlagController(TRON_ASSETS_REMOTE_FEATURE_FLAGS)
    .build(),
  manifestFlags: TRON_ASSETS_MANIFEST_FLAGS,
  title: 'Tron - Assets',
};

const EMPTY_ACCOUNT_FIXTURE: TronFixtureAccount[] = [
  {
    ...EMPTY_TRON_ACCOUNT,
    address: EXPECTED_TRON_ADDRESSES_BY_INDEX[0],
  },
];

const PORTFOLIO_ACCOUNT_FIXTURE: TronFixtureAccount[] = [
  {
    ...TRON_PORTFOLIO_ACCOUNT,
    address: EXPECTED_TRON_ADDRESSES_BY_INDEX[1],
  },
];

const TRON_ASSETS_FIXTURE = {
  ...TRON_ASSETS_FIXTURE_STATE,
  accounts: [...EMPTY_ACCOUNT_FIXTURE, ...PORTFOLIO_ACCOUNT_FIXTURE],
} satisfies Parameters<typeof withTronFixtures>[0];

async function prepareTronAssetsFixture(driver: Driver): Promise<void> {
  await login(driver, { validateBalance: false });
  await switchToNetworkFromNetworkSelect(driver, 'Popular', 'Tron');
  await waitUntilAccountTreeSyncIdle(driver);
  await addNHdAccountsForTronDerivation(driver, 2);
  await waitUntilAccountTreeSyncIdle(driver);
}

let tronAssetsDriver: Driver | undefined;
let tronAssetsFixturePromise: Promise<void> | undefined;
let releaseTronAssetsFixture:
  | ReturnType<typeof createDeferredPromise<void>>
  | undefined;

function getTronAssetsDriver(): Driver {
  if (!tronAssetsDriver) {
    throw new Error('The shared Tron Assets fixture is not running');
  }
  return tronAssetsDriver;
}

async function landOnTronHome(
  driver: Driver,
  accountLabel = TRON_ASSETS_EMPTY_ACCOUNT_LABEL,
): Promise<void> {
  await driver.navigate();
  const homePage = new HomePage(driver);
  await homePage.checkPageIsLoaded();
  await waitUntilAccountTreeSyncIdle(driver);
  await homePage.headerNavbar.openAccountMenu();

  const accountList = new AccountListPage(driver);
  await accountList.checkPageIsLoaded();
  await accountList.selectAccount(accountLabel);
  await homePage.headerNavbar.checkAccountLabel(accountLabel);
  await waitUntilAccountTreeSyncIdle(driver);

  // Refresh re-hydrates the UI from background state so asynchronously-fetched
  // Snap balances appear reliably in the token list.
  await driver.refresh();
  await homePage.checkPageIsLoaded();
}

async function waitForTronAssetList(
  tokensTab: TokensTab,
  tokenName = 'Tron',
): Promise<void> {
  await tokensTab.checkTokenExistsInList(tokenName, undefined, {
    timeout: TRON_ASSET_LIST_TIMEOUT_MS,
  });
}

describe('Tron - Assets', function (this: Suite) {
  this.timeout(300_000);

  before('Set up shared Tron Assets fixture', async function () {
    const fixtureReady = createDeferredPromise<void>();
    const fixtureReleased = createDeferredPromise<void>();
    releaseTronAssetsFixture = fixtureReleased;

    tronAssetsFixturePromise = withTronFixtures(
      TRON_ASSETS_FIXTURE,
      async ({ driver }: { driver: Driver }) => {
        tronAssetsDriver = driver;
        await prepareTronAssetsFixture(driver);
        fixtureReady.resolve();
        await fixtureReleased.promise;
      },
    );

    const fixtureState = await Promise.race([
      fixtureReady.promise.then(() => 'ready' as const),
      tronAssetsFixturePromise.then(() => 'completed' as const),
    ]);
    if (fixtureState === 'completed') {
      throw new Error(
        'The Tron Assets fixture completed before its shared context was ready',
      );
    }
  });

  after('Shut down shared Tron Assets fixture', async function () {
    releaseTronAssetsFixture?.resolve();
    if (tronAssetsFixturePromise) {
      await tronAssetsFixturePromise;
    }
  });

  describe('Empty account fixture', function () {
    it('For an empty account, TRX should be present with a balance of 0', async function () {
      const driver = getTronAssetsDriver();
      await landOnTronHome(driver);

      const tokensTab = new TokensTab(driver);
      await waitForTronAssetList(tokensTab);
      await tokensTab.checkOnlyAssetsArePresent(['Tron']);
      await tokensTab.checkTokenAmountIsDisplayed('0');
      await tokensTab.checkTokenRowHasVisibleLogo('Tron');
      await tokensTab.checkTokenRowContainsAllText('Tron', [
        'Tron',
        '0 TRX',
        '$',
      ]);
    });
  });

  describe('Portfolio account fixture', function () {
    describe('Assets list', function () {
      it('Lists TRX, TRC10, TRC20 with name, symbol, amount, fiat for portfolio account', async function () {
        const driver = getTronAssetsDriver();
        await landOnTronHome(driver, TRON_ASSETS_PORTFOLIO_ACCOUNT_LABEL);

        const tokensTab = new TokensTab(driver);
        await waitForTronAssetList(tokensTab, 'Tron');
        await tokensTab.checkTokenExistsInList('Tron', '6.072', {
          timeout: TRON_ASSET_LIST_TIMEOUT_MS,
        });
        await tokensTab.checkTokenRowHasVisibleLogo('Tron');
        await tokensTab.checkTokenRowContainsAllText('Tron', [
          'Tron',
          '6.072 TRX',
          '$',
        ]);
        await tokensTab.checkTokenExistsInList('GasFreeTransferSolution');
        await tokensTab.checkTokenRowContainsAllText(
          'GasFreeTransferSolution',
          ['GasFreeTransferSolution', '33.333 GAS_FREE', '$'],
        );
        await tokensTab.checkTokenExistsInList('Tether');
        await tokensTab.checkTokenRowHasVisibleLogo('Tether');
        await tokensTab.checkTokenRowContainsAllText('Tether', [
          'Tether',
          '2.805 USDT',
          '$',
        ]);
        await tokensTab.checkTokenExistsInList('HTX DAO');
        await tokensTab.checkTokenRowContainsAllText('HTX DAO', [
          'HTX DAO',
          '3.16M HTX',
          '$',
        ]);
        await tokensTab.checkTokenExistsInList('USDD');
        await tokensTab.checkTokenRowContainsAllText('USDD', [
          'USDD',
          '0.290 USDD',
          '$',
        ]);
        await tokensTab.checkTokenExistsInList('SEED');
        await tokensTab.checkTokenRowContainsAllText('SEED', [
          'SEED',
          '89.851 SEED',
          '$',
        ]);
        await tokensTab.checkConversionRateDisplayed();
      });

      it('Low-value assets section hides tokens under $1 until expanded', async function () {
        const driver = getTronAssetsDriver();
        await landOnTronHome(driver, TRON_ASSETS_PORTFOLIO_ACCOUNT_LABEL);
        const tokensTab = new TokensTab(driver);
        await tokensTab.checkTokenNameVisible('Tron', {
          timeout: TRON_ASSET_LIST_TIMEOUT_MS,
        });

        await tokensTab.checkCollapsedTokenItemNumber(
          TRON_PORTFOLIO_MAIN_LIST_ASSET_NAMES.length,
        );
        await tokensTab.checkLowValueAssetsToggleIsPresent(
          TRON_PORTFOLIO_LOW_VALUE_ASSET_NAMES.length,
        );
        for (const tokenName of TRON_PORTFOLIO_MAIN_LIST_ASSET_NAMES) {
          await tokensTab.checkTokenNameVisible(tokenName, {
            timeout: TRON_ASSET_LIST_TIMEOUT_MS,
          });
        }
        await tokensTab.checkAssetIsAbsent('GasFreeTransferSolution');
        await tokensTab.checkAssetIsAbsent('SEED');
        await tokensTab.checkAssetIsAbsent('USDD');

        await tokensTab.expandLowValueAssets();
        for (const tokenName of TRON_PORTFOLIO_LOW_VALUE_ASSET_NAMES) {
          await tokensTab.checkTokenNameVisible(tokenName);
        }
        await tokensTab.checkOnlyAssetsArePresent([
          ...TRON_PORTFOLIO_MAIN_LIST_ASSET_NAMES,
          ...TRON_PORTFOLIO_LOW_VALUE_ASSET_NAMES,
        ]);
      });

      describe('Networks filter', function () {
        it('All networks filter shows other chains alongside Tron', async function () {
          const driver = getTronAssetsDriver();
          await landOnTronHome(driver, TRON_ASSETS_PORTFOLIO_ACCOUNT_LABEL);
          const tokensTab = new TokensTab(driver);
          await waitForTronAssetList(tokensTab);
          await selectAllNetworksFromNetworkSelect(driver);
          await tokensTab.checkTokenExistsInList('Tron');
          await tokensTab.checkTokenExistsInList('Tether');
          await tokensTab.checkTokenExistsInList('Ethereum');
        });

        it('Current network filter shows only Tron assets', async function () {
          const driver = getTronAssetsDriver();
          await landOnTronHome(driver, TRON_ASSETS_PORTFOLIO_ACCOUNT_LABEL);
          // The previous test selects All Networks. Reset the shared browser
          // explicitly so this test and the following detail tests use Tron.
          await switchToNetworkFromNetworkSelect(driver, 'Popular', 'Tron');
          const tokensTab = new TokensTab(driver);
          await waitForTronAssetList(tokensTab);
          await tokensTab.checkOnlyAssetsArePresent([
            'Tron',
            'GasFreeTransferSolution',
            'Tether',
            'HTX DAO',
            'USDD',
            'SEED',
          ]);
          await tokensTab.checkAssetIsAbsent('Ethereum');
        });
      });
    });

    describe('Asset details', function () {
      it('TRX asset details: header, chart, action buttons, daily resource, sections', async function () {
        const driver = getTronAssetsDriver();
        await landOnTronHome(driver, TRON_ASSETS_PORTFOLIO_ACCOUNT_LABEL);
        const tokensTab = new TokensTab(driver);
        await waitForTronAssetList(tokensTab);
        await tokensTab.clickOnAsset('Tron');
        const details = new TronAssetDetailsPage(driver);
        await details.checkPageIsLoaded();
        await details.checkCurrentPriceHeader();
        await details.checkPriceChart();
        // batchSell enabled → Receive lives in the More overflow menu (latest UI).
        await details.checkActionButtons({
          swap: true,
          send: true,
          receive: true,
        });
        await details.checkDailyResourcesSection();
        await details.checkAllStandardSections();
      });

      it('TRC20 asset details: header, chart, action buttons, sections — no daily resource', async function () {
        const driver = getTronAssetsDriver();
        await landOnTronHome(driver, TRON_ASSETS_PORTFOLIO_ACCOUNT_LABEL);
        const tokensTab = new TokensTab(driver);
        await waitForTronAssetList(tokensTab);
        await tokensTab.clickOnAsset('Tether');
        const details = new TronAssetDetailsPage(driver);
        await details.checkPageIsLoaded();
        await details.checkCurrentPriceHeader();
        await details.checkPriceChart();
        await details.checkTokenActionButtons();
        await details.checkAllStandardSections();
        await driver.assertElementNotPresent(
          '[data-testid="tron-daily-resources"]',
        );
      });
    });
  });
});
