-- Prejuízos: itens que precisaram ser refeitos ou foram perdidos
-- (ex.: bolo de ninho entregue como chocolate -> outro bolo feito -> prejuízo).
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.

create table if not exists prejuizos (
  id             uuid primary key default gen_random_uuid(),
  pedido_id      uuid references pedidos(id) on delete set null,
  pedido_codigo  text,                         -- cópia, para o histórico sobreviver se o pedido for apagado
  cliente_nome   text,
  produto_id     uuid references produtos(id) on delete set null,
  item_nome      text not null,
  quantidade     integer not null default 1 check (quantidade >= 1),
  valor_unitario numeric(10, 2) not null default 0 check (valor_unitario >= 0),
  motivo         text not null default 'outro',  -- sabor_errado, item_errado, danificado, qualidade, atraso, outro
  descricao      text,
  data           date not null default (now() at time zone 'America/Sao_Paulo')::date,
  registrado_por uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);
create index if not exists prejuizos_data_idx on prejuizos (data desc);
create index if not exists prejuizos_pedido_idx on prejuizos (pedido_id);

-- Só a equipe ativa (tabela administradores) lê e escreve
alter table prejuizos enable row level security;
drop policy if exists prejuizos_equipe on prejuizos;
create policy prejuizos_equipe on prejuizos for all
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo))
  with check (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));
