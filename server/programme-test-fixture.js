// Only the root-only staging CLI creates this marker. A normal show creation
// request never copies these fields from browser input.
export const PROGRAMME_FIXTURE_TAG='milo-staging-media-v1';
export const programmeFixtureUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function isProgrammeTestFixture(game){const tag=game?.technicalFixture;return game?.testOnly===true&&tag?.tag===PROGRAMME_FIXTURE_TAG&&tag.hidden===true&&tag.gameId===game.id&&tag.ownerId===game.ownerId&&programmeFixtureUuid(game.id)&&programmeFixtureUuid(game.ownerId)&&programmeFixtureUuid(tag.marker);}
