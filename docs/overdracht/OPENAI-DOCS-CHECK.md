# OpenAI-contractcontrole — 4 november 2026

Dit is een documentatiecontrole zonder API-sleutel of echte providersessie. De bron gebruikt `gpt-live-1` in `server/gpt-live.js`; enkele oudere documenten noemen nog Realtime-modellen. De modelnaam en Live-sessieroute zijn in de actuele officiële documentatie teruggevonden. Dat bewijst geen modeltoegang, tegoed, custom voice of hoorbare audio op het account van dit project.

| Controle | Bron en betekenis |
|---|---|
| Model | https://developers.openai.com/api/docs/models/gpt-live-1 — de modelpagina beschrijft GPT-Live 1 en het Live-endpoint. |
| WebRTC-sessie | https://developers.openai.com/api/reference/resources/live/methods/create — de gedocumenteerde route gebruikt een serververzoek met sessieconfiguratie en WebRTC/SDP-transport. Het antwoord heeft een sessie-ID en SDP-antwoord. |
| Browserverbinding | https://developers.openai.com/api/docs/guides/voice-webrtc — de server wisselt het browseraanbod uit; de API-sleutel blijft op de server. Wacht op de startbevestiging voordat applicatiecommando’s worden verstuurd. |
| Server-WebSocket | https://developers.openai.com/api/reference/resources/live/primary-websocket — beschrijft de primaire backendverbinding. |

De globale vorm van het WebRTC-verzoek/antwoord in `createLivePeer()` sluit aan op deze documentatie. Dit is geen volledige contractaudit van alle eventnamen, spraakvoorbereiding, stemmen, sessieafsluiting of toekomstige API-wijzigingen. Laat Codex de op dat moment geldende contracten controleren en start/hoor/stop expliciet met de werkelijke accountinstellingen testen. Een geslaagde offline mocktest of model-statusaanvraag is daarvoor onvoldoende.

Behoud de gekozen GPT-Live-opzet. Meng verouderde Realtime- en Live-contracten niet op basis van historische namen in UI, veldnamen of README. Verander de provider/modelkeuze alleen vanuit de werkelijke opdracht en bewezen compatibiliteit. De centrale sleutel en geprivilegieerde sessieconfiguratie horen nooit in het browserpakket.
