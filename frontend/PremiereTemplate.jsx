import React from 'react';
import {BookOpen,Plus} from 'lucide-react';
import {Button} from './components.jsx';

export default function PremiereTemplate({s,operator,run}){
 if(s.production!=='milo')return null;
 return <details className="mf-premiere-template">
  <summary><BookOpen size={17}/> Draaiboek uit de bijlage gebruiken</summary>
  <p>Maak een nieuw concept van <strong>Milo’s Magische Première</strong>: 26 showmomenten, vier rondekaarten, tien prijsstappen, twee trucs, Professor Piko met vijf dialoogbeurten en twintig losse spreekkaarten.</p>
  <p>Gepland op 2 december 2026 om 13:30. De countdown duurt één minuut; start die om 13:29. Reken op ongeveer anderhalf uur met uitloop. Controleer de datum, alle tien prijzen en boekjes voordat je audio voorbereidt.</p>
  <Button icon={Plus} disabled={s.working||s.game.status==='running'} onClick={()=>run(()=>operator.createPremiereShow())}>Nieuw première-draaiboek maken</Button>
  <small>Dit maakt een aparte show. Je huidige draaiboek en boekjes blijven bewaard. Spreekkaarten voor uitslagen worden pas beschikbaar als de server de juiste status bevestigt.</small>
 </details>;
}
