# Этап 1 — план реализации серверной части

Source of truth:

- `../elph-nova-ios/features/featuretoggles/stage-1/server-implementation-plan.md`

Подробный task-by-task план реализации `Feature Config Service` для stage-1.

Этот документ дополняет:

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-mvp-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-mvp-plan.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)
- [server-deployment-guide.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-deployment-guide.md)
- [api-contract.md](../../elph-nova-ios/features/featuretoggles/stage-1/api-contract.md)
- [api.yaml](../../elph-nova-ios/features/featuretoggles/stage-1/api.yaml)

`server-mvp-plan.md` остаётся high-level roadmap по фазам.

Этот документ нужен для практической реализации: задачи, зависимости, критерии приёмки и обязательные проверки.

Оценка в документе дана для одного middle backend-разработчика, который работает по готовой спецификации, умеет пользоваться ИИ для каркасов, тестовых шаблонов и рутинного кода, но самостоятельно принимает технические решения и доводит реализацию до рабочего состояния.

---

## 1. Сводная таблица

| # | Задача | Оценка | Зависимости |
|---|--------|--------|-------------|
| 1 | Контур поставки, service discovery и admin exposure contract | 6 ч | — |
| 2 | Runtime skeleton, app factory и baseline test harness | 8 ч | 1 |
| 3 | Env-конфигурация, логирование, health и process lifecycle | 8 ч | 2 |
| 4 | Knex, migrations и persistence foundation | 12 ч | 2 |
| 5 | Manifest loader, registry и `sync-manifest` | 14 ч | 3, 4 |
| 6 | Resolution engine, specificity и compiled cache | 16 ч | 4, 5 |
| 7 | Public API, request context и wire response | 10 ч | 3, 5, 6 |
| 8 | Client token verification и точная auth semantics | 10 ч | 1, 3, 7 |
| 9 | Admin auth, RBAC и write path для feature rules | 14 ч | 4, 5, 6, 8 |
| 10 | Preview, revisions, optimistic locking и audit trail | 12 ч | 6, 9 |
| 11 | Server-rendered admin UI и operator flows | 16 ч | 9, 10 |
| 12 | Hardening, rollout verification и handoff | 18 ч | 3, 7, 8, 10, 11 |

**Итого:** 144 часа

---

## 2. Задачи

## Задача 1: Контур поставки, service discovery и admin exposure contract

**Оценка:** 6 часов  
**Зависит от:** —  
**Блокирует:** 2, 3, 8, 12

### Цели реализации

До написания runtime-кода зафиксировать внешний контур сервиса: где живёт standalone host, как клиент узнаёт `baseURL`, как закрыт admin-доступ и какие SSO claims/roles считаются source of truth.

### Связанные документы

- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-deployment-guide.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-deployment-guide.md)

### Что вошло

- standalone-first publication model;
- pre-login и post-login discovery;
- способ закрытия `/admin` на test host;
- SSO roles `viewer` / `editor`;
- решение по manifest artifact на deploy.

### Что не вошло

- реализация Fastify app;
- JWT/JWKS code;
- admin UI;
- Docker/CI implementation.

### Шаги реализации

1. Зафиксировать первый public URL standalone-инстанса.
2. Зафиксировать, как клиент получает `baseURL`:
   - до логина;
   - после логина;
   - при переходе в contour mode.
3. Выбрать модель публикации admin:
   - SSH tunnel / VPN;
   - либо отдельный admin-host / internal ingress.
4. Зафиксировать expected SSO claims и server-side mapping на `feature-toggle-viewer` / `feature-toggle-editor`.
5. Зафиксировать, откуда deploy получает bundled manifest.
6. Добавить этот контур в deployment/testing assumptions.

### Проверка и тесты

- ревью связности с `server-architecture.md`;
- проверка, что выбранный admin exposure не противоречит `server-deployment-guide.md`;
- явный smoke checklist entry points для последующих задач.

### Результат в репозитории

- зафиксированные runtime/deploy assumptions в документации stage-1;
- согласованный baseline для локальной и удалённой проверки.

### Критерии приёмки

- [ ] Понятен standalone URL сервиса
- [ ] Понятен pre-login и post-login discovery path
- [ ] Зафиксирован безопасный способ доступа к admin на test host
- [ ] Зафиксированы server-side роли viewer/editor
- [ ] Понятно, какой manifest artifact используется на deploy

---

## Задача 2: Runtime skeleton, app factory и baseline test harness

**Оценка:** 8 часов  
**Зависит от:** 1  
**Блокирует:** 3, 4, 5, 7, 12

### Цели реализации

Создать каркас сервиса, который можно и запускать вручную, и поднимать из integration tests без сетевого порта и без дублирования bootstrap-кода.

### Связанные документы

- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- `src/app.ts`;
- `src/server.ts`;
- app factory для tests;
- baseline test runner;
- test helpers и test env entry points;
- базовый package/tooling skeleton.

### Что не вошло

- бизнес-логика feature toggles;
- реальные migrations;
- manifest sync logic;
- auth verification.

### Шаги реализации

1. Подготовить `package.json`, `tsconfig`, базовую dev/runtime структуру.
2. Реализовать `app factory`, который можно создавать в tests без listen на реальном порту.
3. Реализовать `server.ts` как тонкий bootstrap поверх app factory.
4. Подключить baseline test runner (`Vitest`) и test scripts.
5. Подготовить helpers для test env/config overrides.
6. Подготовить базовые smoke-команды для локального старта.

### Проверка и тесты

- сервис собирается;
- `app factory` поднимается в tests;
- baseline test suite запускается;
- есть smoke-команда локального старта.

### Результат в репозитории

- runtime skeleton;
- baseline package scripts;
- test harness foundation.

### Критерии приёмки

- [ ] Есть разделение `app.ts` и `server.ts`
- [ ] Приложение можно создать из tests без реального listen
- [ ] Test runner подключён и запускается
- [ ] Есть базовые scripts для build/test/start
- [ ] Каркас готов для независимой разработки следующих задач

---

## Задача 3: Env-конфигурация, логирование, health и process lifecycle

**Оценка:** 8 часов  
**Зависит от:** 2  
**Блокирует:** 5, 7, 12

### Цели реализации

Собрать безопасный operational baseline сервиса: валидируемый env, структурные логи, health endpoints и корректное поведение процесса на старте и остановке.

### Связанные документы

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-deployment-guide.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-deployment-guide.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- typed env parsing;
- `pino`;
- `GET /health/live`;
- `GET /health/ready`;
- базовый graceful shutdown scaffold;
- config wiring в app factory.

### Что не вошло

- manifest drift logic;
- DB schema;
- public/admin business routes;
- rate limiting и production hardening.

### Шаги реализации

1. Реализовать `env.ts` с `zod` validation.
2. Зафиксировать обязательные и optional env-переменные stage-1.
3. Подключить `pino` и redaction baseline.
4. Добавить `health/live`.
5. Добавить `health/ready` с initial dependency hooks.
6. Подготовить process lifecycle hooks для shutdown.

### Проверка и тесты

- env parsing tests:
  - valid env;
  - missing required env;
  - invalid typed env;
- route-level tests для `health/live`;
- route-level tests для `health/ready`;
- локальный smoke `curl` по health endpoints.

### Результат в репозитории

- рабочий config layer;
- baseline observability;
- health endpoints и process lifecycle scaffold.

### Критерии приёмки

- [x] Env валидируется на старте
- [x] Некорректный env роняет запуск предсказуемо
- [x] `health/live` работает независимо от бизнес-логики
- [x] `health/ready` можно расширять зависимостями
- [x] Логирование структурировано и не пишет чувствительные данные по умолчанию

---

## Задача 4: Knex, migrations и persistence foundation

**Оценка:** 12 часов  
**Зависит от:** 2  
**Блокирует:** 5, 6, 9, 10

### Цели реализации

Поднять persistence foundation сервиса: Knex wiring, migrations, transaction boundaries и базовые repository contracts под definitions, rules, revisions и product metadata.

### Связанные документы

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- `knex.ts`;
- migration setup;
- таблицы:
  - `products`
  - `feature_definitions`
  - `feature_rules`
  - `config_revisions`
- базовые repository interfaces/implementation skeletons;
- transaction helper layer.

### Что не вошло

- manifest sync;
- resolution logic;
- admin/public route handlers;
- hardening/backup workflows.

### Шаги реализации

1. Подключить Knex под PostgreSQL и SQLite local-only.
2. Добавить migration entry points и package scripts.
3. Реализовать migrations под четыре базовые таблицы stage-1.
4. Зафиксировать индексы и уникальные ограничения под feature key / specificity / revision access.
5. Подготовить repository skeletons:
   - definitions;
   - rules;
   - revisions;
   - products.
6. Подготовить transaction boundary helpers для admin mutations.

### Проверка и тесты

- migration run с нуля;
- повторный migration run;
- integrity checks по ключевым ограничениям;
- repository smoke tests на базовых insert/read сценариях.

### Результат в репозитории

- DB schema;
- persistence entry points;
- foundation для manifest sync, resolution и admin write path.

### Критерии приёмки

- [x] Миграции поднимают схему stage-1
- [x] Повторный прогон миграций не ломается
- [x] Есть базовые индексы/ограничения под main query paths
- [x] Repository layer готов к следующим задачам без переделки схемы
- [x] Persistence не смешивает definitions, rules и revisions в одну сущность

---

## Задача 5: Manifest loader, registry и `sync-manifest`

**Оценка:** 14 часов  
**Зависит от:** 3, 4  
**Блокирует:** 6, 7, 9, 12

### Цели реализации

Сделать manifest-first поведение реальным: сервис должен загружать bundled manifest, валидировать его, синхронизировать definitions и уметь проверять readiness через manifest hash.

### Связанные документы

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- manifest loader;
- manifest registry;
- `sync-manifest` script / command;
- import только `remoteCapable` keys;
- update `manifest_hash`;
- archived keys.

### Что не вошло

- resolution engine;
- public route;
- admin mutations;
- client auth.

### Шаги реализации

1. Реализовать manifest loading из `MANIFEST_PATH`.
2. Зафиксировать валидацию manifest structure для server-side нужд.
3. Отфильтровать только `remoteCapable` keys.
4. Сохранять:
   - `default_entry_json`;
   - `payload_schema_json`;
   - metadata;
   - delivery/source priority fields.
5. Архивировать ключи, удалённые из manifest.
6. Обновлять `products.manifest_hash`.
7. Встроить manifest registry в runtime readiness checks.

### Проверка и тесты

- manifest sync tests:
  - новый key появляется;
  - удалённый key архивируется;
  - non-remoteCapable key не импортируется;
  - payload schema сохраняется;
- readiness/drift tests;
- локальный smoke `sync-manifest` command.

### Результат в репозитории

- рабочий manifest sync pipeline;
- runtime registry;
- readiness связь с manifest state.

### Критерии приёмки

- [ ] Сервис не требует ручного создания feature keys
- [ ] Импортируются только `remoteCapable` keys
- [ ] Удалённые keys не исчезают бесследно, а архивируются
- [ ] `manifest_hash` обновляется и используется в readiness logic
- [ ] `sync-manifest` является отдельным шагом, а не hidden startup side effect

---

## Задача 6: Resolution engine, specificity и compiled cache

**Оценка:** 16 часов  
**Зависит от:** 4, 5  
**Блокирует:** 7, 9, 10, 11

### Цели реализации

Реализовать центральную логику сервиса: подбор наиболее специфичного правила поверх manifest defaults и сборку полного resolved snapshot с process-local compiled cache по revision.

### Связанные документы

- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- `ConfigResolutionService`;
- specificity model;
- audience/platform/version matching;
- compiled snapshot cache;
- cache invalidation primitives;
- full response assembly model.

### Что не вошло

- HTTP handlers;
- JWKS verification;
- admin UI;
- CSRF/session details.

### Шаги реализации

1. Зафиксировать rule matching model:
   - audience;
   - platform;
   - min/max app version.
2. Реализовать specificity ordering.
3. Запретить ambiguous overlap одной специфичности.
4. Реализовать resolution поверх manifest defaults.
5. Реализовать full snapshot assembly по всем remote-capable definitions.
6. Добавить compiled cache keyed by `(product_id, revision)`.
7. Подготовить API invalidation/rebuild hooks для admin write path.

### Проверка и тесты

- unit tests на:
  - default without override;
  - audience precedence;
  - platform precedence;
  - app version matching;
  - specificity;
  - ambiguous overlap rejection;
- cache tests:
  - reuse on unchanged revision;
  - rebuild after invalidation.

### Результат в репозитории

- resolution core;
- compiled cache;
- stable base для public API, preview и admin parity.

### Критерии приёмки

- [ ] Сервер возвращает полный resolved snapshot, а не только overrides
- [ ] Most-specific rule wins
- [ ] Manifest default используется при отсутствии override
- [ ] Ambiguous overlap детектируется и запрещается
- [ ] Compiled cache завязан на revision и пригоден для reuse

---

## Задача 7: Public API, request context и wire response

**Оценка:** 10 часов  
**Зависит от:** 3, 5, 6  
**Блокирует:** 8, 12

### Цели реализации

Поднять стабильный read-only публичный контур, который корректно валидирует входные заголовки, собирает request context и отдаёт wire-format по контракту.

### Связанные документы

- [api-contract.md](../../elph-nova-ios/features/featuretoggles/stage-1/api-contract.md)
- [api.yaml](../../elph-nova-ios/features/featuretoggles/stage-1/api.yaml)
- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- `GET /api/v1/feature-config`;
- request header validation;
- request context extraction;
- response mapping;
- `Cache-Control: no-store`.

### Что не вошло

- real JWT verification semantics beyond anonymous path;
- admin routes;
- UI rendering.

### Шаги реализации

1. Реализовать public schemas и route wiring.
2. Валидировать `Platform`, `AppName`, `AppVersion`.
3. Реализовать request context builder.
4. Подключить resolution service.
5. Сериализовать ответ в wire shape:
   - `version`;
   - `ttl`;
   - `features`.
6. Выставить recommended response headers.

### Проверка и тесты

- integration tests public route:
  - valid anonymous request;
  - missing required headers;
  - default-based response;
- contract checks против `api.yaml`;
- локальный smoke request через `curl` / test client.

### Результат в репозитории

- рабочий public endpoint;
- full resolved response path для anonymous clients.

### Критерии приёмки

- [ ] `GET /api/v1/feature-config` отдаёт контрактный ответ
- [ ] Заголовки валидируются
- [ ] Ответ соответствует `api.yaml`
- [ ] При отсутствии auth строится anonymous config
- [ ] Public route не содержит лишней бизнес-логики поверх orchestration

---

## Задача 8: Client token verification и точная auth semantics

**Оценка:** 10 часов  
**Зависит от:** 1, 3, 7  
**Блокирует:** 9, 12

### Цели реализации

Подключить bearer-token verification так, чтобы сервис строго различал anonymous, invalid-token и infra-failure сценарии, не ломая iOS recovery flow.

### Связанные документы

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [api-contract.md](../../elph-nova-ios/features/featuretoggles/stage-1/api-contract.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- client token verifier;
- JWKS configuration;
- issuer/audience checks;
- auth-state integration в public path;
- error mapping на `401` / `5xx`.

### Что не вошло

- admin auth/session implementation;
- admin roles;
- admin mutations.

### Шаги реализации

1. Реализовать verifier поверх `jose`.
2. Подключить issuer/audience/JWKS config.
3. Встроить verifier в public request flow.
4. Явно развести сценарии:
   - no auth;
   - valid auth;
   - invalid/expired/malformed token;
   - verifier/JWKS failure.
5. Исключить любой silent downgrade до anonymous config.

### Проверка и тесты

- integration tests:
  - no auth -> anonymous;
  - valid auth -> authenticated;
  - invalid auth -> `401`;
  - infra failure -> `5xx`;
- локальный smoke auth scenarios через test fixtures/mocks.

### Результат в репозитории

- точная auth semantics в public API;
- readiness к iOS recovery orchestration.

### Критерии приёмки

- [ ] Нет silent downgrade при битом токене
- [ ] Invalid token всегда даёт `401`
- [ ] Infra/JWKS problem даёт `5xx`
- [ ] Auth state корректно доходит до resolution service

---

## Задача 9: Admin auth, RBAC и write path для feature rules

**Оценка:** 14 часов  
**Зависит от:** 4, 5, 6, 8  
**Блокирует:** 10, 11, 12

### Цели реализации

Поднять безопасный mutation path для server-side rules с разделением viewer/editor ролей, manifest-aware validation и транзакционной записью.

### Связанные документы

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- admin auth integration;
- RBAC viewer/editor;
- mutation schemas;
- create/update/disable rule operations;
- validation against manifest schema;
- transaction-safe write path.

### Что не вошло

- revisions UI;
- preview endpoint details;
- full admin HTML pages.

### Шаги реализации

1. Реализовать admin auth boundary.
2. Подключить RBAC:
   - viewer;
   - editor.
3. Реализовать mutation DTO/schema validation.
4. Проверять:
   - key существует в definitions;
   - payload schema valid;
   - unknown fields rejected;
   - `reason` required.
5. Реализовать CRUD/disable для `feature_rules`.
6. Подготовить write transaction hooks под revision/audit/cache invalidation.

### Проверка и тесты

- integration tests:
  - invalid role -> `403`;
  - missing reason -> `400`;
  - invalid feature key -> validation error;
  - invalid payload schema -> validation error;
- mutation path smoke без UI.

### Результат в репозитории

- server-side mutation API/service path;
- RBAC and manifest-aware validation.

### Критерии приёмки

- [ ] Viewer не может мутировать данные
- [ ] Editor может создавать и обновлять правила
- [ ] Пишутся только manifest-backed keys
- [ ] `reason` обязателен
- [ ] Write path не ломает separation public/admin

---

## Задача 10: Preview, revisions, optimistic locking и audit trail

**Оценка:** 12 часов  
**Зависит от:** 6, 9  
**Блокирует:** 11, 12

### Цели реализации

Добавить revision-aware write semantics и preview path, чтобы админ видел именно тот resolved результат, который потом получит реальный клиент.

### Связанные документы

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- `expectedRevision`;
- `409 Conflict` semantics;
- `config_revisions` writes;
- monotonic `current_revision`;
- preview endpoint/service;
- cache invalidation after commit.

### Что не вошло

- admin HTML rendering;
- production hardening;
- multi-instance rollout details.

### Шаги реализации

1. Реализовать optimistic locking через `expectedRevision`.
2. Возвращать `409 Conflict` при stale writes.
3. Писать audit trail в `config_revisions`.
4. Монотонно увеличивать `products.current_revision`.
5. Инвалидировать compiled cache после commit.
6. Реализовать preview через ту же resolution logic, что и public API.

### Проверка и тесты

- stale write -> `409`;
- revision growth tests;
- audit insert tests;
- cache invalidation tests;
- preview/public parity checks.

### Результат в репозитории

- safe concurrent admin write path;
- preview и revisions foundation для админки.

### Критерии приёмки

- [ ] Stale write не затирает новые данные
- [ ] Каждая успешная mutation увеличивает revision
- [ ] Каждая mutation создаёт audit entry
- [ ] Preview использует ту же resolution logic, что и public API
- [ ] Cache invalidation привязана к успешному commit

---

## Задача 11: Server-rendered admin UI и operator flows

**Оценка:** 16 часов  
**Зависит от:** 9, 10  
**Блокирует:** 12

### Цели реализации

Дать команде рабочий административный интерфейс без SPA-избыточности, с реальными operator flows: список фич, карточка ключа, форма правила, preview и история ревизий.

### Связанные документы

- [server-spec.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md)
- [server-architecture.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)

### Что вошло

- Fastify View + Nunjucks wiring;
- pages:
  - features list;
  - feature details;
  - rule form;
  - preview;
  - revisions;
- CSRF for forms;
- thin quick toggle behavior over the normal mutation path.

### Что не вошло

- SPA routing;
- frontend build pipeline;
- browser-side bearer token management.

### Шаги реализации

1. Подключить SSR templating.
2. Реализовать страницу списка фич.
3. Реализовать карточку ключа с текущими правилами.
4. Реализовать форму create/edit rule.
5. Реализовать preview page/partial.
6. Реализовать revisions page.
7. Добавить CSRF protection и UX под stale write / validation errors.

### Проверка и тесты

- SSR route tests;
- form validation tests;
- automated admin flow tests через `Playwright`:
  - open list;
  - open details;
  - submit form;
  - see preview;
  - see revisions;
  - verify stale conflict path;
- временный HTTP-level fallback допустим только на первом bootstrap, пока не заведена browser suite.

### Результат в репозитории

- рабочая server-rendered admin UI;
- repeatable operator flows без отдельного frontend-проекта.

### Критерии приёмки

- [ ] Админ может открыть список фич
- [ ] Админ может открыть карточку ключа
- [ ] Админ может создать/изменить правило через форму
- [ ] Validation errors и stale conflict отображаются предсказуемо
- [ ] Preview и revisions доступны из UI
- [ ] UI остаётся thin wrapper над серверной логикой, а не дублирует её
- [ ] Есть repeatable automated browser tests на critical admin flows

---

## Задача 12: Hardening, rollout verification и handoff

**Оценка:** 18 часов  
**Зависит от:** 3, 7, 8, 10, 11  
**Блокирует:** —

### Цели реализации

Довести сервис до состояния repeatable handoff и staging/prod readiness: security baseline, deployment confidence, smoke matrix и документация для команды.

### Связанные документы

- [server-mvp-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-mvp-plan.md)
- [server-test-plan.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md)
- [server-deployment-guide.md](../../elph-nova-ios/features/featuretoggles/stage-1/server-deployment-guide.md)

### Что вошло

- rate limits;
- security headers;
- CORS allow-list;
- graceful shutdown completion;
- backup/restore confidence checks;
- rollout smoke matrix;
- deployment/recovery docs sync;
- handoff checklist.

### Что не вошло

- новые product features beyond stage-1;
- multi-tenant/per-user targeting;
- realtime push.

### Шаги реализации

1. Добавить rate limits для public и admin contours.
2. Добавить security headers и CORS allow-list.
3. Довести graceful shutdown до production-like поведения.
4. Подготовить backup/restore check для PostgreSQL.
5. Подготовить multi-instance cache invalidation smoke strategy.
6. Синхронизировать deployment guide, test plan и implementation docs.
7. Зафиксировать и автоматизировать pre-release smoke:
   - health;
   - anonymous config;
   - authenticated config;
   - invalid token -> `401`;
   - admin change;
   - preview/public parity;
   - revisions visible.

### Проверка и тесты

- targeted hardening checks;
- automated runtime smoke перед handoff;
- automated admin/public happy path suite;
- deployment guide verification по шагам.

### Результат в репозитории

- сервис готов к test rollout;
- документация и smoke matrix пригодны для передачи команде.

### Критерии приёмки

- [ ] Security baseline применён
- [ ] Deployment guide соответствует реальным шагам запуска
- [ ] Есть repeatable rollout smoke matrix
- [ ] Сервис проходит critical happy path end to end через repeatable automation
- [ ] Документация пригодна для handoff без устных пояснений

---

## 3. Рекомендуемый порядок выполнения

Если делает один разработчик:

1. Задачи 1-5
2. Задачи 6-8
3. Задачи 9-10
4. Задача 11
5. Задача 12

Если работает несколько человек, безопасно параллелить так:

- после задачи 2 можно независимо двигать 3 и 4;
- после задачи 5 часть работы по 6 и часть подготовки по 7 можно вести параллельно;
- после задачи 9 UI-работу по 11 можно вести параллельно с завершением 10, если preview/revision contracts уже зафиксированы.

---

## 4. Definition of Done для server implementation plan

- [ ] Все задачи stage-1 реализованы или явно перенесены
- [ ] Public API соответствует `api.yaml`
- [ ] Manifest-first поведение не нарушено
- [ ] Invalid token всегда даёт `401`, без downgrade
- [ ] Preview и public API совпадают для одинакового input context
- [ ] Admin mutations revision-safe и пишут audit trail
- [ ] Есть repeatable automated tests и live smoke
- [ ] Есть repeatable automated browser tests на critical admin UI flows
- [ ] Deployment guide, implementation plan и test plan синхронизированы
