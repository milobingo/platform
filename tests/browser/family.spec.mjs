import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

for(const width of [320,390,430,768,1280]) {
  test(`family demo ${width}px: five tabs, fixed player, balls and no provider access`,async({page})=>{
    await page.setViewportSize({width,height:width===1280?720:844});
    const errors=[],api=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());if(/openai|livekit|youtube|resend/.test(new URL(r.url()).hostname))external.push(r.url());});
    await page.route('**/api/auth/session',route=>route.fulfill({json:{authenticated:false,configured:false,localAvailable:true}}));
    await page.addInitScript(()=>localStorage.setItem('real-account-untouched','retained'));
    await page.goto('/spelen?demo=1');
    await expect(page.getByRole('navigation',{name:'Spelersomgeving'})).toBeVisible();
    const grid=page.getByRole('grid',{name:'Alle 75 bingoballen'});
    await expect(grid.getByRole('gridcell')).toHaveCount(75);
    await expect(page.locator('.fam-number-ball.is-latest')).toHaveCount(1);
    const stage=page.locator('.fam-demo-video');
    await expect(stage).toBeVisible();
    await stage.evaluate(node=>node.dataset.mountMarker='same-player');
    const noOverflow=async()=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),{timeout:3000}).toBe(true);
    await noOverflow();
    for(const name of ['Boekjes','Gezin','Meedoen','Prijzen','Kijken']) {
      await page.getByRole('navigation',{name:'Spelersomgeving'}).getByRole('button',{name,exact:false}).click();
      await expect(stage).toHaveAttribute('data-mount-marker','same-player');
      await page.waitForTimeout(220);
      await noOverflow();
    }
    await page.getByRole('button',{name:'Account en instellingen'}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await noOverflow();
    await page.getByRole('button',{name:'Sluiten',exact:true}).click();
    await page.getByRole('button',{name:'Demo opnieuw beginnen'}).click();
    await expect(grid.getByRole('gridcell')).toHaveCount(75);
    expect(await page.evaluate(()=>localStorage.getItem('real-account-untouched'))).toBe('retained');
    expect(api.map(url=>new URL(url).pathname)).toEqual(['/api/auth/session']);expect(external).toEqual([]);expect(errors).toEqual([]);
    await mkdir('verification/screenshots',{recursive:true});
    await page.screenshot({path:`verification/screenshots/family-${width}.png`,fullPage:true});
  });
}

test('real API rejects forged Sites identity and demo flag',async({request})=>{
  const response=await request.get('/api/bingo/games?demo=1',{headers:{'oai-authenticated-user-id':'forged-admin','oai-authenticated-user-email':'admin@example.test'}});
  expect([401,503]).toContain(response.status());
  const body=await response.json();expect(body.games).toBeUndefined();expect(body.error).toBeTruthy();
});

test('production cannot create a local regie session',async({request},testInfo)=>{
  const session=await request.get('/api/auth/session');
  if(session.ok())test.skip((await session.json()).localAvailable===true,'Controle voor de gebouwde productie-runtime.');
  const response=await request.post('/auth/local',{headers:{Origin:testInfo.project.use.baseURL},data:{role:'regie'}});
  expect(response.status()).toBe(403);
  expect(response.headers()['set-cookie']).toBeUndefined();
});

test('ordinary family entry uses real sign-in, legacy link preserves selected show',async({page})=>{
  await page.goto('/spelen');
  await expect(page.getByRole('heading',{name:'Welkom bij de bingo!'})).toBeVisible();
  await expect(page.locator('.fam-demo-banner')).toHaveCount(0);
  await page.goto('/player.html?spel=12345678-1234-4123-8123-123456789012');
  await expect(page).toHaveURL(/\/spelen\?spel=12345678-1234-4123-8123-123456789012/);
});
