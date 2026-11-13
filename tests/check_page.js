// check_page.js
// Clicks every control on the site (question list, start page, receipt, court,
// tomatoes, state tiles, state picker) on a desktop and a phone screen, and
// checks each one does what it should, comparing counts with the API.
//
// Needs Node and Playwright. Start the app first (python app.py), then run:
// node tests/check_page.js
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:5000/';
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + msg); } };
const api = async (p, u) => (await (await p.request.get(BASE.replace(/\/$/, '') + u)).json());
const txt = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent.trim(), sel);
const visibleTab = (p) => p.evaluate(() => [...document.querySelectorAll('.pane > .ch')].filter(s => !s.hidden).map(s => s.dataset.tab).join(','));
const setState = (p, v) => p.evaluate((v) => { const s = document.getElementById('state'); s.value = v; s.dispatchEvent(new Event('change')); }, v);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);

  // Question list ----
  ok(await visibleTab(p) === 'start', 'opens on the start tab');
  ok(!(await p.evaluate(() => document.body.classList.contains('nav-closed'))), 'list is open on start');
  for (const t of ['bill', 'court', 'red', 'hit', 'start']) {
    if (t !== 'start' && await p.evaluate(() => document.body.classList.contains('nav-closed'))) await p.click('#q-close');
    await p.waitForTimeout(400);
    await p.click(`#q-list a[data-tab="${t}"]`); await p.waitForTimeout(500);
    ok(await visibleTab(p) === t, `question link opens ${t}`);
    ok(await p.evaluate((t) => document.querySelector(`#q-list a[data-tab="${t}"]`).classList.contains('on'), t), `${t} is marked current`);
    ok(await p.evaluate(() => location.hash.slice(1)) === t, `address bar shows #${t}`);
    ok(await p.evaluate(() => document.body.classList.contains('nav-closed')) === (t !== 'start'), `list ${t === 'start' ? 'stays open' : 'closes'} on ${t}`);
  }
  // close, open, rail state chip, brand
  await p.click('#q-close'); await p.waitForTimeout(450);
  ok(await p.evaluate(() => document.body.classList.contains('nav-closed')), 'Close closes the list');
  ok(await txt(p, '.q-close-label') === 'Questions', 'closed control reads Questions');
  await p.click('#q-close'); await p.waitForTimeout(450);
  ok(!(await p.evaluate(() => document.body.classList.contains('nav-closed'))), 'Questions reopens the list');
  await p.click('#q-close'); await p.waitForTimeout(450);
  await p.click('#rail-state'); await p.waitForTimeout(600);
  ok(!(await p.evaluate(() => document.body.classList.contains('nav-closed'))), 'ALL chip opens the list');
  ok(await p.evaluate(() => document.activeElement.id) === 'state', 'ALL chip puts focus on the state picker');
  await p.click('#q-list a[data-tab="court"]'); await p.waitForTimeout(400);
  await p.goBack(); await p.waitForTimeout(500);
  ok(await visibleTab(p) === 'start', 'back button returns to the previous tab');
  await p.goto(BASE + '#red', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  ok(await visibleTab(p) === 'red', 'a shared link (#red) opens that tab');
  await p.click('#q-close'); await p.waitForTimeout(400);
  await p.click('.brand'); await p.waitForTimeout(500);
  ok(await visibleTab(p) === 'start', 'Who pays? title goes to start');

  // Start tab ----
  await p.click('.go'); await p.waitForTimeout(500);
  ok(await visibleTab(p) === 'bill', 'Start with the bill opens the bill');
  for (const [i, t] of ['bill', 'court', 'red', 'hit'].entries()) {
    await p.evaluate(() => location.hash = 'start'); await p.waitForTimeout(400);
    await p.click(`#wall .pin:nth-child(${i + 1})`); await p.waitForTimeout(500);
    ok(await visibleTab(p) === t, `poster ${i + 1} opens ${t}`);
  }
  await p.evaluate(() => location.hash = 'start'); await p.waitForTimeout(400);
  await p.click('#tab-start .how summary'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelector('#tab-start .how').open), 'where-the-numbers note opens');

  // Bill ----
  await p.evaluate(() => location.hash = 'bill'); await p.waitForTimeout(500);
  const labels = { beds: 'average per bed', revenue: '% of patient revenue', none: 'average per hospital' };
  for (const mode of ['revenue', 'none', 'beds']) {
    await p.click(`[data-mode="${mode}"]`); await p.waitForTimeout(300);
    ok((await txt(p, '#r-sub')).includes(labels[mode]), `${mode} button relabels the receipt`);
    ok(await p.evaluate((m) => document.querySelector(`[data-mode="${m}"]`).classList.contains('on'), mode), `${mode} button shows as selected`);
    const first = await txt(p, '#r-lines li .row b');
    ok(mode === 'revenue' ? first.endsWith('%') : first.startsWith('$'), `${mode} lines use the right units (${first})`);
  }
  await p.click('#r-lines li:first-child button'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector('#r-lines li.open .more')), 'receipt line opens');
  ok((await p.evaluate(() => document.querySelectorAll('#r-lines li.open .more p').length)) === 4, 'opened line lists its count and top three');
  await p.click('#r-lines li:first-child button'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector('#r-lines li.open')), 'receipt line closes again');
  await p.click('#flip-btn'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.getElementById('receipt-card').classList.contains('flipped')), 'flip turns the receipt over');
  ok((await p.evaluate(() => document.querySelectorAll('#r-back .grp').length)) === 3, 'back of the receipt has three owner groups');
  await p.click('#flip-btn'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.getElementById('receipt-card').classList.contains('flipped')), 'flip turns it back');
  await p.click('#tab-bill .how summary'); ok(await p.evaluate(() => document.querySelector('#tab-bill .how').open), 'bill note opens');
  await p.click('#tab-bill .handoff'); await p.waitForTimeout(500);
  ok(await visibleTab(p) === 'court', 'bill Next goes to the court');

  // Court ----
  const outAt = async (t) => (await api(p, `/api/risk?threshold=${t}`)).data.at_risk;
  for (const t of [5, 17, 25, 10]) {
    await p.evaluate((v) => { const i = document.getElementById('thr'); i.value = v; i.dispatchEvent(new Event('input')); }, t); await p.waitForTimeout(250);
    ok(await txt(p, '#thr-label') === t + '%', `slider label reads ${t}%`);
    const n = +(await txt(p, '#out-n')).replace(/,/g, '');
    ok(n === await outAt(t), `slider at ${t}% gives ${n} out (API ${await outAt(t)})`);
    ok((await p.evaluate(() => document.querySelectorAll('#court .ball').length)) === n, `${n} tennis balls drawn at ${t}%`);
    ok((await txt(p, '#court .out-word')) === `${n} OUT`, `court headline matches at ${t}%`);
  }
  // drag the sideline on the court
  const h = await p.$('#court .handle'); const hb = await h.boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + 30); await p.mouse.down(); await p.mouse.move(hb.x + 200, hb.y + 30, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  const dragged = +(await txt(p, '#thr-label')).replace('%', '');
  ok(dragged > 10, `dragging the sideline right raises it (now ${dragged}%)`);
  ok(+await p.evaluate(() => document.getElementById('thr').value) === dragged, 'slider follows the drag');
  // a long drag keeps working while the court redraws under it
  const h2 = await p.$('#court .handle'); const hb2 = await h2.boundingBox(); const cb = await (await p.$('#court')).boundingBox();
  await p.mouse.move(hb2.x + hb2.width / 2, hb2.y + 30); await p.mouse.down();
  await p.mouse.move(cb.x + cb.width - 5, hb2.y + 30, { steps: 15 }); await p.mouse.up(); await p.waitForTimeout(300);
  ok(await txt(p, '#thr-label') === '25%', `a long drag reaches the far end (${await txt(p, '#thr-label')})`);
  const h3 = await p.$('#court .handle'); const hb3 = await h3.boundingBox();
  await p.mouse.move(hb3.x + hb3.width / 2, hb3.y + 30); await p.mouse.down();
  await p.mouse.move(cb.x + 5, hb3.y + 30, { steps: 15 }); await p.mouse.up(); await p.waitForTimeout(300);
  ok(await txt(p, '#thr-label') === '5%', `dragging back left reaches 5% (${await txt(p, '#thr-label')})`);
  await p.evaluate(() => { const i = document.getElementById('thr'); i.value = 10; i.dispatchEvent(new Event('input')); }); await p.waitForTimeout(300);
  // every ball can be clicked, even the ones sitting on the sideline
  const clickable = await p.evaluate(() => [...document.querySelectorAll('#court .ball')].every(b => { const r = b.querySelector('circle').getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit && !!hit.closest('.ball'); }));
  ok(clickable, 'no ball is covered by the drag handle or labels (balls may overlap each other)');
  // hover, pin, unpin, see it in the red
  const ball = await p.$('#court .ball'); const bb = await ball.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(250);
  ok(await p.evaluate(() => !document.getElementById('court-tip').hidden), 'hovering a ball shows its card');
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.getElementById('see-red')), 'clicking a ball pins its card');
  const pinnedName = await p.evaluate(() => document.querySelector('#court-tip b').textContent);
  await p.mouse.click(300, 870); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.getElementById('court-tip').hidden), 'clicking elsewhere unpins');
  const ball2 = await p.$('#court .ball'); const bb2 = await ball2.boundingBox();
  await p.mouse.click(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2); await p.waitForTimeout(300);
  await p.click('#see-red'); await p.waitForTimeout(700);
  ok(await visibleTab(p) === 'red', 'See it in the red opens the tomatoes');
  ok((await txt(p, '#red-card h4')) === pinnedName, `the tomato card shows the pinned hospital (${pinnedName})`);
  ok(await p.evaluate(() => !!document.querySelector('.tomato.picked')), 'that tomato is picked');

  // Red ----
  const tomatoes = await p.$$('.tomato');
  ok(tomatoes.length === +(await txt(p, '#red-n')), `one tomato per hospital in the red (${tomatoes.length})`);
  await tomatoes[tomatoes.length - 1].click(); await p.waitForTimeout(300);
  const lastName = await p.evaluate(() => document.querySelectorAll('.tomato')[document.querySelectorAll('.tomato').length - 1].getAttribute('aria-label'));
  ok((await txt(p, '#red-card h4')) === lastName, 'clicking a tomato shows its hospital');
  await p.focus('.tomato'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const firstName = await p.evaluate(() => document.querySelector('.tomato').getAttribute('aria-label'));
  ok((await txt(p, '#red-card h4')) === firstName, 'Enter on a tomato also works');
  ok(await txt(p, '.thr-echo') === '10%', 'red page echoes the sideline');
  await p.click('#tab-red .handoff'); await p.waitForTimeout(500);
  ok(await visibleTab(p) === 'hit', 'red Next goes to health IT');

  // Health IT ----
  const tile = await p.$('.st[data-state="CT"]'); await tile.scrollIntoViewIfNeeded(); await tile.click(); await p.waitForTimeout(700);
  ok(await p.evaluate(() => document.querySelector('.st[data-state="CT"]').classList.contains('flipped')), 'state tile flips');
  const ct = await api(p, '/api/summary_stats?state=CT');
  ok((await txt(p, '#state-card')).includes(`${ct.hospitals_with_hit} of ${ct.total_hospitals}`), `CT line matches API (${ct.hospitals_with_hit} of ${ct.total_hospitals})`);
  ok((await p.evaluate(() => document.querySelectorAll('#state-hospitals li').length)) === ct.hospitals_with_hit, 'CT list has the right number of hospitals');
  await p.click('#state-list summary'); ok(await p.evaluate(() => document.getElementById('state-list').open), 'hospital list opens');
  await tile.click(); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !document.querySelector('.st.flipped')), 'tapping the tile again flips it back');
  ok((await txt(p, '#state-card')).includes('441 of 6,064'), 'back to all states shows 441 of 6,064');
  await p.click('#tab-hit .handoff'); await p.waitForTimeout(500);
  ok(await visibleTab(p) === 'start', 'last Next goes back to start');

  // State filter, from every tab ----
  for (const [st, tab] of [['TX', 'bill'], ['NY', 'court'], ['CA', 'red'], ['GA', 'hit'], ['', 'court']]) {
    await p.evaluate((t) => location.hash = t, tab); await p.waitForTimeout(500);
    await setState(p, st); await p.waitForTimeout(900);
    const s = await api(p, `/api/summary_stats${st ? '?state=' + st : ''}`);
    const r = (await api(p, `/api/risk?threshold=10${st ? '&state=' + st : ''}`)).data;
    const label = st || 'All';
    ok((await txt(p, '#rail-state')) === label, `${label}: rail chip updates`);
    ok((await txt(p, '#b-n')) === s.total_hospitals.toLocaleString('en-US'), `${label}: bill hospital count ${s.total_hospitals}`);
    ok((await txt(p, '.bill .where')) === (st ? `hospitals in ${st}` : 'U.S. hospitals'), `${label}: bill sentence names the place`);
    await p.waitForTimeout(950);
    const total = await txt(p, '#r-total');
    const want = s.total_uncomp_care >= 1e9 ? '$' + (s.total_uncomp_care / 1e9).toFixed(1) + 'B' : '$' + (s.total_uncomp_care / 1e6).toFixed(1) + 'M';
    ok(total === want, `${label}: receipt total ${total} (API ${want})`);
    await p.evaluate(() => location.hash = 'court'); await p.waitForTimeout(500);
    ok(+(await txt(p, '#out-n')).replace(/,/g, '') === r.at_risk, `${label}: court out count ${r.at_risk}`);
    ok(+(await txt(p, '#court-n')).replace(/,/g, '') === r.total_hospitals, `${label}: court total ${r.total_hospitals}`);
    await p.evaluate(() => location.hash = 'red'); await p.waitForTimeout(600);
    ok(+(await txt(p, '#red-n')) === r.at_risk, `${label}: red count ${r.at_risk}`);
    ok(r.at_risk ? (await p.$$('.tomato')).length === r.at_risk : !!(await p.$('.empty-red')), `${label}: ${r.at_risk ? 'tomatoes drawn' : 'empty message shown'}`);
    await p.evaluate(() => location.hash = 'hit'); await p.waitForTimeout(600);
    ok(st ? await p.evaluate((st) => document.querySelector(`.st[data-state="${st}"]`).classList.contains('flipped'), st) : !(await p.$('.st.flipped')), `${label}: health IT tile follows the picker`);
    ok((await txt(p, '#state-card')).includes(`${s.hospitals_with_hit} of ${s.total_hospitals.toLocaleString('en-US')}`), `${label}: health IT line ${s.hospitals_with_hit} of ${s.total_hospitals}`);
  }

  console.log(`desktop: ${pass} passed, ${fail} failed, page errors: ${JSON.stringify(errs)}`);

  // Phone ----
  const before = pass + fail; const fBefore = fail;
  const ctx = await b.newContext({ ...devices['iPhone 13'] }); const m = await ctx.newPage();
  const merrs = []; m.on('pageerror', e => merrs.push(String(e)));
  await m.goto(BASE, { waitUntil: 'networkidle' }); await m.waitForTimeout(800);
  ok(await m.isVisible('#q-toggle') && !(await m.isVisible('#q-list')), 'phone: list starts folded with a Questions button');
  await m.tap('#q-toggle'); await m.waitForTimeout(300);
  ok(await m.isVisible('#q-list'), 'phone: Questions opens the list');
  await m.tap('#q-list a[data-tab="court"]'); await m.waitForTimeout(700);
  ok(await visibleTab(m) === 'court' && !(await m.isVisible('#q-list')), 'phone: picking a question opens it and folds the list');
  ok(await m.isVisible('#state'), 'phone: state picker stays reachable');
  await setState(m, 'TX'); await m.waitForTimeout(800);
  ok(+(await txt(m, '#out-n')) === 19, 'phone: Texas filter works on the court');
  const ball3 = await m.$('#court .ball'); await ball3.scrollIntoViewIfNeeded(); await m.waitForTimeout(300);
  const b3 = await ball3.boundingBox(); await m.touchscreen.tap(b3.x + b3.width / 2, b3.y + b3.height / 2); await m.waitForTimeout(400);
  ok(await m.evaluate(() => !document.getElementById('court-tip').hidden), 'phone: tapping a ball shows its card');
  console.log(`phone: ${pass + fail - before} checks, ${fail - fBefore} failed, page errors: ${JSON.stringify(merrs)}`);
  console.log(`TOTAL ${pass} passed, ${fail} failed`);
  await b.close();
})();
