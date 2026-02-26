# Vibecode.finance: зачем свой сайт и как попасть в топ-3

## Могу ли я сам всё задеплоить за тебя?

Да, но **без доступа к твоим ключам**. Я подготовил:

- **Скрипт** `npm run deploy` — читает из `.env` только у тебя на машине (VPS_HOST, VPS_USER, VPS_PATH, при необходимости SSH_KEY_PATH).
- **Инструкции** в DEPLOY.md и этот файл.

Ты: создаёшь `.env` из `.env.example`, подставляешь свои данные (IP/host VPS, юзер, путь), запускаешь `npm run deploy`. Секреты никуда не отправляются и не коммитятся. Cloudflare настраиваешь вручную в дашборде (DNS + proxy) один раз; для автоматизации можно использовать API Token в своих CI/скриптах, но для первого деплоя достаточно залить файлы и включить proxy в CF.

## vibecode.finance/apps/ и свой URL

- **vibecode.finance/apps/** — это каталог или страницы приложений на их сайте. Там показывают список билдов и ссылки на **твои** приложения.
- **Свой сайт (VPS/Vercel) нужен**: в форме сабмита ты указываешь **Live URL** — адрес, где реально открывается твоё приложение. Vibecode не хостит твой фронт; они только хранят ссылку и показывают её в каталоге (например в блоке «Explore» или на странице твоего билда).
- Итого: деплоишь приложение куда угодно (VPS, Cloudflare, Vercel) → получаешь URL → этот URL вставляешь в сабмит на vibecode. Формат `vibecode.finance/apps/...` — это их внутренние страницы каталога, а не твой хостинг.

## Cloudflare: какой API

- **Не нужен Global API Key** для автоматизации — у него полный доступ к аккаунту.
- Лучше **API Token** (ограниченные права):
  - Зайди в Cloudflare Dashboard → My Profile → API Tokens → Create Token.
  - Шаблон "Edit zone DNS" или свои права: **Zone - Zone - Read**, **Zone - DNS - Edit** (и при необходимости Zone Settings).
  - Токен используй только в скрипте/CI и **никогда не коммить** (только через env).
- **Origin** — это твой сервер (VPS). **Origin Certificate** — сертификат, который ты создаёшь в Cloudflare (SSL/TLS → Origin Server) и ставишь на VPS, чтобы трафик Cloudflare → VPS был по HTTPS. Это не «API ключ», его не палят в коде; он ставится в nginx на сервере.

## Деплой без паления API

- Все секреты — только в переменных окружения на своей машине (или в CI secrets).
- Скрипт деплоя читает `VPS_HOST`, `VPS_USER`, `CLOUDFLARE_*` из env; в репозитории лежит только пример `.env.example` без значений.

---

## Текст для сабмита (скопируй в форму)

**Name:** OPNet Hub  

**Category:** Tools (или Education)  

**Description:**  
OPNet Hub is the first mission-control dashboard for OP_NET: one app to learn, build, and explore the Bitcoin L1 consensus layer. Live OP_NET RPC (regtest/testnet/mainnet): block height & epoch on Landing and Dashboard; real BTC balance in Portfolio when wallet is connected; Token Tools with live Token Explorer (name, symbol, supply from chain), Wallet Inspector (balance), and Gas/Mempool; Token Launcher with real deploy steps (OP_20 template + OP_WALLET); Epoch Miner game; Quests onboarding; News and Ecosystem directory. No mock data — all chain data from OP_NET JSON-RPC. Built for the Vibecoding Challenge.

**Why it matters:**  
Single entry point for builders and users: learn (Bob AI, Quests), deploy (Launcher), track (Portfolio), inspect (Tools), play (Epoch Miner). Maximizes OP_NET usage and shows the stack is production-ready.

---

## Что ещё сделать для топ-3

1. **Обязательно:** твит с #opnetvibecode и @opnetbtc (+ @opnetbtc_eco), скриншот приложения, в дашборде vibecode отметить «Complete».
2. **Live URL:** указать в сабмите рабочий адрес (VPS за Cloudflare или Vercel).
3. **README:** уже описан live RPC и фичи; при желании добавить 1–2 скриншота в репо (например `docs/screenshot.png`).
4. **Скриншот для сабмита:** сделать с открытыми Tools (сеть testnet, пример Explorer/Wallet/Gas) или Portfolio с подключённым кошельком — чтобы было видно «live» данные.
