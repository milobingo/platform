import {bingoNumberText,SPEECH_POLICY_VERSION} from './bingo-speech.js';

// Only the immutable server commit identifies an official announcement. A
// reservation, selected ball or caption is deliberately not a valid source.
export function officialBallBinding(game,commit=game?.state?.lastCommit){
 const state=game?.state;
 if(!game?.id||!state||typeof commit?.token!=='string'||!commit.token||!Number.isInteger(commit.number)||commit.number<1||commit.number>75||!Number.isInteger(commit.index)||commit.index<1||!Number.isFinite(commit.at)||!Number.isInteger(state.roundIndex)||state.roundIndex<0||typeof state.epoch!=='string'||!state.epoch||!Array.isArray(state.drawn)||state.drawn[commit.index-1]!==commit.number)return null;
 return Object.freeze({gameId:game.id,roundIndex:state.roundIndex,epoch:state.epoch,commitId:commit.token,index:commit.index,number:commit.number,at:commit.at,policyVersion:SPEECH_POLICY_VERSION});
}
export const officialBallKey=ball=>ball?['ball',ball.gameId,ball.roundIndex,ball.commitId].join(':'):null;
export function sameOfficialBall(a,b){return !!a&&!!b&&officialBallKey(a)===officialBallKey(b)&&a.epoch===b.epoch&&a.number===b.number&&a.index===b.index&&a.at===b.at&&a.policyVersion===b.policyVersion;}
export function officialVoiceMatches(command,snapshot){
 if(!command?.officialBall)return true;
 const ball=command.officialBall;
 return sameOfficialBall(ball,snapshot?.officialBall)&&snapshot.gameId===ball.gameId&&snapshot.lastNumber===ball.number&&snapshot.drawn?.[ball.index-1]===ball.number&&command.text===bingoNumberText(ball.number,'milo')&&command.preparedOnly===true&&ball.policyVersion===SPEECH_POLICY_VERSION;
}
