const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function app() {
  const elements = new Map();
  const handlers = {};
  const makeElement = () => ({
    style: {}, children: [], innerHTML: '', value: '',
    appendChild(child) { this.children.push(child); },
    play() { return Promise.resolve(); },
    pause() { throw new Error('Audio must not be paused on hide'); }
  });
  const document = {
    hidden: false,
    getElementById(id) {
      if (id.startsWith('m-')) return null;
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement: makeElement,
    querySelectorAll: () => [],
    addEventListener: (name, fn) => { handlers[name] = fn; }
  };
  const context = vm.createContext({
    document, window: { addEventListener() {} },
    supabase: { createClient: () => ({}) },
    console, alert() {}, setTimeout() {}, clearInterval() {}
  });
  vm.runInContext(source, context);
  return { context, document, handlers, run: code => vm.runInContext(code, context) };
}
test('untrusted messages and style values cannot create markup', () => {
  const a = app();
  a.run(`renderMsg({id:'test',username:'<img src=x onerror=alert(1)>',
    message:'<svg onload=alert(1)>',name_color:'red;" onmouseover="x',
    text_color:'red',font_size:'1px;" onclick="x'});`);
  const rendered = a.document.getElementById('chat-win').children[0].innerHTML;
  assert.ok(rendered.includes('&lt;svg'));
  assert.ok(rendered.includes('&lt;img'));
  assert.ok(!rendered.includes('<svg'));
  assert.ok(!rendered.includes('onmouseover='));
  assert.ok(rendered.includes('font-size:17px'));
});
test('online usernames are escaped and self marker uses peer id', () => {
  const a = app();
  a.run(`myName='same';myPeerId='self';renderOnlineUsers([
    {username:'<img src=x>',peer_id:'other'},
    {username:'same',peer_id:'other2'}]);`);
  const rows = a.document.getElementById('user-list').children;
  assert.ok(rows[0].innerHTML.includes('&lt;img'));
  assert.ok(!rows[1].innerHTML.includes('(我)'));
});
test('muting microphone keeps incoming call alive', () => {
  const a = app();
  a.run(`myStream={getAudioTracks:()=>[track]};isMic=true;
    updateOnlineStatus=()=>{};logUserEvent=()=>{};
    activeCalls.set('remote',{close(){throw Error('closed');}});`);
  a.context.track = { enabled: true };
  a.run('toggleMic()');
  assert.equal(a.context.track.enabled, false);
  assert.equal(a.run('activeCalls.size'), 1);
});
test('history selects newest 30 then renders oldest first', async () => {
  const a = app();
  a.run(`globalThis.rendered=[];renderMsg=row=>rendered.push(row.id);
    client.from=()=>({select:()=>({order:(column,options)=>{
      if(options.ascending!==false)throw Error('wrong order');
      return {limit:async n=>{if(n!==30)throw Error('wrong limit');
        return {data:[{id:3},{id:2},{id:1}],error:null};}};
    }})});`);
  await a.run('loadHistory()');
  assert.deepEqual(Array.from(a.context.rendered), [1,2,3]);
});
test('hidden document does not pause audio', () => {
  const a = app();
  a.document.hidden = true;
  a.document.querySelectorAll = () => [{ pause() { throw Error('paused'); } }];
  a.handlers.visibilitychange();
});
test('muted speaker also silences notification sound', () => {
  const a = app();
  a.run(`isSpk=false;audioCtx={createOscillator(){throw Error('beep');}};playDingDing();`);
});
