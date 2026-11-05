# LiveKit call contract

All writes use same-origin JSON and `X-Vlampie-Call: 1`. Every call request supplies `gameId`, `role` (`host`, `player`, `output`) and `clientId`. Actions also supply `callId` except `prepare`. Writes from the host use the regie client that prepared the call; reads remain available for recovery. After the original host heartbeat has expired (20 seconds), the same authenticated owner may explicitly confirm-return/resume-draw from a new regie client; that recovery action atomically rebinds the host while preserving the hold.

- `GET /api/livekit/settings`: owner-only safe settings `{url,apiKey,apiKeyConfigured,secretConfigured,configured,revision,connectionTest:{tested,testedAt,roomCount?}}`. The API secret is never returned.
- `POST /api/livekit/settings`: `{url,apiKey,apiSecret,revision,action:'save'|'test'}`; a blank secret preserves the saved secret. `action:'test'` really calls LiveKit `ListRooms`; only a successful upstream response returns `tested:true`. Changed credentials reset the previous test. Credentials cannot change during an active call.
- `POST /api/livekit/preflight`: selected family's `{gameId,profileId}` returns `{url,token,room,identity,role:'player',target:'preflight',allowedRemoteIdentities:[],expiresAt,simulated:false}`. This token permits neither publishing nor subscribing, expires after 60 seconds and creates no OpenAI session. Connect and disconnect promptly. Request microphone permission separately in the browser.
- `GET /api/live-calls?...`: `{call,serverTime}`. Families get only their own call. An owner can read the active owner call from another show for recovery; mutations must use that call's own `gameId`.
- `POST /api/live-calls`: `{action,...}` → `{call,serverTime}`; the host response may also contain `game`.
- `POST /api/live-calls/token`: same identifiers plus `target:'backstage'|'live'` → `{url,token,room,identity,role,target,expiresAt,participantIdentity,guestIdentity,outputIdentity,hostIdentity,allowedRemoteIdentities}`. `guestIdentity` aliases `participantIdentity`. Clients strictly accept remote tracks only from their returned allowlist. Tokens expire after 120 seconds.
- `POST /api/live-calls/realtime`: output only, phase `live`, `{sdp}` → `{sdp,realtimeId,serverTime}`. There is at most one AI session per call. No AI session before live; default model `gpt-realtime-2.1-mini` uses the central server-side OpenAI key and the frozen presenter's voice/personality.
- `POST /api/live-calls/realtime-stop`: bound output only; closes its stored AI call. A stale output lease does not prevent teardown. Host cleanup also closes it on termination. A late creation response is immediately closed; an upstream cleanup failure stays retryable and keeps the draw hold.

## State and visibility

`preparing → ringing → backstage → staged → live → returning → returned → completed`.

Refusal, no answer, cancellation, failure or heartbeat loss enters `returning` with `outcome`. The draw hold persists. Only an explicit successful `resume-draw` releases it. Switching from backstage to live temporarily exposes `switchingLive:true`; it is an intentional room teardown, not evidence of a failed call.

The safe snapshot contains `id,version,transport:'livekit',gameId,brandId,entryId,profileId,name,characterId,characterName,realtimeVoice,phase,outcome,reason,createdAt,updatedAt,maxSeconds,ringUntil,liveUntil,muted,drawHeld,checkpoint,context,checks,returnState,media,realtimeStatus,realtimeStopped,voiceLevel,switchingLive,resourcesClosed,cleanupError,simulated:false` and opaque room participant identities. Optional timestamps include `liveAt,endedAt,completedAt`. It contains no API secrets, tokens, account identifiers or private character book.

- `checkpoint = {id,epoch,drawnCount,lastNumber,drawn}`.
- `context = {callName,pronunciation,reason,note,confirmedFacts}`. Only the host sees `note`. Only canonical server results produce `confirmedFacts`; client claims cannot create wins/prizes. Context is frozen when the call goes live and replaced for every next caller.
- `checks = {hostConnected,playerConnected,outputConnected,soundChecked,explanationGiven}`.
- `returnState = {playerConfirmedAt,hostConfirmedAt,method,note}`. Only the host sees the manual return note.
- `media = {host:{connected,micReady,audioReady?},player:{connected,micReady,audioReady?},output:{connected,micReady?,audioReady}}`.
- `realtimeStatus` is absent before creation, then `starting`, `ready` or `failed`. `ready` confirms the server SDP exchange; browser media and playback readiness still require real checks.

## Actions

1. Host `prepare`: `{entryId,characterId,maxSeconds,context:{callName,pronunciation,reason,note}}`. Claims the single owner call, freezes the presenter and atomically installs `game.state.drawHold`. It does not pause the whole show or use legacy `state.callId`: entertainment can continue. Pending draws, open bingo windows and unacknowledged results reject preparation.
2. Host `ring`: enters `ringing`, with a 90-second answer window so the participant can catch up with delayed YouTube. This timeout is never playback proof.
3. Player `answer`: `{checkpointId,cardsUpdated:true,heardLastNumber:checkpoint.lastNumber,youtubeMuted:true}`. The UI must first verify hearing the last number, updating the cards and actually muting/removing YouTube. The answered device is bound to this call; phase becomes `backstage`.
4. Any bound role `heartbeat`: `{connected,micReady,audioReady,target,failed,voiceLevel?}` reports real local media state. Failure enters `returning`; the hold persists. Expected backstage disconnects during `switchingLive` do not fail the call. An output live heartbeat can include actual microphone/presenter `voiceLevel`; the server bounds it to 0–1 for studio lipsync, and resets it on return.
5. Host `backstage-ready`: `{soundChecked:true,explanationGiven:true}` requires connected host/player microphones and records the checks. The phase remains `backstage`.
6. Host `stage`: after the checks, transitions to `staged`. Host `context` edits `{context:{callName,pronunciation,reason,note}}` before live; an edit clears sound/explanation confirmation and returns a staged call to `backstage`.
7. Host `go-live`: `{contextConfirmed:true}`. The server first revokes both backstage identities and deletes the private room, then enters `live`. The output never has a private-room token. The host is subscribe-only in the live room. The output waits for real selected-player audio/readiness before starting OpenAI. A live phase alone does not prove working audio.
8. Host `mute`: `{muted:boolean}` changes actual Cloud publishing permission and the local output gate. Unmuting requires the player client to restore its microphone publication.
9. Host/player `finish`: ends backstage/staged/live into `returning`. Host/player `cancel`, player `decline`, any role `fail` also retain the hold. End/failure cleanup closes rooms and AI; failed cleanup is visible and retryable.
10. Player `player-returned`: `{confirmed:true,checkpointId,youtubeReady:true,youtubeAudible:true}` or `playbackInfo:{ready:true,audible:true,...}` after restored playback. Explicit parent confirmation is supported when the iframe API is unavailable; a timer alone is insufficient.
11. Host `confirm-return`: `{confirmed:true}` after player confirmation enters `returned`. Without it, `{confirmed:true,manual:true,note:'meaningful verification ...'}` records how the regie actually checked the return. No draw release yet.
12. Host `resume-draw`: requires `returned`, host confirmation, completed resource cleanup and the same authoritative hold. It releases `drawHold` and completes the call. It never automatically draws a number. An open bingo window remains protected.

Fresh studio output ownership is required for preparation, going live and creating media. Returning and resuming remain possible after an output failure. Backstage rooms accept only host and selected participant. Live rooms accept only selected participant, output and a subscribe-only host. All publishing is microphone/audio only; data publishing is disabled. Room names and participant identities use opaque call identifiers, never child names or email addresses.
