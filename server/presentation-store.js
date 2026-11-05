import {defaultPresentation,normalizePresentation} from './presentation-model.js';
export class PresentationStore {
 constructor(db){this.db=db;}
 async read(owner){const row=await this.db.prepare('SELECT revision,document,updated_at FROM presentation_workspaces WHERE owner_id=?').bind(owner).first();return row?{document:normalizePresentation(JSON.parse(row.document)),revision:row.revision,updatedAt:row.updated_at}:{document:defaultPresentation(),revision:0,updatedAt:null};}
 async save(owner,document,revision){const next=revision+1,updatedAt=new Date().toISOString(),raw=JSON.stringify(document);const row=revision===0?await this.db.prepare('INSERT INTO presentation_workspaces (owner_id,revision,document,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO NOTHING RETURNING revision').bind(owner,next,raw,updatedAt).first():await this.db.prepare('UPDATE presentation_workspaces SET revision=?,document=?,updated_at=? WHERE owner_id=? AND revision=? RETURNING revision').bind(next,raw,updatedAt,owner,revision).first();return row?{revision:row.revision,updatedAt}:null;}
}
