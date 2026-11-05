Historische auth-tests uit de overdracht

check-player-auth-resend-legacy.mjs is de oorspronkelijke, ongewijzigde testcode
voor zelf gegenereerde OTP-codes, directe Resend-mail en player_sessions. Dit
bestand is alleen als historische bron bewaard; de imports zijn geen actief
uitvoerbaar test-entrypoint op deze archieflocatie.

scripts/check-player-auth.mjs voert nu de actuele Supabase-runtimecontracttests
uit tests/check-node-runtime.mjs uit, plus aanvullende geboortedatum- en
profieleigendomstests. De runtimecontracttests gebruiken expliciete Supabase-
providermocks voor OTP-aanvraag/verificatie, sessiecookies, private serverrollen,
OAuth/PKCE-callbacks, veilige redirects, CSRF en afwijzing van oude identiteiten.

De oude Resend-providerasserties zijn vervangen omdat de huidige applicatie geen
OTP-codes of OTP-rate limits zelf implementeert. Codegeneratie, geldigheid en
provider-rate limits behoren nu tot Supabase Auth. De mocks bewijzen het lokale
integratiecontract; de echte providerbeveiliging en mailaflevering worden pas
geverifieerd met de nog aan te leveren projectconfiguratie. Tijdens deze lokale
build zijn daarvoor geen accounts aangemaakt of externe requests uitgevoerd.
