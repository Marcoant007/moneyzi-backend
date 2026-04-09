# 📊 Configuração do Grafana Cloud para Moneyzi Backend

Este guia te ajuda a configurar o envio de logs do backend para o **Grafana Cloud**.

---

## 🚀 Passo a Passo

### 1. Crie uma conta no Grafana Cloud (se ainda não tiver)

Acesse: https://grafana.com/auth/sign-up/create-user

- Plano gratuito: 50GB de logs, 10k séries de métricas, 14 dias de retenção

---

### 2. Obtenha as credenciais do Loki

Após fazer login no Grafana Cloud:

1. Acesse seu stack: `https://grafana.com/orgs/<sua-org>/stacks`
2. Clique no seu stack (ex: `moneyzi-stack`)
3. No menu lateral, vá em **"Send Logs"** ou **"Loki"**
4. Copie as seguintes informações:

```
URL:      https://logs-prod-<region>.grafana.net
User:     <seu-user-id> (geralmente um número como 123456)
Password: <sua-api-key> (crie uma nova API key se necessário)
```

**Para criar uma API Key:**
- Vá em `Configuration` → `API Keys`
- Clique em `Add API Key`
- Nome: `moneyzi-backend-logs`
- Role: `MetricsPublisher` ou `Admin`
- Copie a key gerada (você não verá ela novamente!)

---

### 3. Configure as variáveis de ambiente

Edite o arquivo `.env` do backend e descomente/preencha:

```bash
GRAFANA_LOKI_URL=https://logs-prod-us-central1.grafana.net
GRAFANA_LOKI_USER=123456
GRAFANA_LOKI_API_KEY=glc_eyJvIjoiNzg5MjM0IiwibiI6Im1vbmV5emktYmFja2VuZCIsImsiOiJhYmMxMjMiLCJtIjp7InIiOiJwcm9kLXVzLWNlbnRyYWwtMSJ9fQ==
```

> ⚠️ **IMPORTANTE**: Nunca commite essas credenciais no git! O `.gitignore` já está configurado para ignorar `.env`.

---

### 4. Adicione as variáveis no Railway (produção)

Se você usa Railway para deploy:

1. Acesse o dashboard do projeto: https://railway.app/project/<seu-projeto>
2. Vá na aba `Variables`
3. Adicione:
   - `GRAFANA_LOKI_URL`
   - `GRAFANA_LOKI_USER`
   - `GRAFANA_LOKI_API_KEY`
   - `NODE_ENV=production`

4. Faça um novo deploy para aplicar as mudanças

---

### 5. Teste localmente (opcional)

Para testar o envio de logs localmente:

```bash
# No arquivo .env, descomente as variáveis do Grafana
# e configure NODE_ENV=production temporariamente

cd moneyzi-backend
NODE_ENV=production pnpm dev
```

Acesse alguma rota da API e veja os logs chegando no Grafana Cloud em tempo real!

---

## 🔍 Visualizando os logs no Grafana

1. Acesse seu Grafana Cloud: `https://<sua-org>.grafana.net`
2. No menu lateral, clique em **"Explore"** (ícone de bússola)
3. Selecione a data source **"Loki"**
4. Use queries como:

```logql
# Todos os logs do moneyzi-backend
{app="moneyzi-backend"}

# Apenas logs de erro
{app="moneyzi-backend"} |= "error"

# Logs de um endpoint específico
{app="moneyzi-backend"} |= "/import-csv"

# Últimas 100 linhas
{app="moneyzi-backend"} | limit 100
```

---

## 📈 Criando um Dashboard

1. No Grafana, vá em `Dashboards` → `New Dashboard`
2. Adicione um painel de logs:
   - Tipo: **Logs**
   - Data Source: **Loki**
   - Query: `{app="moneyzi-backend"}`
3. Adicione um painel de métricas de erro:
   - Tipo: **Time Series**
   - Query: `rate({app="moneyzi-backend"} |= "error" [5m])`

Salve o dashboard como **"Moneyzi Backend - Logs & Errors"**

---

## 🎯 Como funciona

### Fluxo de logs:

```
Backend (pino) 
    → pino-loki (transport) 
        → Grafana Cloud Loki (storage) 
            → Grafana (visualização)
```

### Labels automáticos enviados:

- `app: moneyzi-backend`
- `env: production` (ou development)
- `level: info/warn/error`
- `hostname: <nome-do-servidor>`

### Configuração aplicada:

- **Batching**: Logs são enviados em lotes a cada 5 segundos (reduz requisições HTTP)
- **Basic Auth**: Autenticação via username + API key
- **Fallback**: Se as credenciais não estiverem configuradas, continua funcionando normalmente com JSON no stdout

---

## 🐛 Troubleshooting

### Logs não aparecem no Grafana

1. Verifique se as credenciais estão corretas:
   ```bash
   echo $GRAFANA_LOKI_URL
   echo $GRAFANA_LOKI_USER
   echo $GRAFANA_LOKI_API_KEY
   ```

2. Teste a conexão com curl:
   ```bash
   curl -u $GRAFANA_LOKI_USER:$GRAFANA_LOKI_API_KEY \
     $GRAFANA_LOKI_URL/loki/api/v1/labels
   ```

3. Veja os logs do backend para erros de conexão:
   ```bash
   pnpm dev
   ```

### API Key inválida

- Certifique-se de que a API Key tem permissão `MetricsPublisher` ou `Admin`
- Gere uma nova key se necessário

### Região errada

- A URL do Loki varia por região (us-central1, eu-west-0, etc)
- Confirme a região correta no seu stack do Grafana Cloud

---

## 📚 Recursos adicionais

- [Grafana Cloud Docs](https://grafana.com/docs/grafana-cloud/)
- [Loki LogQL Syntax](https://grafana.com/docs/loki/latest/logql/)
- [pino-loki GitHub](https://github.com/Julien-R44/pino-loki)

---

**Pronto!** Agora você tem observabilidade completa dos logs do backend no Grafana Cloud sem precisar gerenciar infraestrutura. 🎉
