'use strict';

const { runPipeline } = require('./pipeline');

runPipeline()
  .then(result => {
    console.log('\nScript:', result.scriptText);
    process.exit(0);
  })
  .catch(err => {
    console.error('\nPipeline failed:', err.message);
    process.exit(1);
  });
