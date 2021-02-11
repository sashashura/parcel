// @flow strict-local

import ParcelConfig from '../src/ParcelConfig';
import assert from 'assert';
import path from 'path';
import sinon from 'sinon';
import logger from '@parcel/logger';
import {inputFS} from '@parcel/test-utils';
import {parseAndProcessConfig} from '../src/requests/ParcelConfigRequest';
import {DEFAULT_OPTIONS} from './test-utils';

describe('ParcelConfig', () => {
  describe('matchGlobMap', () => {
    let config = new ParcelConfig(
      {
        filePath: '.parcelrc',
        bundler: undefined,
        packagers: {
          '*.css': {
            packageName: 'parcel-packager-css',
            resolveFrom: '.parcelrc',
            keyPath: '/packagers/*.css',
          },
          '*.js': {
            packageName: 'parcel-packager-js',
            resolveFrom: '.parcelrc',
            keyPath: '/packagers/*.js',
          },
        },
      },
      DEFAULT_OPTIONS,
    );

    it('should return null array if no glob matches', () => {
      let result = config.matchGlobMap('foo.wasm', config.packagers);
      assert.deepEqual(result, null);
    });

    it('should return a matching pipeline', () => {
      let result = config.matchGlobMap('foo.js', config.packagers);
      assert.deepEqual(result, {
        packageName: 'parcel-packager-js',
        resolveFrom: '.parcelrc',
        keyPath: '/packagers/*.js',
      });
    });
  });

  describe('matchGlobMapPipelines', () => {
    let config = new ParcelConfig(
      {
        filePath: '.parcelrc',
        bundler: undefined,
        transformers: {
          '*.jsx': [
            {
              packageName: 'parcel-transform-jsx',
              resolveFrom: '.parcelrc',
              keyPath: '/transformers/*.jsx/0',
            },
            '...',
          ],
          '*.{js,jsx}': [
            {
              packageName: 'parcel-transform-js',
              resolveFrom: '.parcelrc',
              keyPath: '/transformers/*.{js,jsx}/0',
            },
          ],
        },
      },
      DEFAULT_OPTIONS,
    );

    it('should return an empty array if no pipeline matches', () => {
      let pipeline = config.matchGlobMapPipelines(
        'foo.css',
        config.transformers,
      );
      assert.deepEqual(pipeline, []);
    });

    it('should return a matching pipeline', () => {
      let pipeline = config.matchGlobMapPipelines(
        'foo.js',
        config.transformers,
      );
      assert.deepEqual(pipeline, [
        {
          packageName: 'parcel-transform-js',
          resolveFrom: '.parcelrc',
          keyPath: '/transformers/*.{js,jsx}/0',
        },
      ]);
    });

    it('should merge pipelines with spread elements', () => {
      let pipeline = config.matchGlobMapPipelines(
        'foo.jsx',
        config.transformers,
      );
      assert.deepEqual(pipeline, [
        {
          packageName: 'parcel-transform-jsx',
          resolveFrom: '.parcelrc',
          keyPath: '/transformers/*.jsx/0',
        },
        {
          packageName: 'parcel-transform-js',
          resolveFrom: '.parcelrc',
          keyPath: '/transformers/*.{js,jsx}/0',
        },
      ]);
    });
  });

  describe('loadPlugin', () => {
    it('should warn if a plugin needs to specify an engines.parcel field in package.json', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'plugins',
        '.parcelrc',
      );
      let config = new ParcelConfig(
        {
          filePath: configFilePath,
          bundler: undefined,
          transformers: {
            '*.js': [
              {
                packageName: 'parcel-transformer-no-engines',
                resolveFrom: configFilePath,
                keyPath: '/transformers/*.js/0',
              },
            ],
          },
        },
        DEFAULT_OPTIONS,
      );

      sinon.stub(logger, 'warn');
      let {plugin} = await config.loadPlugin({
        packageName: 'parcel-transformer-no-engines',
        resolveFrom: configFilePath,
        keyPath: '/transformers/*.js/0',
      });
      assert(plugin);
      assert.equal(typeof plugin.transform, 'function');
      assert(logger.warn.calledOnce);
      assert.deepEqual(logger.warn.getCall(0).args[0], {
        origin: '@parcel/core',
        message:
          'The plugin "parcel-transformer-no-engines" needs to specify a `package.json#engines.parcel` field with the supported Parcel version range.',
      });
      logger.warn.restore();
    });

    it('should error if a plugin specifies an invalid engines.parcel field in package.json', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'plugins',
        '.parcelrc',
      );
      let config = new ParcelConfig(
        {
          filePath: configFilePath,
          bundler: undefined,
          transformers: {
            '*.js': [
              {
                packageName: 'parcel-transformer-not-found',
                resolveFrom: configFilePath,
                keyPath: '/transformers/*.js/0',
              },
            ],
          },
        },
        DEFAULT_OPTIONS,
      );
      // $FlowFixMe
      let parcelVersion = require('../package.json').version;
      let pkgJSON = path.join(
        __dirname,
        'fixtures',
        'plugins',
        'node_modules',
        'parcel-transformer-bad-engines',
        'package.json',
      );
      let code = inputFS.readFileSync(pkgJSON, 'utf8');

      // $FlowFixMe
      await assert.rejects(
        () =>
          config.loadPlugin({
            packageName: 'parcel-transformer-bad-engines',
            resolveFrom: configFilePath,
            keyPath: '/transformers/*.js/0',
          }),
        {
          name: 'Error',
          diagnostics: [
            {
              message: `The plugin "parcel-transformer-bad-engines" is not compatible with the current version of Parcel. Requires "5.x" but the current version is "${parcelVersion}".`,
              origin: '@parcel/core',
              filePath: pkgJSON,
              language: 'json5',
              codeFrame: {
                code,
                codeHighlights: [
                  {
                    start: {line: 5, column: 5},
                    end: {line: 5, column: 19},
                    message: undefined,
                  },
                ],
              },
            },
          ],
        },
      );
    });

    it('should error with a codeframe if a plugin is not resolved', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-plugin-not-found',
        '.parcelrc',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');
      let {config} = await parseAndProcessConfig(
        configFilePath,
        code,
        DEFAULT_OPTIONS,
      );
      let parcelConfig = new ParcelConfig(config, DEFAULT_OPTIONS);

      // $FlowFixMe
      await assert.rejects(() => parcelConfig.getTransformers('test.js'), {
        name: 'Error',
        diagnostics: [
          {
            message: 'Cannot find Parcel plugin "@parcel/transformer-jj"',
            origin: '@parcel/core',
            filePath: configFilePath,
            language: 'json5',
            codeFrame: {
              code,
              codeHighlights: [
                {
                  start: {line: 4, column: 14},
                  end: {line: 4, column: 37},
                  message: `Cannot find module "@parcel/transformer-jj", did you mean "@parcel/transformer-js"?`,
                },
              ],
            },
          },
        ],
      });
    });
  });
});
