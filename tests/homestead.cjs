// Run with NODE_PATH pointing to a Playwright installation and Chrome installed.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1008,height:1008}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Expose lexical state only in the test copy, never in the shipped game.
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
      .replaceAll('requestAnimationFrame(frame);', '')
      .replace('})();\n</script>', 'window.check = fn => eval(fn);\n})();\n</script>');
    await page.route('http://crow.test/**', route => route.fulfill({contentType:'text/html', body:source}));
    await page.goto('http://crow.test/');
    const check = code => page.evaluate(code => window.check(code), code);
    await check('newGame(); music = false;');
    assert.equal(await check("farm.every((row,y)=>row.every((_,x)=>actionAt(x,y)?.label!=='Sleep'))"),true);
    assert.equal(await check("actionAt(7,3)?.label==='Go home'"),false);
    // Actual primary interaction sets the cooldown that previously froze on entry.
    assert.equal(await check("player.x=56; player.y=30; player.fx=0; player.fy=-1; primary(); onDefMap"), true);
    assert.equal(await check("update(.2); primary(); onDefMap"), false);
    for (let i=0;i<3;i++) {
      assert.equal(await check("player.fy=-1; update(.2); primary(); onDefMap"), true);
      assert.equal(await check("update(.2); primary(); onDefMap"), false);
    }
    await check('player.x=56; player.y=30; keys.arrowup=true; for(let i=0;i<6;i++) update(.05); keys.arrowup=false;');
    assert.equal(await check('onDefMap'),true);
    await check('travelToHomestead(); defPlayer.x=HOUSE_CX; defPlayer.y=310; keys.arrowdown=true; for(let i=0;i<30;i++) update(.05); keys.arrowdown=false;');
    assert.equal(await check('defPlayer.y >= 320 && defPlayer.y < DEF_WH'), true);
    assert.equal(await check("getAction().label"), 'Leave');
    await check('primary();');
    assert.equal(await check('onDefMap'),false);
    await check('travelToHomestead(); defPlayer.x=HOUSE_CX; defPlayer.y=202; defPlayer.fy=-1; update(.2); primary();');
    assert.equal(await check('sleepArm > 0'),true);
    await check('update(3);');
    assert.equal(await check('sleepArm'),0);
    await check('primary(); update(.2); primary();');
    assert.equal(await check('state'),'night');
    await check('cardT=1; continueCard();');
    assert.equal(await check('onDefMap && day===2 && defPlayer.y===202'),true);
    // Wildlife belongs to this map and moves independently of the farm population.
    assert.equal(await check('defCritters.length===11 && defFlowerSpots.length>100'),true);
    assert.equal(await check('const old=defCritters[0].x; update(.1); old!==defCritters[0].x'),true);
    assert.equal(await check('DEF_SCENERY.every(o=>defSolidTile(o.x,o.y) && defActionAt(o.x,o.y)===null)'),true);
    await check("sel='archer'; inv.archer=2; defActionAt(8,13).fn();");
    assert.equal(await check("defGrid[13][8].obj"),'archer');
    await check('defActionAt(8,13).fn();');
    assert.equal(await check('inv.archer'),2);
    // Saved towers displaced by new scenery are refunded, and the sleeping map persists.
    await check("defGrid[3][3].obj='archer'; save(); onDefMap=false; loadGame();");
    assert.equal(await check("onDefMap && defGrid[3][3].obj===null && inv.archer===3"),true);
    await check('startRaid();');
    assert.equal(await check("defActionAt(HOUSE_TX,HOUSE_TY).label"),'Defend');
    await check('trySleep();');
    assert.equal(await check('state'),'day');
    assert.equal(await check('Array.from({length:100},raidTargetPoint).every(([x,y])=>x>=HOUSE_TX*TS && x<(HOUSE_TX+HOUSE_TW)*TS && y>=HOUSE_TY*TS && y<(HOUSE_TY+HOUSE_TH)*TS)'),true);
    await check('travelToFarm(); for(let i=0;i<300;i++) update(.05);');
    assert.equal(await check('raid.stats.spawned>0 && raid.hp<HOUSE_MAX_HP'),true);
    // Full defense succeeds through all four waves with a heavily defended cottage.
    await check("newGame(); travelToHomestead(); for(let y=5;y<16;y++) for(let x=5;x<16;x++) if(!defSolidTile(x,y)) defGrid[y][x].obj='archer'; startRaid(); for(let i=0;i<5000 && raid.phase!=='done';i++) update(.05);");
    assert.equal(await check("raid.phase==='done' && raid.wave===3 && raid.hp>0 && raid.stats.spawned===58"),true);
    // Render each seasonal map, plus a clean full-map contact image for visual QA.
    for(let season=0;season<4;season++) {
      await check(`day=${season*12+1}; refreshBg(); render();`);
    }
    await check('newGame(); travelToHomestead(); day=1; refreshBg(); VW=DEF_WW; VH=DEF_WH; cv.width=VW; cv.height=VH; defCam.x=0; defCam.y=0; drawDefenseMap();');
    if (process.env.CROW_SCREENSHOT) {
      const png = await check('VW=DEF_WW; VH=DEF_WH; cv.width=VW; cv.height=VH; defCam.x=0; defCam.y=0; drawDefenseMap(); cv.toDataURL()');
      fs.writeFileSync(process.env.CROW_SCREENSHOT, Buffer.from(png.split(',')[1], 'base64'));
      const farmPng = await check('travelToFarm(); VW=160; VH=110; cv.width=VW; cv.height=VH; cam.x=0; cam.y=0; drawWorld(); cv.toDataURL()');
      fs.writeFileSync(process.env.CROW_SCREENSHOT.replace('.png', '-farm.png'), Buffer.from(farmPng.split(',')[1], 'base64'));
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: repeated travel, gate collision, sleep/wake, wildlife, scenery, towers, save migration, raid targeting/progression/victory, seasonal rendering; no browser errors.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
