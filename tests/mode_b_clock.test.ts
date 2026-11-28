import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessModeBClock} from '../scripts/p0/modeBClock.ts';

test('clock check rejects skew, delayed requests and unsafe manifest edges',()=>{
 const now=Date.parse('2026-11-23T10:00:00.000Z');
 const sample={localBefore:now,localAfter:now+1000,d1Time:now+500,issuedAt:now-60000,expiresAt:now+120000};
 assert.equal(assessModeBClock(sample).ok,true);
 assert.equal(assessModeBClock({...sample,d1Time:now+61001}).ok,false);
 assert.equal(assessModeBClock({...sample,issuedAt:now-10000}).ok,false);
 assert.equal(assessModeBClock({...sample,expiresAt:now+10000}).ok,false);
 assert.equal(assessModeBClock({...sample,localAfter:now-1}).ok,false);
 assert.equal(assessModeBClock({...sample,localAfter:now+10000}).ok,false);
});
