import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { ProcessManager, resolveCommandArgs, applyRouterDemoOverride } from './process-manager.js';
import { LEVANTO_ROUTER_PACKAGE } from '../../shared/router-plugin-defaults.js';

test('resolveCommandArgs launches the grouped buyer runtime command without forcing the default router', () => {
  const args = resolveCommandArgs({
    mode: 'connect',
    router: 'local',
    configPath: '/tmp/antseed-config.json',
    verbose: true,
  });

  assert.deepEqual(args, [
    '--verbose',
    '--config', resolve('/tmp/antseed-config.json'),
    '--data-dir', join(homedir(), '.antseed'),
    'buyer', 'start',
  ]);
});

test('resolveCommandArgs forwards non-default routers', () => {
  const args = resolveCommandArgs({
    mode: 'connect',
    router: 'custom-router',
    configPath: '/tmp/antseed-config.json',
  });

  assert.deepEqual(args, [
    '--config', resolve('/tmp/antseed-config.json'),
    '--data-dir', join(homedir(), '.antseed'),
    'buyer', 'start', '--router', 'custom-router',
  ]);
});

test('applyRouterDemoOverride sets router to whichever package the buyer selected on connect-mode starts, regardless of the caller-requested router', () => {
  // The renderer's own boot-time auto-start (app.ts's ensureConnectRuntimeStarted)
  // requests whatever router the user has configured, racing the main
  // process's own attempt to set the selected package -- this has to hold
  // regardless of what a caller asks for, not just when nothing is
  // specified. No package gets special-cased env injection here -- a plugin
  // needing chain-specific setup (e.g. its own local test-network
  // addressing) is responsible for handling that itself.
  for (const selectedPackage of [LEVANTO_ROUTER_PACKAGE, '@antseed/router-other']) {
    for (const requestedRouter of [undefined, 'local', 'custom-router']) {
      const result = applyRouterDemoOverride({
        mode: 'connect',
        router: requestedRouter,
        env: { EXISTING: '1' },
      }, () => selectedPackage);
      assert.equal(result.router, selectedPackage, `router should be set to ${selectedPackage} when requested router was ${String(requestedRouter)}`);
      assert.deepEqual(result.env, {
        EXISTING: '1',
        ANTSEED_ROUTER_DATA_DIR: process.env['ANTSEED_ROUTER_DATA_DIR']
          ?? join(homedir(), '.antseed', selectedPackage === LEVANTO_ROUTER_PACKAGE ? 'router-levanto' : 'router-other'),
      });
    }
  }
});

test('applyRouterDemoOverride leaves connect-mode starts untouched when the router dropdown is explicitly set to None', () => {
  // "None" is an explicit choice (VprPreferencesView.tsx writes
  // selectedRouterPackage: null for it), distinct from the field never
  // having been set at all -- resolveRouterPackage returning null models
  // exactly that.
  const opts = { mode: 'connect' as const, router: 'local', env: { EXISTING: '1' } };
  const result = applyRouterDemoOverride(opts, () => null);
  assert.deepEqual(result, opts);
});

test('applyRouterDemoOverride leaves non-connect modes untouched', () => {
  const opts = { mode: 'system-proxy' as const, systemProxyPort: 8080 };
  const result = applyRouterDemoOverride(opts);
  assert.deepEqual(result, opts);
});

test('resolveCommandArgs launches the System Proxy runtime with selected profiles and models', () => {
  const args = resolveCommandArgs({
    mode: 'system-proxy',
    configPath: '/tmp/antseed-config.json',
    systemProxyPeerId: '0123456789abcdef0123456789abcdef01234567',
    systemProxyPort: 8378,
    systemProxyProfiles: ['editor', 'browser'],
    systemProxyDefaultModel: 'model-a',
    systemProxyServedModels: ['model-a', 'model-b'],
    setSystemProxy: true,
  });

  assert.deepEqual(args, [
    '--config', resolve('/tmp/antseed-config.json'),
    '--data-dir', join(homedir(), '.antseed'),
    'system-proxy', 'start',
    '--peer', '0123456789abcdef0123456789abcdef01234567',
    '--port', '8378',
    '--profile', 'editor',
    '--profile', 'browser',
    '--default-model', 'model-a',
    '--served-model', 'model-a',
    '--served-model', 'model-b',
    '--system-proxy',
  ]);
});

test('resolveCommandArgs launches the public tunnel through the CLI', () => {
  const args = resolveCommandArgs({
    mode: 'tunnel',
    configPath: '/tmp/antseed-config.json',
    tunnelBuyerPort: 9456,
  });

  assert.deepEqual(args, [
    '--config', resolve('/tmp/antseed-config.json'),
    '--data-dir', join(homedir(), '.antseed'),
    'tunnel', 'start', '--buyer-port', '9456',
  ]);
});

test('attached runtimes can be stopped locally without owning the shared process', async () => {
  const logs: string[] = [];
  const processManager = new ProcessManager((_mode, _stream, line) => logs.push(line));

  const attached = processManager.attach('connect');
  assert.equal(attached.running, true);
  assert.equal(attached.pid, null);
  assert.equal(processManager.isAttached('connect'), true);

  const stopped = await processManager.stop('connect', true);
  assert.equal(stopped.running, false);
  assert.equal(stopped.pid, null);
  assert.equal(processManager.isAttached('connect'), false);
  assert.deepEqual(logs, ['Attached to existing connect runtime']);
});
