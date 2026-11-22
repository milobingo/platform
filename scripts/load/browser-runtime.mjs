// Node owns bounded shutdown and WHIP cleanup. Playwright must leave the
// browser alive until that cleanup finishes after SIGINT/SIGTERM.
export const HARNESS_BROWSER_SIGNAL_OPTIONS=Object.freeze({handleSIGINT:false,handleSIGTERM:false});
