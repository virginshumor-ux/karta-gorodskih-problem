import os
R='/home/claude/app/'
css=open(R+'build/leaflet.css').read()+'\n'+open(R+'src/style.css').read()
body=open(R+'src/body.html').read()
embed=open(R+'build/embed.js').read()
js=open(R+'src/app.js').read()
fonts='<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Unbounded:wght@600&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0&display=block">'
leaf='<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>'
content=f'<title>Карта городских проблем</title>\n{fonts}\n<style>\n{css}\n</style>\n{body}\n{leaf}\n<script>\n{embed}\n{js}\n</script>\n'
open(R+'dist/prototype.html','w').write(content)
pwa='<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#0b5d66"><link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icon-192.png">'
sw="<script>if('serviceWorker' in navigator&&location.protocol==='https:'){addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}</script>"
full=f'<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n{pwa}\n<style>*,*::before,*::after{{box-sizing:border-box}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>\n</head>\n<body>\n{content}{sw}\n</body>\n</html>\n'
os.makedirs(R+'dist/site',exist_ok=True)
open(R+'dist/site/index.html','w').write(full)
print(len(content), len(full))
