import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homeAvatarState, homeCommandReady, notebookAvatarState } from '../src/luna/presentation.js';

const snapshot = (fields = {}) => ({ status:'ready', listeningEnabled:true, listeningStatus:'enabled', capturePhase:'waiting', replyPlaying:false, ...fields });

test('Home event mapping distinguishes deliberate sleep, listening, processing, playback and failures',()=>{
  assert.equal(homeAvatarState(snapshot({listeningEnabled:false,listeningStatus:'disabled',capturePhase:'off'})),'sleeping');
  assert.equal(homeAvatarState(snapshot({listeningStatus:'permission',capturePhase:'off'})),'error');
  assert.equal(homeAvatarState(snapshot({listeningStatus:'muted',capturePhase:'off'})),'error');
  assert.equal(homeAvatarState(snapshot({listeningStatus:'locked',capturePhase:'off'})),'error');
  assert.equal(homeAvatarState(snapshot({listeningStatus:'disconnected',capturePhase:'off'})),'error');
  assert.equal(homeAvatarState(snapshot({capturePhase:'waiting'})),'idle');
  assert.equal(homeAvatarState(snapshot({capturePhase:'awake'})),'listening');
  assert.equal(homeAvatarState(snapshot({capturePhase:'preparing'})),'thinking');
  assert.equal(homeAvatarState(snapshot({capturePhase:'review'})),'thinking');
  assert.equal(homeAvatarState(snapshot({capturePhase:'response',replyPlaying:false})),'thinking');
  assert.equal(homeAvatarState(snapshot({capturePhase:'response',replyPlaying:true})),'talking');
  assert.equal(homeAvatarState(snapshot({capturePhase:'retry'})),'thinking');
  assert.equal(homeAvatarState(snapshot({capturePhase:'off'})),'idle');
  assert.equal(homeAvatarState(snapshot({listeningEnabled:false,listeningStatus:'disabled',capturePhase:'response',replyPlaying:true})),'talking');
  assert.equal(homeAvatarState(snapshot({listeningEnabled:false,listeningStatus:'disabled',capturePhase:'response',replyPlaying:false})),'thinking');
  assert.equal(homeAvatarState(snapshot({listeningEnabled:false,listeningStatus:'disabled',capturePhase:'off',activeTimers:[{remainingSeconds:0}]})),'working');
  assert.equal(homeAvatarState(snapshot({listeningEnabled:false,listeningStatus:'disabled',capturePhase:'off',activeTimers:[{remainingSeconds:5}]})),'sleeping');
  assert.equal(homeAvatarState({status:'unavailable',listeningStatus:'disabled'}),'error');
});

test('command-ready cue only follows the authoritative awake capture window',()=>{
  assert.equal(homeCommandReady(snapshot({capturePhase:'awake'})),true);
  for(const value of [
    snapshot({capturePhase:'waiting'}),
    snapshot({capturePhase:'awake',listeningStatus:'disabled'}),
    snapshot({capturePhase:'awake',status:'unavailable'}),
    snapshot({capturePhase:'awake',activeTimers:[{remainingSeconds:0}]}),
    snapshot({capturePhase:'response',replyPlaying:true}),
  ]) assert.equal(homeCommandReady(value),false);
});

test('command-ready pill has a visible pulse that stops for reduced motion',async()=>{
  const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/#home-luna\[data-command-ready="true"\] #home-luna-state::before/);
  assert.match(css,/@keyframes command-ready-pulse/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\) \{ #home-luna\[data-command-ready="true"\] #home-luna-state::before \{ animation:none/);
});

test('notebook only celebrates confirmed outcomes and marks failed or uncertain outcomes as errors',()=>{
  assert.equal(notebookAvatarState({success:true}),'happy');
  assert.equal(notebookAvatarState({success:false}),'error');
  assert.equal(notebookAvatarState(undefined),'idle');
});
