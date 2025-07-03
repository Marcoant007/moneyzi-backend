# 💸 Moneyzi Backend

Backend da aplicação Finance (antigo MoneyEasy), focado em performance e escalabilidade usando:

- ⚡ **Fastify** – Servidor HTTP leve e rápido
- 🐇 **RabbitMQ** – Processamento assíncrono de importação via fila
- 🧠 **OpenAI (futuro)** – Categorização inteligente das transações
- 🚀 **Redis** – Cache de leitura com padrão cache-aside
- 🐘 **PostgreSQL** – Persistência dos dados financeiros

---

## 📦 Tecnologias

| Tecnologia | Uso                             |
| ---------- | ------------------------------- |
| Fastify    | API HTTP                        |
| RabbitMQ   | Fila para importação assíncrona |
| Redis      | Cache para consultas rápidas    |
| PostgreSQL | Banco relacional principal      |
| Prisma ORM | ORM com suporte a TS            |
| Zod        | Validação de entrada            |
| csv-parse  | Leitura de arquivos CSV         |
| TypeScript | Tipagem estática                |

---

## 🧱 Arquitetura

Este projeto segue o padrão **Event-Driven Architecture (EDA)** com processamento assíncrono via RabbitMQ, usando:

- **Publicador e consumidor no mesmo processo** (sem workers separados)
- **Padrão Cache-Aside** com Redis
- Design modular com aliases (`@infra`, `@routes`, etc.)

---

## 🚀 Como rodar o projeto

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/moneyzi-backend.git
cd moneyzi-backend
```
