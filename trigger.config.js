'use strict';

const { defineConfig } = require('@trigger.dev/sdk');

module.exports = defineConfig({
  project: 'proj_xxxxxxxxxxxxxxxx', // Replace with your project ref from cloud.trigger.dev
  runtime: 'node',
  dirs: ['./trigger'],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
