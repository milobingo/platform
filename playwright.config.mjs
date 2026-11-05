import {defineConfig} from '@playwright/test';
const external=process.env.BROWSER_BASE_URL;
export default defineConfig({
  testDir:'./tests/browser', timeout:60000, workers:2, fullyParallel:true,
  use:{baseURL:external||'http://127.0.0.1:4175',headless:true,trace:'retain-on-failure'},
  reporter:[['list'],['json',{outputFile:'verification/browser-tests.json'}]],
  webServer:external?undefined:{command:'node scripts/start-standalone-test.mjs',url:'http://127.0.0.1:4175/spelen',timeout:60000,reuseExistingServer:false,gracefulShutdown:{signal:'SIGTERM',timeout:15000}},
});
