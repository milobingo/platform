#!/usr/bin/env python3
"""Offline technical Dutch speech: 75 numbered 15-second slots; no API calls."""
import argparse
import array
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--espeak', required=True, help='Exact local eSpeak NG binary')
    parser.add_argument('--data-parent', help='Directory containing espeak-ng-data, for rootless extraction')
    parser.add_argument('--output', required=True, help='Private WAV outside Git')
    args = parser.parse_args()
    command = [args.espeak]
    if args.data_parent:
        command.append('--path='+str(Path(args.data_parent).resolve()))
    version = subprocess.run([*command,'--version'],check=True,capture_output=True,text=True).stdout
    if 'text-to-speech: 1.51 ' not in version:
        raise SystemExit('Gebruik de gedocumenteerde eSpeak NG 1.51 voor dit reproduceerbare profiel.')
    output = Path(args.output).resolve()
    if output.exists():
        raise SystemExit('Doelbestand bestaat al; kies een nieuw privaat bestand.')
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    words = ['één','twee','drie','vier','vijf','zes','zeven','acht','negen','tien','elf','twaalf','dertien','veertien','vijftien','zestien','zeventien','achttien','negentien']
    tens = {20:'twintig',30:'dertig',40:'veertig',50:'vijftig',60:'zestig',70:'zeventig'}
    def dutch(number):
        if number < 20:
            return words[number-1]
        unit = number % 10
        return tens[number-unit] if not unit else words[unit-1].replace('één','een')+('ën' if unit in (2,3) else 'en')+tens[number-unit]
    cues = []
    with tempfile.TemporaryDirectory(prefix='milo-speech-') as temp:
        clips = []
        rate = None
        for number in range(1,76):
            text = f'Technische proef. Nummer {dutch(number)}. {dutch(number)}!'
            clip = Path(temp)/f'{number}.wav'
            subprocess.run([*command,'-v','nl','-s','155','-w',str(clip),text],check=True,capture_output=True)
            with wave.open(str(clip),'rb') as speech:
                if speech.getnchannels()!=1 or speech.getsampwidth()!=2 or speech.getcomptype()!='NONE':
                    raise SystemExit('Onverwacht PCM-formaat van eSpeak.')
                rate = rate or speech.getframerate()
                if speech.getframerate()!=rate:
                    raise SystemExit('De fragmenten hebben verschillende samplefrequenties.')
                samples = array.array('h',speech.readframes(speech.getnframes()))
            if sys.byteorder!='little':
                samples.byteswap()
            if len(samples)>15*rate:
                raise SystemExit('Een uitgesproken nummer past niet in zijn 15-seconden cue.')
            peak = max(abs(value) for value in samples)
            if peak<100:
                raise SystemExit('De opgenomen technische spraak is stil.')
            samples = array.array('h',(round(value*24575/peak) for value in samples))
            cues.append({'number':number,'startsAtSeconds':(number-1)*15,'spokenSeconds':len(samples)/rate,'text':text})
            if sys.byteorder!='little':
                samples.byteswap()
            clips.append(samples.tobytes()+bytes((15*rate-len(samples))*2))
        descriptor=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'wb') as raw:
            with wave.open(raw,'wb') as track:
                track.setnchannels(1);track.setsampwidth(2);track.setframerate(rate)
                for clip in clips:
                    track.writeframes(clip)
    proof={'format':'milo-offline-source-speech-v1','generator':'eSpeak NG 1.51, voice nl, speed155; technical synthetic speech, not Milo voice','apiCalls':0,'cueSeconds':15,'cueCount':75,'durationSeconds':1125,'sampleRate':rate,'channels':1,'sampleWidthBytes':2,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'cues':cues}
    metadata=output.with_suffix('.json')
    metadata.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');metadata.chmod(0o600)
    print(json.dumps({key:value for key,value in proof.items() if key!='cues'}))


if __name__=='__main__':
    main()
