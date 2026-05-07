'use strict';

require('dotenv').config();
const { buildCliAgentContext } = require('./web/server/lib/agentContext');
const { runIngest } = require('./src/ingestion/ingest');
const { runPipeline } = require('./pipeline');

buildCliAgentContext()
  .then(async (agentCtx) => {
    if (process.env.RUN_INGEST === 'true') {
      return runIngest(agentCtx);
    }
    return runPipeline(agentCtx);
  })
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\nPipeline failed:', err.message);
    process.exit(1);
  });
