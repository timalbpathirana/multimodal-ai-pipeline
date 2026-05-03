'use strict';

const { schedules } = require('@trigger.dev/sdk');
const { runPipeline } = require('../pipeline');

const dailyPropertyVideo = schedules.task({
  id: 'daily-melb-property-video',
  cron: '0 6 * * *', // 6am UTC = 4pm AEST / 5pm AEDT
  run: async (payload) => {
    console.log(`[trigger] Scheduled run at ${payload.timestamp}`);
    const result = await runPipeline();
    return {
      success: true,
      scriptText: result.scriptText,
      videoPath: result.videoPath,
    };
  },
});

module.exports = { dailyPropertyVideo };
