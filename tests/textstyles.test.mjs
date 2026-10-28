import test from 'node:test';
import assert from 'node:assert/strict';
import { remapStyles } from '../js/diagram/textstyles.mjs';
const red = { color: '#ff0000' }, bold = { bold: true };
test('挿入と削除で前後の書式を保つ', () => {
  const source = [bold, bold, null, red, red];
  assert.deepEqual(remapStyles('abcde', 'abXcde', source), [bold, bold, bold, null, red, red]);
  assert.deepEqual(remapStyles('abcde', 'abde', source), [bold, bold, red, red]);
});
test('書式なしの文章と空文字を扱う', () => {
  assert.deepEqual(remapStyles('abc', 'abcd', []), []);
  assert.deepEqual(remapStyles('a', '', [red]), []);
});
test('日本語と絵文字の後の書式を保つ', () => {
  const before = '温😀度', styles = [bold, null, null, red];
  assert.deepEqual(remapStyles(before, '温😀の度', styles), [bold, null, null, null, red]);
});
