import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { finalizePhoto,stagePhoto,type PrivateEvidenceStore } from '../backend/modules/compliance/photoEvidence.ts';

test('private photo staging and finalization verify bytes and refuse unconfigured evidence', async () => {
  const items = new Map<string,ArrayBuffer>();
  const store: PrivateEvidenceStore = {
    async put(key,bytes) { items.set(key,Uint8Array.from(bytes).buffer); },
    async get(key) { const bytes = items.get(key); return bytes ? {async arrayBuffer(){return bytes.slice(0);}} : null; },
  };
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC','base64'));
  assert.deepEqual(await stagePhoto(store,'staged',png,'image/jpeg',null),{error:'EVIDENCE_INVALID'});
  assert.deepEqual(await stagePhoto(store,'staged',png,'image/jpeg',200),{error:'EVIDENCE_INVALID'});
  assert.deepEqual(await stagePhoto(store,'staged',png,'image/jpeg',5),{error:'UPLOAD_TOO_LARGE'});
  assert.equal(items.size,0);
  assert.deepEqual(await stagePhoto(store,'staged',png,'image/png',200),{staged:true});
  assert.deepEqual(await finalizePhoto(store,'staged','final','image/jpeg',5),{error:'UPLOAD_TOO_LARGE'});
  assert.deepEqual(await finalizePhoto(store,'staged','final','image/png',200),
    {byteLength:png.length,mediaType:'image/png',sha256:createHash('sha256').update(png).digest('hex')});
  assert.deepEqual(new Uint8Array(items.get('final')!),png);
});
