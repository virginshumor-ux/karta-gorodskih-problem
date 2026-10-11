import asyncio, json, sys
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
OUT='/home/claude/app/qa/'
import os; os.makedirs(OUT, exist_ok=True)
fails=[]; notes=[]
def check(cond, msg):
    (notes if cond else fails).append(('OK ' if cond else 'FAIL ')+msg)

async def env_test(b, name, mode):
    ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,locale='ru-RU',is_mobile=True,has_touch=True)
    pg=await ctx.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    if mode=='noreferer':
        async def strip(route):
            r=await route.fetch(); body=await r.text()
            body=body.replace('<head>','<head><meta name="referrer" content="no-referrer">',1)
            await route.fulfill(response=r, body=body)
        await pg.route('**/index.html', strip)
    if mode=='offline':
        await pg.route(lambda u: 'localhost' not in u and 'fonts.g' not in u and 'cdnjs' not in u, lambda r: r.abort())
    await pg.goto(BASE); await pg.wait_for_timeout(1500)
    await pg.evaluate("KGP.onbStep(3)"); await pg.click('[data-act=skiplogin]')
    await pg.wait_for_timeout(9000)
    mode_state=await pg.evaluate("KGP.S.mapMode")
    tiles=await pg.evaluate("[...document.querySelectorAll('#map .leaflet-tile-loaded')].map(i=>new URL(i.src).host).slice(0,3)")
    await pg.screenshot(path=OUT+f'env_{name}.png')
    notes.append(f'ENV {name}: mapMode={mode_state} tiles={tiles} errs={errs}')
    check(not errs, f'{name}: no page errors')
    await ctx.close()

async def functional(b):
    ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,locale='ru-RU',is_mobile=True,has_touch=True,permissions=['clipboard-read','clipboard-write'])
    pg=await ctx.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    await pg.goto(BASE); await pg.wait_for_timeout(2500)
    # онбординг
    check(await pg.locator('.onb h2').count()==1, 'onboarding shown on first run')
    await pg.click('[data-onb="1"]'); await pg.click('[data-onb="2"]'); await pg.click('[data-onb="3"]')
    check(await pg.locator('[data-act=vk]').count()==1, 'login screen after onboarding')
    await pg.click('[data-act=skiplogin]')
    # создание без входа -> вход -> мастер открывается сам
    await pg.click('.bottom-nav [data-go=create]')
    check(await pg.locator('[data-act=vk]').count()==1, 'create without login asks to log in')
    await pg.click('[data-act=ya]'); await pg.fill('#nick','qa_user')
    await pg.click('[data-act=dologin]')
    check(await pg.locator('.toast').count()==1, 'login without consent shows hint')
    await pg.check('#pd-consent'); await pg.click('[data-act=dologin]'); await pg.wait_for_timeout(400)
    check(await pg.evaluate("KGP.S.view")=='create', 'after login wizard opens (pending action)')
    # шаг 1: реальная загрузка файла
    check(await pg.locator('[data-act=next]').is_disabled(), 'step1 next disabled without photo')
    await pg.set_input_files('#photo-input', '/tmp/testphoto.jpg'); await pg.wait_for_timeout(800)
    check(await pg.locator('.photo-slot img').count()==1, 'photo uploaded from gallery input')
    await pg.set_input_files('#photo-camera', '/tmp/testphoto.jpg'); await pg.wait_for_timeout(800)
    check(await pg.locator('.photo-slot img').count()==2, 'photo uploaded from camera input')
    await pg.click('[data-rmphoto="1"]'); check(await pg.locator('.photo-slot img').count()==1, 'photo removed')
    await pg.click('[data-act=next]'); await pg.wait_for_timeout(600)
    await pg.evaluate("KGP.placeMap().setView([56.00602,92.80505],18)")
    try:
        await pg.wait_for_function("KGP.S.draft.address && KGP.S.draft.address.length>0", timeout=15000); ok=True
    except Exception: ok=False
    addr=await pg.evaluate("KGP.S.draft.address")
    check(ok and 'Определяем' not in addr, f'address geocoded: {addr}')
    check(not await pg.locator('[data-act=next]').is_disabled(), 'step2 next enabled after address')
    await pg.click('[data-act=next]')
    check(await pg.locator('[data-act=next]').is_disabled(), 'step3 next disabled without category')
    await pg.click('[data-pickcat=snow]'); await pg.click('[data-act=next]')
    await pg.fill('#f-title','Тест'); check(await pg.locator('[data-act=next]').is_disabled(), 'title <5 chars blocks next')
    await pg.fill('#f-title','Тротуар не чищен у остановки'); await pg.fill('#f-desc','Проверка описания')
    await pg.click('[data-act=next]')
    check(await pg.locator('.dup').count()==1, 'duplicate warning shown (same category within 30 m)')
    await pg.click('[data-act=next]'); await pg.wait_for_timeout(500)
    check(await pg.locator('.success').count()==1, 'success screen')
    cid=await pg.evaluate("KGP.S.draft.createdId")
    rec=await pg.evaluate(f"KGP.DB.get('complaints','{cid}')")
    check(rec and rec['status']=='moderation' and len(rec['photos'])==1 and rec['address']==addr, 'record saved in IndexedDB with photo and address')
    # официальное обращение из экрана «Готово»
    await pg.click('[data-act=toappeal]'); await pg.wait_for_timeout(300)
    check('Тротуар не чищен у остановки' in (await pg.locator('#appeal-text').inner_text()), 'appeal text generated')
    await pg.click('[data-act=copyappeal]'); await pg.wait_for_timeout(300)
    clip=await pg.evaluate("navigator.clipboard.readText()")
    check('Прошу принять меры' in clip, 'appeal copied to clipboard')
    await pg.click('[data-act=back]'); await pg.wait_for_timeout(300)
    # перезагрузка — данные сохраняются
    await pg.reload(); await pg.wait_for_timeout(2500)
    check(await pg.evaluate(f"!!KGP.S.complaints.find(c=>c.id=='{cid}')"), 'record persists after reload')
    check(await pg.evaluate("!!KGP.S.user"), 'login persists after reload')
    check(await pg.locator('.onb').count()==0, 'onboarding not repeated')
    # карта: метка -> превью -> поддержка
    await pg.evaluate("KGP.S.selected='demo-8'; KGP.drawMarkers(); KGP.renderHud()")
    before=await pg.evaluate("KGP.S.complaints.find(c=>c.id=='demo-8').supports")
    await pg.click('.sheet [data-act=support]'); await pg.wait_for_timeout(300)
    after=await pg.evaluate("KGP.S.complaints.find(c=>c.id=='demo-8').supports")
    check(after==before+1, f'support from map sheet {before}->{after}')
    await pg.click('.sheet [data-open]'); await pg.wait_for_timeout(1200)
    check(await pg.evaluate("KGP.S.view")=='detail', 'detail opens from sheet')
    check(await pg.locator('#minimap .leaflet-image-layer, #minimap .leaflet-tile').count()>0, 'minimap rendered')
    # подтверждение решения
    await pg.evaluate("KGP.openDetail('demo-4')"); await pg.wait_for_timeout(600)
    await pg.click('[data-act=confirm]'); await pg.wait_for_timeout(300)
    check(await pg.evaluate("KGP.S.complaints.find(c=>c.id=='demo-4').confirms")==2, 'confirm increments')
    # жалоба
    await pg.click('[data-act=report]'); check(await pg.locator('.modal input[name=rep]').count()==5, 'report dialog with reasons')
    await pg.click('[data-act=sendreport]'); check(await pg.locator('.modal').count()==0, 'report sent')
    # модератор
    await pg.click('[data-act=back]'); await pg.wait_for_timeout(200)
    await pg.click('.bottom-nav [data-go=profile]'); await pg.click('[data-act=togglemod]')
    await pg.evaluate(f"KGP.openDetail('{cid}')"); await pg.wait_for_timeout(600)
    await pg.click('[data-mod=published]'); await pg.wait_for_timeout(300)
    check(await pg.evaluate(f"KGP.S.complaints.find(c=>c.id=='{cid}').status")=='published', 'moderator publishes')
    await pg.click('[data-mod=work]'); await pg.wait_for_timeout(300)
    check(await pg.evaluate(f"KGP.S.complaints.find(c=>c.id=='{cid}').status")=='work', 'moderator sets in work')
    hist=await pg.evaluate(f"KGP.S.complaints.find(c=>c.id=='{cid}').history.length")
    check(hist>=3, 'history grows')
    # уведомления
    await pg.click('[data-act=back]'); await pg.click('.bottom-nav [data-go=notif]')
    n_unread=await pg.locator('.notif.unread').count(); check(n_unread>0, f'unread notifications: {n_unread}')
    await pg.click('[data-act=readall]'); check(await pg.locator('.notif.unread').count()==0, 'read all')
    # список, поиск (фокус не теряется), фильтры
    await pg.click('.bottom-nav [data-go=list]')
    await pg.click('#search'); await pg.keyboard.type('Кецховели', delay=30)
    focused=await pg.evaluate("document.activeElement.id")
    cnt=await pg.locator('#list-results .c-item').count()
    check(focused=='search' and cnt==1, f'search keeps focus and filters ({cnt})')
    await pg.fill('#search',''); await pg.dispatch_event('#search','input')
    await pg.click('.screen [data-status=all]'); all_cnt=await pg.locator('#list-results .c-item').count()
    await pg.click('.screen [data-cat=road]'); road=await pg.locator('#list-results .c-item').count()
    check(all_cnt>road>0, f'category filter all={all_cnt} road={road}')
    await pg.click('.screen [data-cat=road]')
    # погода
    await pg.click('.bottom-nav [data-go=profile]'); await pg.click('#panel [data-go=weather]'); await pg.wait_for_timeout(500)
    check(await pg.locator('.wx-now').count()==1 and await pg.locator('.hour').count()>=12, 'weather screen with hourly forecast')
    live=await pg.evaluate("KGP.S.weatherLive"); notes.append(f'weather live={live}')
    await pg.click('[data-act=back]'); await pg.click('#panel [data-go=stats]')
    check(await pg.locator('.bar-row').count()>=5, 'stats bars')
    await pg.click('[data-act=back]')
    # тема
    await pg.click('[data-act=theme]'); t=await pg.evaluate("document.documentElement.dataset.theme"); check(t=='light', 'theme -> light')
    await pg.click('[data-act=theme]'); t=await pg.evaluate("document.documentElement.dataset.theme"); check(t=='dark', 'theme -> dark')
    await pg.click('[data-act=theme]')
    # удаление аккаунта
    await pg.click('[data-act=deleteacc]'); await pg.click('[data-act=confirmdelete]'); await pg.wait_for_timeout(300)
    check(await pg.evaluate(f"!KGP.S.complaints.find(c=>c.id=='{cid}') && !KGP.S.user"), 'delete account removes user data')
    # сброс демо
    await pg.click('[data-act=resetdemo]'); await pg.wait_for_timeout(500)
    check(await pg.evaluate("KGP.S.complaints.length")==15, 'reset demo restores 15 records')
    # Escape / back
    await pg.click('.bottom-nav [data-go=map]'); check(await pg.evaluate("document.getElementById('panel').hidden"), 'map view hides panel on mobile')
    check(not errs, 'no JS errors in functional run: '+'; '.join(errs[:5]))
    await ctx.close()

async def desktop(b):
    ctx=await b.new_context(viewport={'width':1440,'height':900},locale='ru-RU'); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(BASE+'#skip'); await pg.wait_for_timeout(2500)
    await pg.evaluate("KGP.closeOverlay()")
    rail=await pg.locator('#rail .nav-item').all_inner_texts()
    check(len(rail)==3 and 'Обращения' in rail[0], f'desktop rail items {rail}')
    check(await pg.locator('#panel .c-item').count()>5, 'desktop list visible next to map')
    await pg.click('#panel .c-item >> nth=0'); await pg.wait_for_timeout(800)
    check(await pg.evaluate("KGP.S.view")=='detail', 'desktop detail opens')
    w=await pg.evaluate("document.querySelector('#map').getBoundingClientRect().width")
    check(w>800, f'desktop map width {w}')
    check(not errs, 'desktop no errors')
    await ctx.close()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for name,mode in [('normal','normal'),('noreferer','noreferer'),('offline','offline')]:
            await env_test(b,name,mode)
        await functional(b); await desktop(b)
        await b.close()
    print('\n'.join(notes)); print('\n'.join(fails) or 'ALL CHECKS PASSED')
asyncio.run(main())
