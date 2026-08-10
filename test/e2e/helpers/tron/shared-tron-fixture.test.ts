import type { Driver } from '../../webdriver/driver';
import type { WithTronFixturesOptions } from '../../tests/tron/fixtures/with-tron-fixtures';
import {
  createSharedTronFixture,
  type SharedTronFixtureContext,
  type SharedTronFixturesRunner,
} from './shared-tron-fixture';

describe('createSharedTronFixture', () => {
  const options: WithTronFixturesOptions = { accounts: [] };
  const context: SharedTronFixtureContext = {
    driver: {} as Driver,
    localNodes: [],
  };

  it('keeps the fixture callback active until stop is called', async () => {
    let callbackCompleted = false;
    const runWithTronFixtures: SharedTronFixturesRunner = jest.fn(
      async (_options, testSuite) => {
        await testSuite(context);
        callbackCompleted = true;
      },
    );
    const fixture = createSharedTronFixture(options, {
      runWithTronFixtures,
    });

    await expect(fixture.start()).resolves.toBe(context);
    expect(fixture.getContext()).toBe(context);
    expect(callbackCompleted).toBe(false);

    await fixture.stop();

    expect(callbackCompleted).toBe(true);
    expect(() => fixture.getContext()).toThrow(
      'Shared Tron fixture is not running',
    );
  });

  it('forwards the fixture options to the runner', async () => {
    const runWithTronFixtures: SharedTronFixturesRunner = jest.fn(
      async (_options, testSuite) => testSuite(context),
    );
    const fixture = createSharedTronFixture(options, {
      runWithTronFixtures,
    });

    await fixture.start();
    await fixture.stop();

    expect(runWithTronFixtures).toHaveBeenCalledWith(
      options,
      expect.any(Function),
    );
  });

  it('rejects start when fixture setup fails', async () => {
    const setupError = new Error('fixture setup failed');
    const runWithTronFixtures: SharedTronFixturesRunner = jest
      .fn()
      .mockRejectedValue(setupError);
    const fixture = createSharedTronFixture(options, {
      runWithTronFixtures,
    });

    await expect(fixture.start()).rejects.toBe(setupError);
    await expect(fixture.stop()).resolves.toBeUndefined();
  });

  it('rejects start when the fixture runner throws synchronously', async () => {
    const setupError = new Error('synchronous fixture setup failure');
    const runWithTronFixtures: SharedTronFixturesRunner = jest.fn(() => {
      throw setupError;
    });
    const fixture = createSharedTronFixture(options, {
      runWithTronFixtures,
    });

    await expect(fixture.start()).rejects.toBe(setupError);
    await expect(fixture.stop()).resolves.toBeUndefined();
  });

  it('rejects start when the runner exits without a fixture context', async () => {
    const runWithTronFixtures: SharedTronFixturesRunner = jest.fn(
      async () => undefined,
    );
    const fixture = createSharedTronFixture(options, {
      runWithTronFixtures,
    });

    await expect(fixture.start()).rejects.toThrow(
      'Tron fixture completed before exposing its shared context',
    );
  });

  it('propagates fixture teardown failures and clears the context', async () => {
    const teardownError = new Error('fixture teardown failed');
    const runWithTronFixtures: SharedTronFixturesRunner = jest.fn(
      async (_options, testSuite) => {
        await testSuite(context);
        throw teardownError;
      },
    );
    const fixture = createSharedTronFixture(options, {
      runWithTronFixtures,
    });

    await fixture.start();
    await expect(fixture.stop()).rejects.toBe(teardownError);
    expect(() => fixture.getContext()).toThrow(
      'Shared Tron fixture is not running',
    );
  });

  it('does not allow the same fixture lifecycle to start twice', async () => {
    const runWithTronFixtures: SharedTronFixturesRunner = jest.fn(
      async (_options, testSuite) => testSuite(context),
    );
    const fixture = createSharedTronFixture(options, {
      runWithTronFixtures,
    });

    await fixture.start();
    await expect(fixture.start()).rejects.toThrow(
      'Shared Tron fixture can only be started once',
    );
    await fixture.stop();
  });
});
