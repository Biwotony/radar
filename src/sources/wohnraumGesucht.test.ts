import assert from 'node:assert/strict';
import test from 'node:test';

import { parseIndexHtml, WohnraumGesuchtSource } from './wohnraumGesucht.js';

test('extracts metadata without retaining an exact street address', async () => {
  const html = `
    <html>
      <body>
        <a href="/wohnraumangebote?tx_powermail_pi2%5Baction%5D=show&amp;tx_powermail_pi2%5Bcontroller%5D=Output&amp;tx_powermail_pi2%5Bmail%5D=83031">
          4-Zimmer in einer 4-Zimmerwohnung
          in Lucaestraße 15, 60433 Frankfurt am Main,
          frei ab: 01.09.2026
        </a>
      </body>
    </html>
  `;

  const [item] = parseIndexHtml(html);

  assert.ok(item);
  assert.equal(item.externalId, '83031');
  assert.equal(item.roomType, '4-Zimmer in einer 4-Zimmerwohnung');
  assert.equal(item.area, '60433 Frankfurt am Main');
  assert.equal(item.availableFromRaw, '01.09.2026');
  assert.equal(item.sourceUrl.includes('Lucaestra'), false);

  const observation = await new WohnraumGesuchtSource().parse(item);
  assert.deepEqual(observation.extractedFacts.area, {
    value: '60433 Frankfurt am Main',
    status: 'CONFIRMED',
    evidence: '60433 Frankfurt am Main',
  });
});

test('drops likely street-level area metadata when no safe locality can be extracted', () => {
  const html = `
    <a href="/wohnraumangebote?tx_powermail_pi2%5Bmail%5D=90001">
      1-Zimmerwohnung in Musterstraße 12, frei ab: sofort
    </a>
  `;

  const [item] = parseIndexHtml(html);

  assert.ok(item);
  assert.equal(item.area, null);
  assert.equal(item.availableFromRaw, 'sofort');
});

test('deduplicates repeated anchors for the same source listing id', () => {
  const href = '/wohnraumangebote?tx_powermail_pi2%5Bmail%5D=90002';
  const html = `
    <a href="${href}">1-Zimmerwohnung in Frankfurt, frei ab: 01.10.2026</a>
    <a href="${href}">1-Zimmerwohnung in Frankfurt, frei ab: 01.10.2026</a>
  `;

  const items = parseIndexHtml(html);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.externalId, '90002');
  assert.equal(items[0]?.area, 'Frankfurt');
});
