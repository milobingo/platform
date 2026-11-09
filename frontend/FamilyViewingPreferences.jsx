import React,{useSyncExternalStore} from 'react';
export default function FamilyViewingPreferences({preferences,onChange,controller,demo=false,callActive=false}){
 const player=useSyncExternalStore(controller.subscribe,controller.getSnapshot),pending=player.framePresent&&player.captionsApplied!==preferences.captions;
 return <section className="fam-view-preferences" aria-labelledby="fam-view-heading"><h3 id="fam-view-heading">Beeld en ondertiteling</h3>
  <label><input type="checkbox" checked={preferences.reducedMotion} onChange={event=>onChange({...preferences,reducedMotion:event.target.checked})}/><span><strong>Rustige animaties</strong><small>Minder beweging; alle nummers, patronen en meldingen blijven zichtbaar.</small></span></label>
  <label><input type="checkbox" checked={preferences.captions} onChange={event=>onChange({...preferences,captions:event.target.checked})}/><span><strong>YouTube-ondertiteling bij openen aanvragen</strong><small>Voorkeur voor Nederlands. Alleen beschikbaar wanneer de uitzending een ondertiteltrack aanbiedt.</small></span></label>
  <p role="status">{demo?'De demo heeft geen gesproken uitzending of ondertiteltrack. Je voorkeur wordt wel op dit apparaat bewaard.':pending?'Je voorkeur is bewaard. Gebruik de CC-knop in de video of pas je voorkeur hieronder bewust toe.':player.framePresent?(player.captionsApplied?'Ondertiteling is bij YouTube aangevraagd. Controleer de CC-knop in de video; beschikbare talen en tracks worden door YouTube bepaald.':'YouTube bepaalt de huidige ondertiteling. Met de CC-knop in de video kun je een beschikbare track aan- of uitzetten.'):'Je voorkeur geldt zodra een YouTube-uitzending opent.'}</p>
  {!demo&&pending&&<button type="button" className="fam-button secondary" disabled={callActive||player.suspended} onClick={()=>controller.applyCaptionPreference()}>CC-voorkeur op video toepassen</button>}
  {!demo&&pending&&<small>Dit opent de video opnieuw. Tijdens een belmoment is dit geblokkeerd. Uitvinken herstelt de eigen YouTube-voorkeur; de CC-knop schakelt ondertiteling werkelijk uit.</small>}
  <p className="fam-view-device">Alleen op dit apparaat, apart voor iedere showwereld. Ook je apparaatinstelling voor minder beweging blijft gelden. Het officiële ballenbord is geen spraakondertitel.</p>
 </section>;
}
