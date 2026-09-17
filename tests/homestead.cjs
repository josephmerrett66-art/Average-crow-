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
    await check('travelToFarm(); for(let i=0;i<650;i++) update(.05);');
    assert.equal(await check('raid.stats.spawned>0 && raid.hp<HOUSE_MAX_HP'),true);
    // Full defense succeeds through all four waves with a heavily defended cottage.
    await check("newGame(); travelToHomestead(); for(let y=5;y<16;y++) for(let x=5;x<16;x++) if(!defSolidTile(x,y)) defGrid[y][x].obj='archer'; startRaid(); for(let i=0;i<5000 && raid.phase!=='done';i++) update(.05);");
    assert.equal(await check("raid.phase==='done' && raid.wave===3 && raid.hp>0 && raid.stats.spawned===250"),true);
    // Raid day starts at dawn, never after the player has a chance to sleep.
    await check('newGame(); day=41; travelToHomestead(); startDay(true); sleepArm=1; trySleep(); cardT=1; continueCard();');
    assert.equal(await check('day===42 && onDefMap && raid && raid.phase==="between" && t===0'),true);
    await check('sleepArm=1; trySleep(); endDay(true);');
    assert.equal(await check('state==="day" && day===42'),true);
    // An in-flight raid resumes at the same wave and HP when a save is loaded.
    await check('for(let i=0;i<400;i++) update(.05); save();');
    const savedRaid=await check('JSON.stringify([raid.wave,raid.toSpawn,raid.hp,crows.filter(c=>c.raid).length])');
    await check('loadGame();');
    assert.equal(await check('JSON.stringify([raid.wave,raid.toSpawn,raid.hp,crows.filter(c=>c.raid).length])'),savedRaid);
    await check('sleepArm=1; trySleep();');
    assert.equal(await check('state'), 'day');
    // A legacy save on raid day also starts the morning battle instead of bypassing it.
    await check('const oldSave=JSON.parse(localStorage.getItem(SAVE_KEY)); delete oldSave.raid; delete oldSave.raidCrows; delete oldSave.raidShots; oldSave.t=0; localStorage.setItem(SAVE_KEY,JSON.stringify(oldSave)); loadGame();');
    assert.equal(await check('raid && raid.wave===0 && raid.betweenT===15'),true);
    // Defeat is a resolved battle; sleep is allowed and reload cannot award a victory.
    await check('raid.hp=1; raidDefeat(); save(); loadGame(); sleepArm=1; trySleep();');
    assert.equal(await check('state'), 'night');
    // Damage happens at projectile impact, and each special attack handles a cluster.
    for (const kind of ['scarepost','chimespin','archer','bomber','hawk']) {
      await check(`newGame(); startRaid(); raid.phase='clearing'; crows=[];
        for(let i=0;i<6;i++) crows.push({id:i+1,raid:true,x:162+i*2,y:155,alt:4,hp:1,tx:168,ty:168});
        launchTowerShot('${kind}',120,178,crows[0]);`);
      assert.equal(await check('raid.stats.killed'),0);
      await check('updateRaidShots(.05);');
      assert.equal(await check('raid.stats.killed'),0);
      await check('updateRaidShots(1);');
      const kills=await check('raid.stats.killed');
      assert.equal(kills,kind==='chimespin'?3:kind==='archer'||kind==='bomber'?6:1);
      assert.equal(await check('raidEffects.length>0'),true);
    }
    if (process.env.CROW_BALANCE) {
      for(const layout of ['none','basic','mixed']) {
        const results=[];
        for(let seed=1;seed<=8;seed++) {
          results.push(await check(`newGame(); const randomBefore=Math.random; Math.random=rng(${seed});
            const slots=[[7,8],[13,8],[7,12],[13,12],[9,6],[11,14]];
            const kinds=${layout==='none' ? '[]' : layout==='basic' ? "['scarepost','scarepost','scarepost','scarepost','scarepost','scarepost']" : "['archer','archer','chimespin','chimespin','bomber','hawk']"};
            for(let i=0;i<kinds.length;i++) defGrid[slots[i][1]][slots[i][0]].obj=kinds[i];
            startRaid(); for(let i=0;i<6000&&raid.phase!=='done';i++) { updateRaid(.05); updateRaidCrows(.05); updateTowers(.05); updateRaidShots(.05); }
            Math.random=randomBefore; ({hp:raid.hp,kills:raid.stats.killed,spawned:raid.stats.spawned,phase:raid.phase});`));
        }
        console.log(layout,JSON.stringify(results));
      }
    }
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
    if(process.env.CROW_SCREENSHOT) {
      const battlePng=await check(`newGame(); travelToHomestead(); VW=336; VH=336; cv.width=VW; cv.height=VH; defCam.x=0; defCam.y=0;
        const slots=[[7,8,'archer'],[13,8,'bomber'],[7,13,'chimespin'],[13,13,'hawk'],[10,5,'scarepost']];
        for(const [x,y,k] of slots) defGrid[y][x].obj=k;
        startRaid(); raid.wave=3; raid.phase='spawning'; raid.toSpawn=100; raid.spawnT=0;
        for(let i=0;i<120;i++) { clock+=.05; updateRaid(.05); updateRaidCrows(.05); updateTowers(.05); updateRaidShots(.05); }
        drawDefenseMap(); cv.toDataURL()`);
      fs.writeFileSync(process.env.CROW_SCREENSHOT.replace('.png','-battle.png'),Buffer.from(battlePng.split(',')[1],'base64'));
    }
    await page.setViewportSize({width:390,height:844});
    await check('resize(); day=42; flags.raidResolvedDay=0; raid=null; startDay(true); defPlayer.x=HOUSE_CX; defPlayer.y=202; defPlayer.fy=-1; defSnapCam(); render(); updateUseBtn();');
    assert.equal(await page.locator('#use').textContent(),'Defend');
    assert.equal(await check('playTop()<playBot() && t===0'),true);
    await check('sleepArm=1; primary(); update(2);');
    assert.equal(await check('state==="day" && t===0'),true);
    if(process.env.CROW_SCREENSHOT) {
      await check('render();');
      await page.screenshot({path:process.env.CROW_SCREENSHOT.replace('.png','-mobile.png')});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: repeated travel, gate collision, sleep/wake, wildlife, scenery, towers, save migration, raid targeting/progression/victory, morning raid and reload guards, delayed projectile damage, special attacks, seasonal rendering and mobile controls; no browser errors.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
