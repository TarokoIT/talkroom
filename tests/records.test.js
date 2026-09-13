import {test} from 'node:test';
import assert from 'node:assert/strict';
import {csvCell,recordsCsv,keywordsFrom} from '../records-core.js';
test('CSV preserves multiline and quotes and neutralizes formulas',()=>{
 assert.equal(csvCell('task\n"301"'),'"task\n""301"""');
 assert.equal(csvCell(' =HYPERLINK("x")'),'"\' =HYPERLINK(""x"")"');
 assert.equal(csvCell('@SUM(A1)'),'"\'@SUM(A1)"');
 assert.ok(recordsCsv([{created_at:'2026-01-01T16:00:00Z',room:'HK',room_title:'房務',username:'QA',content:'1. 毛巾\n2. 水'}]).includes('2026-01-02 00:00:00'));
 assert.deepEqual(keywordsFrom('毛巾， 301,\n 水'),['毛巾','301','水']);
});

test('response export contains both named timelines with Taiwan dates and safe cells',()=>{
 const csv=recordsCsv([{created_at:'2026-09-13T00:00:00Z',room:'HK',room_title:'房務',username:'QA',content:'派工',received:[{username:'=danger',created_at:'2026-09-13T01:02:03Z'}],completed:[{username:'LG',created_at:'2026-09-13T02:03:04Z'}]}]);
 assert.ok(csv.includes('收到（姓名／台灣時間）'));assert.ok(csv.includes('完成（姓名／台灣時間）'));
 assert.ok(csv.includes("'=danger · 2026-09-13 09:02:03"));assert.ok(csv.includes('LG · 2026-09-13 10:03:04'));
});
