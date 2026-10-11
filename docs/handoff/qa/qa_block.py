import asyncio
from playwright.async_api import async_playwright
STATUS=403
BL=open('/tmp/blocked_tile.png','rb').read()
async def run(b, block_hosts, name):
    ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,locale='ru-RU',color_scheme='dark')
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    async def fake(route):
        await route.fulfill(status=STATUS, body=BL, headers={'Content-Type':'image/png','Access-Control-Allow-Origin':'*'})
    for h in block_hosts: await pg.route(f'**://{h}/**', fake)
    await pg.goto('http://localhost:8765/index.html#skip'); await pg.wait_for_timeout(1000)
    await pg.evaluate("KGP.closeOverlay()"); await pg.wait_for_timeout(9000)
    st=await pg.evaluate("[KGP.S.mapMode, [...new Set([...document.querySelectorAll('#map .leaflet-tile-loaded')].map(i=>new URL(i.src).host))]]")
    await pg.screenshot(path=f'/home/claude/app/qa/block_{name}.png'); print(name, st, errs)
    await ctx.close()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        await run(b,['tile.openstreetmap.org'],'osm_blocked')
        await run(b,['tile.openstreetmap.org','tile.openstreetmap.de','a.tile.openstreetmap.fr'],'all_blocked')
        global STATUS; STATUS=200; await run(b,['tile.openstreetmap.org'],'osm_blocked_200')
        # тайлы приходят как 200 с заглушкой (как у пользователя), проба проходит по статусу — проверка по пикселям
        await b.close()
asyncio.run(main())
