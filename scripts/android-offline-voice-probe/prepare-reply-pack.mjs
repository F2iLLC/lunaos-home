// Only generic generated prompts are accepted. Never use household audio/transcripts.
// node prepare-reply-pack.mjs external-batches.json new-external-output-directory
// batches: [{start: manifest index, count, audioFile, wordsFile}]
// wordsFile is ElevenLabs Scribe's word-timing JSON for that generated batch.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const source = dirname(fileURLToPath(import.meta.url));
const checkout = resolve(source, '../..');
const [batchFile, destination] = process.argv.slice(2);
if (!batchFile || !destination) throw Error('Specify batches JSON and a new external output directory.');
const output = resolve(destination), rel = relative(checkout, output);
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)) || existsSync(output))
  throw Error('Choose a new output directory outside Git.');
const manifest = JSON.parse(readFileSync(join(source, 'reply-prompts.json')));
const batches = JSON.parse(readFileSync(batchFile));
const small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
function number(n) { return n < 20 ? small[n] : ['','','twenty','thirty','forty','fifty','sixty'][Math.floor(n/10)] + (n%10 ? ' '+small[n%10] : ''); }
function tokens(text) { return text.toLowerCase().replace(/\d+/g, n => number(Number(n))).replace(/[^a-z]+/g,' ').trim().split(/\s+/); }
const prepared = [], seen = new Set();
// Validate every word before writing any output. Extra or missing speech fails closed.
for (const batch of batches) {
  if (!Number.isInteger(batch.start) || !Number.isInteger(batch.count) || batch.count < 1) throw Error('Invalid batch range.');
  const words = JSON.parse(readFileSync(batch.wordsFile)).words.filter(w => !w.type || w.type === 'word');
  const actual = words.flatMap(w => tokens(w.text).map(text => ({text,start:w.start,end:w.end})));
  let cursor = 0;
  for (let i = batch.start; i < batch.start + batch.count; i++) {
    const clip = manifest[i];
    if (!clip || seen.has(i)) throw Error('Overlapping or invalid batch range.');
    const expected = tokens(clip.text), begin = cursor;
    for (const text of expected) {
      if (actual[cursor]?.text !== text) throw Error('Generated speech differs for '+clip.id+' at word '+cursor+': expected '+text+', got '+actual[cursor]?.text);
      cursor++;
    }
    const first = actual[begin], last = actual[cursor-1];
    // Some takes articulate the explicit separator tag. It is discarded, never bundled.
    // Its word times still bound the cut so no separator can leak into a reply.
    const start = Math.max(0, first.start - 0.06, begin ? (actual[begin-1].end + first.start)/2 : 0);
    const end = Math.min(last.end + 0.1, actual[cursor] ? (last.end+actual[cursor].start)/2 : last.end+0.1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end-start < 0.1 || end-start > 12) throw Error('Invalid clip timing.');
    prepared.push({...clip,audioFile:batch.audioFile,start,end}); seen.add(i);
    if (i < batch.start + batch.count - 1 && actual[cursor]?.text === 'long' && actual[cursor+1]?.text === 'pause') cursor += 2;
  }
  if (cursor !== actual.length) throw Error('Unexpected extra speech after batch.');
}
if (seen.size !== manifest.length) throw Error('Incomplete reply pack.');
mkdirSync(output, {recursive:true});
const clips = [];
for (const clip of prepared) {
  const pcm = execFileSync('ffmpeg', ['-v','error','-i',clip.audioFile,'-ss',String(clip.start),'-t',String(clip.end-clip.start),'-f','s16le','-acodec','pcm_s16le','-ac','1','-ar','24000','pipe:1'],{windowsHide:true,maxBuffer:1024*1024});
  if (pcm.length < 4800 || pcm.length > 576000 || pcm.length%2) throw Error('Invalid rendered PCM.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36+pcm.length,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22);
  header.writeUInt32LE(24000,24); header.writeUInt32LE(48000,28); header.writeUInt16LE(2,32);
  header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40);
  const wav=Buffer.concat([header,pcm]); writeFileSync(join(output,clip.id+'.wav'),wav);
  clips.push({id:clip.id,text:clip.text,sha256:createHash('sha256').update(wav).digest('hex')});
}
writeFileSync(join(output,'pack.json'),JSON.stringify({provider:'ElevenLabs',clips},null,2));
console.log('Prepared '+clips.length+' verified generic reply clips outside Git.');
