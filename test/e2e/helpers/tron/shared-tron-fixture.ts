import { createDeferredPromise } from '@metamask/utils';
import type { Driver } from '../../webdriver/driver';
import {
  type WithTronFixturesOptions,
  withTronFixtures,
} from '../../tests/tron/fixtures/with-tron-fixtures';

export type SharedTronFixtureContext = {
  contractRegistry?: unknown;
  driver: Driver;
  localNodes: unknown[];
};

export type SharedTronFixturesRunner = (
  options: WithTronFixturesOptions,
  testSuite: (context: SharedTronFixtureContext) => Promise<void>,
) => Promise<void>;

export type SharedTronFixture = {
  getContext: () => SharedTronFixtureContext;
  start: () => Promise<SharedTronFixtureContext>;
  stop: () => Promise<void>;
};

/**
 * Keeps one Tron fixture lifecycle alive across all tests in a Mocha suite.
 *
 * Call {@link start} from the suite's `before` hook and {@link stop} from its
 * `after` hook. The underlying `withTronFixtures` callback remains pending
 * between those calls, so its browser, mock servers, and local nodes stay
 * available without weakening their normal cleanup ownership.
 *
 * @param options - Options passed to `withTronFixtures` once for the suite.
 * @param dependencies - Injectable fixture runner used by lifecycle unit tests.
 * @param dependencies.runWithTronFixtures
 * @returns A single-use shared fixture lifecycle.
 */
export function createSharedTronFixture(
  options: WithTronFixturesOptions,
  dependencies: {
    runWithTronFixtures?: SharedTronFixturesRunner;
  } = {},
): SharedTronFixture {
  const runWithTronFixtures =
    dependencies.runWithTronFixtures ??
    (withTronFixtures as SharedTronFixturesRunner);

  let context: SharedTronFixtureContext | undefined;
  let fixturePromise: Promise<void> | undefined;
  let releaseFixture:
    | ReturnType<typeof createDeferredPromise<void>>
    | undefined;
  let stopPromise: Promise<void> | undefined;
  let started = false;
  let stopped = false;

  return {
    getContext(): SharedTronFixtureContext {
      if (!context || stopped) {
        throw new Error('Shared Tron fixture is not running');
      }
      return context;
    },

    async start(): Promise<SharedTronFixtureContext> {
      if (started) {
        throw new Error('Shared Tron fixture can only be started once');
      }
      started = true;

      const fixtureReady = createDeferredPromise<SharedTronFixtureContext>();
      releaseFixture = createDeferredPromise<void>();
      let fixtureReadySettled = false;

      fixturePromise = Promise.resolve().then(() =>
        runWithTronFixtures(options, async (fixtureContext) => {
          context = fixtureContext;
          fixtureReadySettled = true;
          fixtureReady.resolve(fixtureContext);
          await releaseFixture?.promise;
        }),
      );

      // Reject `start` when fixture startup fails or when a malformed runner
      // finishes without ever exposing its callback context. Attaching both
      // handlers immediately also prevents an unhandled fixture rejection
      // while the caller is awaiting readiness.
      // eslint-disable-next-line no-void
      void fixturePromise.then(
        () => {
          if (!fixtureReadySettled) {
            fixtureReadySettled = true;
            fixtureReady.reject(
              new Error(
                'Tron fixture completed before exposing its shared context',
              ),
            );
          }
        },
        (error: unknown) => {
          if (!fixtureReadySettled) {
            fixtureReadySettled = true;
            fixtureReady.reject(error);
          }
        },
      );

      try {
        return await fixtureReady.promise;
      } catch (error) {
        releaseFixture.resolve();
        try {
          await fixturePromise;
        } catch {
          // The original startup or cleanup error is surfaced by `start`.
        }
        context = undefined;
        stopped = true;
        throw error;
      }
    },

    async stop(): Promise<void> {
      if (!started || stopped) {
        return;
      }

      if (!fixturePromise || !releaseFixture) {
        throw new Error('Shared Tron fixture did not initialize correctly');
      }

      stopPromise ??= (async () => {
        releaseFixture.resolve();
        try {
          await fixturePromise;
        } finally {
          context = undefined;
          stopped = true;
        }
      })();

      await stopPromise;
    },
  };
}
