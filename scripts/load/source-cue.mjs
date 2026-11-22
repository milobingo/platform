// Test-source cue clock only; the real show's server remains authoritative.
export const SOURCE_CUE_SECONDS=15;
export const SOURCE_CUE_COUNT=75;
export function sourceCueNumber(mediaTimeSeconds){
  if(!Number.isFinite(mediaTimeSeconds)||mediaTimeSeconds<0)throw new Error('De technische bron heeft geen geldige afspeeltijd.');
  return 1+Math.floor(mediaTimeSeconds/SOURCE_CUE_SECONDS)%SOURCE_CUE_COUNT;
}
