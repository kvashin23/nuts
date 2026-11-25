# NUTS — сайт агентства

Статичный сайт без сборки на сервере. Всё нужное лежит в проекте: библиотеки и шрифты — в `vendor/` (GSAP 3.12.5, ScrollTrigger, Lenis 1.1.13, Three.js r160, Unbounded + Manrope).

Тестовая выкладка: https://nuts.test.devnuts.ru/ (из ветки `main` через Drone). Демо на GitHub Pages (kvashin23.github.io/nuts/) тоже работает, кроме страницы 404 (она рассчитана на корень домена).

## Страницы

| Путь | Что это |
|---|---|
| `index.html` | Главная: 3D-орех, услуги, кейсы, процесс, о нас, блог, бриф |
| `projects/`, `projects/<раздел>/`, `projects/<раздел>/<кейс>/` | Кейсы: все, по разделам, страница кейса |
| `services/`, `services/<раздел>/`, `services/<раздел>/<услуга>/` | Услуги |
| `articles/`, `articles/<рубрика>/`, `articles/<рубрика>/<статья>/` | Блог |
| `company/` и `company/{reviews,partners,vacancy,requisites}/…` | О компании, отзывы, технологии, вакансии, реквизиты |
| `contacts/` | Контакты с брифом |

Все адреса — как на старом nuts-agency.ru (папка + `index.html`), чтобы при переезде не потерять позиции в поиске.

## Как устроено

- `css/style.css` — общие стили и главная, `css/pages.css` — внутренние страницы.
- `js/main.js` — вся интерактивность (общая для всех страниц), `js/nut.js` — 3D-сцена главной.
- `data/content.json` — кейсы, услуги и статьи со старого nuts-agency.ru (тексты кейсов 1:1 — `tools/import-cases.html`); картинки — в `assets/content/`, файлы — в `assets/files/`.
- `data/pages.json` — страницы компании со старого сайта: технологии, вакансии, реквизиты, отзывы (`tools/import-pages.html`).
- `data/seo.json` — title, description, H1 и canonical каждой страницы старого сайта (обход 25.11.2026); сборка берёт их как есть.
- `data/prices.json` — цены услуг: сборка убирает старые строки с ценами из текстов и ставит карточки.
- `data/custom/` — вручную оформленные страницы («Разработка сайтов», гайд о неэффективном сайте); генератор берёт их вместо автоматической вёрстки.
- `tools/build.js` — генератор: из `data/` собирает все внутренние страницы, `<head>` главной (между `<!-- @seo -->` и `<!-- /@seo -->`), `sitemap.xml`, `robots.txt`. В шаблонах ссылки пишутся короткими именами (`cases/<slug>.html`, `about.html`), сборка переводит их в адреса старого сайта.

Сгенерированные страницы не правятся руками — правьте `data/` или шаблоны в `tools/build.js` и пересоберите.

Каждая сборка добавляет к ссылкам на `css/` и `js/` метку `?v=<номер сборки>` (и на главной тоже): тестовый сервер не присылает `Cache-Control`, и без метки браузеры после выкатки смешивали свежий HTML со старыми стилями. Поэтому после правки CSS или JS страницы нужно пересобрать.

## Локальный просмотр и пересборка (Windows)

```
powershell -ExecutionPolicy Bypass -File server.ps1
```

Сайт — на http://localhost:5173. Чтобы пересобрать страницы, во втором окне запустите

```
powershell -ExecutionPolicy Bypass -File tools/save-server.ps1 -Root .
```

и откройте http://localhost:5173/tools/build.html.

## Заявки с формы

Форма брифа отправляет заявки в «Приёмную» агентства — https://feedback.nuts-agency.ru (клиент nuts-agency.ru, форма `main`). Приёмная хранит заявки и пересылает их с no-reply@nuts-agency.ru на info@nuts-agency.ru. Получателей меняют там же: карточка клиента, блок «Куда слать заявки». Ключ сайта и состав полей — в `js/main.js`, блок `brief form`.

Ключ работает только на доменах, которые перечислены в Приёмной: nuts-agency.ru, www.nuts-agency.ru, nuts.test.devnuts.ru, kvashin23.github.io. С localhost заявка не уйдёт, проверять нужно на тестовом адресе. Новый домен (например, при переезде) сначала добавить в карточку сайта в Приёмной.

## SEO

- Адреса, title, description и H1 — как на старом сайте (`data/seo.json`). Canonical и Open Graph всегда указывают на https://nuts-agency.ru.
- Микроразметка JSON-LD: Organization, ProfessionalService (адрес, часы, координаты), WebSite — на главной; BreadcrumbList — на всех внутренних; Service с ценами (Offer) — на услугах; Article — на кейсах; BlogPosting — на статьях; CollectionPage/ItemList — на списках.
- Яндекс.Метрика 48404891 (счётчик старого сайта) включается только на nuts-agency.ru и www.
- **Тестовая выкладка закрыта от индексации**: `INDEX = false` в `tools/build.js` → `robots.txt` с `Disallow: /` и `<meta name="robots" content="noindex, nofollow">` на каждой странице.

### Перед переключением домена nuts-agency.ru

1. `INDEX = true` в `tools/build.js`, пересобрать, запушить.
2. На сервере (Nginx) — 301-редиректы, которые статика сделать не может:
   - `www.nuts-agency.ru` → `nuts-agency.ru`, `http` → `https`;
   - `/articles/Project-management/…` → `/articles/project-management/…` (так делал старый сайт; на Windows эти папки совпадают, поэтому в репозитории только нижний регистр);
   - `/company/index.php` → `/company/`;
   - `/projects/smm/video-o-kompanii-tochka-molochka/` и `/projects/smm/kak-menshe-chem-za-god-nabrat-14-mln-prosmotrov-v-tiktok-/` → те же кейсы в `/projects/reklama/` (сейчас это HTML-заглушки с canonical), `/articles/elektronnaya-kommertsiya/` (пустая рубрика) → `/articles/`;
   - старые файлы `/upload/…` → `/assets/files/<имя>` или `/assets/content/<имя>` (имя файла то же).
   - Для отсутствующих адресов отдавать `404.html` с кодом 404.
3. В Яндекс.Вебмастере и Google Search Console — проверить, что robots.txt открыт, отправить `https://nuts-agency.ru/sitemap.xml`.
4. Не переносились (на старом сайте были пустыми): `/company/vacancy/veb-razrabotchik/`, `/company/vacancy/spetsialist-po-kontekstnoy-reklame/` («Элемент не найден»), `/company/licenses/`, `/include/*.php`, RSS `/articles/rss/`.
