# verificaestoque

Serviço de **aviso de volta ao estoque** ("Avise-me") para a loja Norte Sul (Oracle Commerce Cloud).

O recurso nativo do OCC (`ProductNotificationService`) não funciona para a Norte Sul porque o job roda sem
cliente logado e avalia o produto pela lista de preço padrão do site (`priceGroupDefault`), que não tem preços.
Este serviço substitui esse fluxo.

## Como funciona

```
Widget Avise-me ──▶ endpoint OSF _notifyMeSubscribe ──▶ POST /v1/notify-me ──▶ Postgres
                                                                                  │
                     job (cron, padrão a cada 15 min) ◀───────────────────────────┘
                       ├─ consulta o estoque dos SKUs pendentes na loja (GET /ccstore/v1/inventories?ids=...)
                       └─ SKU com estoque ─▶ envia o e-mail (SMTP) ─▶ marca como "sent"
```

1. **Inscrição** — o widget chama `POST /v1/notify-me` com o token do cliente logado. O serviço valida o token na
   loja (`GET /ccstore/v1/profiles/current`); sem token válido, recusa. Também busca nome, URL e imagem do produto
   para o e-mail. Um mesmo e-mail não se inscreve duas vezes no mesmo SKU enquanto o aviso estiver pendente.
2. **Verificação** — o job agrupa os SKUs pendentes, consulta o estoque em lotes e, para cada SKU com estoque
   (`>= MIN_STOCK_LEVEL`), "reserva" as inscrições (`sending`), envia e marca como `sent`.
3. **Falhas de envio** — voltam para `pending` e são tentadas de novo na próxima execução; após
   `MAX_SEND_ATTEMPTS` viram `error`. Inscrições presas em `sending` (processo caiu) voltam para `pending`.
4. **Validade** — inscrições não atendidas expiram após `SUBSCRIPTION_TTL_DAYS` (padrão 90 dias).
   **Limpeza** — a cada execução do job, os avisos já **enviados** (`sent`) há mais de `RETENTION_DAYS` dias
   (padrão 15) são apagados do banco. Só os enviados: pendentes, expirados, cancelados e com erro ficam.
5. **Descadastro** — o e-mail tem link `GET /v1/notify-me/unsubscribe?token=...` (e header `List-Unsubscribe`).

Status possíveis: `pending`, `sending`, `sent`, `expired`, `error`, `unsubscribed`.

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/v1/notify-me` | Inscrição. Header `Authorization: Bearer <token do cliente>`, opcional `x-ccorganization`. Body: `email`, `productId`, `skuId`, `siteId`, `locale?`. Retorna `201 subscribed` ou `200 already_subscribed`. |
| `GET` | `/v1/notify-me/unsubscribe?token=` | Cancela o aviso (página HTML). |
| `GET` | `/health` | Healthcheck (verifica o banco). |
| `GET` | `/v1/admin/stats` | Total por status. Header `x-admin-key`. |
| `GET` | `/v1/admin/notifications?status=&skuId=&email=&limit=` | Lista inscrições. Header `x-admin-key`. |
| `POST` | `/v1/admin/check-stock` | Roda a verificação na hora (testes). Header `x-admin-key`. |

As rotas `/v1/admin/*` só existem se `ADMIN_API_KEY` estiver definida.

Erros da inscrição: `400 invalid_site`, `400 invalid_email`, `400` (campo faltando), `401 unauthorized`
(sem token / sessão expirada), `429` (rate limit: 20 por minuto por IP), `502 store_unavailable`.

## Rodando localmente

```bash
cp .env.example .env     # ajuste as variáveis
docker compose up -d     # sobe app + Postgres
# ou, com um Postgres já rodando:
npm install
npm run dev
```

Rodar a verificação uma vez, sem subir o servidor: `npm run check-stock`.

## Deploy no Coolify

1. **Banco**: crie um recurso **PostgreSQL** no Coolify e copie a *Postgres URL (internal)*.
2. **Aplicação**: novo recurso a partir do repositório Git, build pack **Dockerfile**, porta **3000**.
3. **Domínio**: `https://verificaestoque.codexlabdigital.com.br` (o mesmo usado no endpoint OSF
   `plugins/endpoints/NORTESUL/notifyMeSubscribe`; se mudar, altere o `BASE_URL` lá).
4. **Variáveis de ambiente**: as do `.env.example`, com `DATABASE_URL` = URL interna do Postgres e
   `PUBLIC_BASE_URL` = o domínio acima.
5. **Healthcheck**: `/health`.
6. Rode **uma réplica só** (o job também é protegido por advisory lock no Postgres, então duas não enviam em dobro).

As tabelas são criadas automaticamente no start (`sql/001_init.sql`, idempotente).

## E-mail

- Template: `src/templates/back-in-stock.html` (variáveis `{{nome}}`; as terminadas em `Html` entram sem escape).
- Configure SPF/DKIM do domínio do remetente no provedor de SMTP para não cair em spam.

## Loja (OSF)

No projeto `grupo-real`:

- Endpoint `_notifyMeSubscribe` em `plugins/endpoints/NORTESUL/notifyMeSubscribe` (registrado em
  `plugins/endpoints/index.js` e `meta.js`). Envia o token da sessão e o `x-ccorganization`.
- Widgets `NSProductNotifyMe` e `NSModalProductNotifyMe` usam `<Form action="_notifyMeSubscribe">`.
