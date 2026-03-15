# Delivery Contour

Контракт развёртывания, service discovery и доступа к admin для `elph_nova_toggle_service`.

Этот документ фиксирует конкретные решения, которые последующие задачи (Tasks 2–12) используют как тестовый и smoke-baseline.

Material rollout и stage-1 deltas дополнительно фиксируются в `docs/DELIVERY_CHANGELOG.md`, чтобы важные изменения не терялись между несколькими планами и implementation docs.

---

## 1. Standalone Public URL

Публичный хост для первого test-rollout:

```
https://feature-config-test.eltex.nsk.ru
```

> Placeholder — заменить на реальный домен до первого rollout, если домен ещё не назначен.

Требования к хосту:

- HTTPS обязателен. HTTP недопустим на публичном endpoint.
- Единственный публичный endpoint: `GET /api/v1/feature-config`.
- `/admin` и health endpoints (`/health/live`, `/health/ready`) **не публикуются** на этом хосте публично. Они доступны только через SSH tunnel или внутреннюю сеть.
- PostgreSQL **не выставляется** в интернет. Порт БД должен быть закрыт на уровне firewall.

---

## 2. Client baseURL Discovery

### 2a. Pre-login (до аутентификации пользователя)

- iOS/Android/Web-клиенты получают `baseURL` через статическую конфигурацию окружения (env/build-time config) или через механизм remote app configuration.
- Standalone URL (`https://feature-config-test.eltex.nsk.ru`) передаётся напрямую в `FeatureRemoteCatalog` без дополнительного шага service discovery.
- Зависимости от `auth/me` или SSO на этом этапе **нет**. Сервис feature-config должен быть доступен до логина.
- Анонимные запросы к `GET /api/v1/feature-config` без заголовка `Authorization` валидны и возвращают анонимный конфиг.

### 2b. Post-login (после аутентификации пользователя)

- Клиент использует тот же `baseURL`, но прикладывает заголовок `Authorization: Bearer {token}` к каждому запросу.
- Сервер возвращает аутентифицированный конфиг (может применяться иное audience matching).
- `auth/me.services.featureConfig` **опционально** возвращает канонический URL. Это позволяет клиентскому wrapper-у обновить `FeatureRemoteCatalog` при смене URL без нового релиза клиента.
- Важно: сервер feature-config **не получает** URL из `auth/me` — он сам является тем URL, на который `auth/me` может указывать.

> **Критически важно:** если переданный bearer token невалиден, просрочен или malformed — сервер возвращает `401` и **не** откатывается к анонимному конфигу. Silent downgrade к public config запрещён. Это требование необходимо для iOS recovery flow: клиент должен отличать отсутствие токена от просроченного токена.

### 2c. Переход между контурами (contour-mode transition)

- При переходе от standalone к contour deployment меняется только `baseURL`.
- API-контракт (`GET /api/v1/feature-config`, заголовки, форма ответа) **не меняется**.
- `auth/me.services.featureConfig` — рекомендуемый механизм для передачи нового URL уже задеплоенным клиентам.
- Новый релиз клиента **не требуется**, если URL-обновление распространяется через `auth/me`.

---

## 3. Модель доступа к Admin на standalone test host

### Основной вариант: SSH tunnel (без публичного admin)

Команда для создания tunnel:

```
ssh -L 3300:127.0.0.1:3000 user@feature-config-host
```

После установки tunnel admin доступен локально:

```
http://127.0.0.1:3300/admin
```

Почему SSH tunnel:

- Admin полностью недоступен из публичного интернета.
- Не требует дополнительного DNS.
- Работает до того, как SSO-интеграция будет завершена.
- Наименьший attack surface на этапе test rollout.

`DEV_ADMIN_PASSWORD` с привязкой к `127.0.0.1` — это **только** для локальной разработки. На remote standalone host этот режим недопустим.

### Альтернатива для будущего: отдельный admin-хост с IP allow-list

- Отдельный поддомен, например: `https://feature-config-admin.internal.example.com`.
- Защита через env var `ADMIN_ALLOWED_IPS` (например, `ADMIN_ALLOWED_IPS=127.0.0.1,10.0.0.0/8`).
- SSO обязателен при использовании этого варианта.

**Решение для первого standalone test rollout: SSH tunnel.** Отдельный admin-хост — upgrade path после готовности SSO-интеграции.

На этапе SSH tunnel: SSH tunnel является **единственным механизмом контроля доступа** к admin. Admin route должен быть привязан только к `127.0.0.1` (loopback) на remote host — не к `0.0.0.0`.

CSRF protection через synchronizer token pattern (`@fastify/csrf-protection`) обязательна для всех state-mutating admin form routes в обоих вариантах доступа.

---

## 4. SSO Claims и Server-Side Role Mapping

Сервис использует существующую SSO/OIDC инфраструктуру. Bearer token клиентов верифицируется через SSO JWKS endpoint.

Для admin access сервис маппит SSO identity claims на две внутренние роли:

| Внутренняя роль | Область применения |
|---|---|
| `feature-toggle-viewer` | Read-only доступ к admin (просмотр фич, правил, preview) |
| `feature-toggle-editor` | Мутации (создание, обновление, отключение правил) |

Ожидаемая структура JWT claim:

- Поле claim: `roles` (массив строк)
- Значение для viewer: строка `"feature-toggle-viewer"` присутствует в массиве `roles`
- Значение для editor: строка `"feature-toggle-editor"` присутствует в массиве `roles`
- `editor` подразумевает `viewer` (editor может также просматривать)
- Пользователь может иметь обе роли одновременно

> **Важно:** имя claim (`roles`) должно быть подтверждено с командой SSO/OIDC провайдера до реализации Task 9. Если реальное поле claim отличается (например, `groups`, `permissions`, или namespaced custom claim вроде `https://example.com/roles`) — обновить этот документ и env-based SSO config соответственно до реализации RBAC в Task 9.

Env vars для верификации клиентских bearer token (public API auth):

| Переменная | Назначение |
|---|---|
| `SSO_JWKS_URI` | URL JWKS endpoint SSO провайдера |
| `SSO_ISSUER` | Ожидаемый issuer токена |
| `SSO_AUDIENCE` | Ожидаемое значение audience claim (например, `feature-config-service`) |

Эти env vars применяются к верификации клиентских bearer token на public API. Admin session auth может использовать отдельный OIDC client config, если admin ingress настроен иначе.

---

## 5. Доставка Manifest Artifact

Manifest artifact — файл `elph-nova-feature-manifest.json` из iOS проекта.

Расположение в соседнем репозитории:

```
../elph-nova-ios/Project/IP_Phone/Core/FeatureFlags/Manifest/elph-nova-feature-manifest.json
```

### Основной вариант: volume mount (только для чтения)

Предпочтительный способ для первого rollout.

- Смонтировать директорию манифеста как `/app/manifest/` внутри контейнера.
- Установить `MANIFEST_PATH=/app/manifest/elph-nova-feature-manifest.json`.
- Соответствует паттерну `docker-compose.yml`: `./manifest:/app/manifest:ro`.
- Перед деплоем: скопировать файл манифеста в `./manifest/` на хосте.

### Альтернатива: встроить в Docker image

Для immutable image deployments в CI/CD пайплайне.

- Добавить в Dockerfile: `COPY elph-nova-feature-manifest.json /app/manifest/elph-nova-feature-manifest.json`.
- Установить `MANIFEST_PATH=/app/manifest/elph-nova-feature-manifest.json`.
- Версия манифеста зафиксирована в конкретном образе.

**Решение для первого standalone rollout: volume mount** — проще обновлять без пересборки образа.

Команда `sync-manifest` должна быть выполнена после каждого деплоя и после каждого обновления файла манифеста. Это явный шаг оператора, **не скрытый side effect запуска сервера**.

---

## 6. Baseline Assumptions для Tasks 2–12

Сводная таблица конкретных значений, используемых как тестовый и smoke-baseline:

| Параметр | Значение |
|---|---|
| Standalone public URL | `https://feature-config-test.eltex.nsk.ru` (placeholder) |
| Public API endpoint | `GET /api/v1/feature-config` |
| Service port | `3000` |
| Admin access (test host) | SSH tunnel к `127.0.0.1:3000` |
| Admin URL (local dev) | `http://127.0.0.1:3000/admin` |
| Admin URL (через SSH tunnel) | `http://127.0.0.1:3300/admin` |
| Pre-login baseURL source | Статический env/build config |
| Post-login baseURL refresh | `auth/me.services.featureConfig` (опционально) |
| Manifest delivery | Volume mount в `/app/manifest/` |
| Manifest env var | `MANIFEST_PATH=/app/manifest/elph-nova-feature-manifest.json` |
| SSO JWKS env var | `SSO_JWKS_URI` (подтвердить с SSO командой) |
| SSO roles claim | `roles` (подтвердить с SSO командой) |
| Viewer role value | `feature-toggle-viewer` |
| Editor role value | `feature-toggle-editor` |

### Pre-release Smoke Checklist

Минимальный набор проверок перед каждым rollout:

- `GET /health/live` → `200`
- `GET /health/ready` → `200` (только после `db:migrate` + `sync-manifest`)
- `GET /api/v1/feature-config` без `Authorization` → `200` с анонимным конфигом
- `GET /api/v1/feature-config` с валидным bearer token → `200` с аутентифицированным конфигом
- `GET /api/v1/feature-config` с невалидным bearer token → `401` (не `200` с public config)
- `GET /api/v1/feature-config` с валидным по формату bearer token при недоступном JWKS endpoint → `5xx` (не `200`, не `401`)
- Admin доступен через SSH tunnel → открывается страница `/admin`
- Preview response через admin совпадает с public API response для тех же context parameters
