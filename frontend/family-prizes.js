// Family-facing awards are already projected by the server. Keep the main
// winner's ownership separate from an optional consolation in the same result.
export function familyPrizeAwards(results = []) {
  const awards = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (result?.acknowledged !== true) continue;
    if (result.winner && result.prize) awards.push({
      id: result.id,
      resultId: result.id,
      kind: 'main',
      winner: result.winner,
      prize: result.prize,
      mine: result.mine === true,
      delivered: result.delivered === true,
      deliveredAt: result.deliveredAt ?? null,
    });
    for (const award of Array.isArray(result.consolations) ? result.consolations : []) {
      if (!award?.id || !award.prize) continue;
      awards.push({
        id: award.id,
        resultId: result.id,
        kind: 'consolation',
        winner: { name: award.name, ticket: award.ticket, bookId: award.bookId },
        prize: award.prize,
        mine: award.mine === true,
        delivered: award.delivered === true,
        deliveredAt: award.deliveredAt ?? null,
      });
    }
  }
  return awards;
}
