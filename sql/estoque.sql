-- Módulo de estoque (só a Administração)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
-- Não depende do sql/topos.sql (os dois podem ser rodados em qualquer ordem).
--
-- 1. Itens de estoque (ingredientes, embalagens, bebidas...): quantidade atual e estoque mínimo.
-- 2. Movimentos: entrada (compra), saída (uso, perda), contagem (acerta o número) e baixa pelos pedidos.
-- 3. Baixa automática: um item pode ser ligado a produtos do cardápio ("a Coca-Cola 2 L gasta 1 garrafa",
--    "o Kit Individual gasta 1 suco", "cada kg de bolo gasta 0,5 lata"). Quando o pedido é confirmado,
--    sai do estoque; se for cancelado (ou voltar para "Recebido", ou for excluído), volta.
--    Mudar itens de um pedido já confirmado acerta a diferença. Vale para pedidos confirmados depois disto.
-- 4. Aviso no sino do backoffice quando o item chega no estoque mínimo ("acabando") ou em zero ("acabou").
--    O aviso some sozinho quando o item é reposto acima do mínimo.
-- Nada disso atrapalha os pedidos: se algo der errado no estoque, o pedido segue normalmente.

create or replace function eh_admin_loja()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo and a.papel = 'admin')
$$;
revoke all on function eh_admin_loja() from public;
grant execute on function eh_admin_loja() to authenticated;

-- ---------------------------------------------------------------- tabelas
create table if not exists estoque_itens (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  categoria     text,
  unidade       text not null default 'unidade',     -- unidade, caixa, pacote, lata, garrafa, saco, rolo, dúzia, kg, g, L, ml
  quantidade    numeric(12, 3) not null default 0,
  minimo        numeric(12, 3) not null default 0 check (minimo >= 0),
  observacao    text,
  ativo         boolean not null default true,        -- desligado: sem avisos
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists estoque_consumos (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references estoque_itens(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  quantidade numeric(12, 3) not null check (quantidade > 0),   -- quanto do item cada unidade vendida gasta
  por_kg     boolean not null default false,                    -- bolo vendido por peso: quanto gasta por kg
  unique (item_id, produto_id)
);
create index if not exists estoque_consumos_produto_idx on estoque_consumos (produto_id);

create table if not exists estoque_movimentos (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references estoque_itens(id) on delete cascade,
  tipo        text not null check (tipo in ('entrada', 'saida', 'ajuste', 'pedido')),
  quantidade  numeric(12, 3) not null,                 -- quanto mudou: + entrou, − saiu
  saldo       numeric(12, 3),                          -- como ficou depois
  motivo      text,
  pedido_id   uuid references pedidos(id) on delete set null,
  autor_id    uuid,
  autor_nome  text,
  criado_em   timestamptz not null default now()
);
create index if not exists estoque_movimentos_item_idx on estoque_movimentos (item_id, criado_em desc);
create index if not exists estoque_movimentos_pedido_idx on estoque_movimentos (pedido_id) where pedido_id is not null;

alter table estoque_itens enable row level security;
alter table estoque_consumos enable row level security;
alter table estoque_movimentos enable row level security;
drop policy if exists estoque_itens_admin on estoque_itens;
drop policy if exists estoque_consumos_admin on estoque_consumos;
drop policy if exists estoque_movimentos_ler on estoque_movimentos;
create policy estoque_itens_admin on estoque_itens for all to authenticated using (eh_admin_loja()) with check (eh_admin_loja());
create policy estoque_consumos_admin on estoque_consumos for all to authenticated using (eh_admin_loja()) with check (eh_admin_loja());
create policy estoque_movimentos_ler on estoque_movimentos for select to authenticated using (eh_admin_loja());
-- movimentos: só pelas funções abaixo

create or replace function estoque_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists estoque_atualizado_em on estoque_itens;
create trigger estoque_atualizado_em before update on estoque_itens for each row execute function estoque_atualizado_em();

-- ---------------------------------------------------------------- movimentar
-- "3 latas", "1,5 kg", "1 garrafa"
create or replace function estoque_qtd(q numeric, u text)
returns text language sql immutable as $$
  select replace(case when q = trunc(q) then trunc(q)::text else rtrim(q::text, '0') end, '.', ',') || ' ' ||
         case when u in ('kg', 'g', 'L', 'ml') then u else u || case when abs(q) = 1 then '' else 's' end end
$$;

-- uso interno (gatilhos e movimentar_estoque): muda a quantidade e registra o movimento
create or replace function estoque_aplicar(p_item_id uuid, p_delta numeric, p_tipo text, p_motivo text, p_pedido_id uuid default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_saldo numeric;
  v_nome  text;
begin
  update estoque_itens set quantidade = quantidade + p_delta where id = p_item_id returning quantidade into v_saldo;
  if not found then
    return null;
  end if;
  select a.nome into v_nome from administradores a where a.user_id = auth.uid();
  insert into estoque_movimentos (item_id, tipo, quantidade, saldo, motivo, pedido_id, autor_id, autor_nome)
  values (p_item_id, p_tipo, p_delta, v_saldo, p_motivo, p_pedido_id, auth.uid(), v_nome);
  return v_saldo;
end;
$$;
revoke all on function estoque_aplicar(uuid, numeric, text, text, uuid) from public, anon, authenticated;

-- entrada, saída ou contagem (ajuste: a quantidade passa a ser exatamente o número informado)
create or replace function movimentar_estoque(p_item_id uuid, p_tipo text, p_quantidade numeric, p_motivo text default null)
returns estoque_itens
language plpgsql security definer set search_path = public as $$
declare
  v_atual numeric;
  v_delta numeric;
  v_item  estoque_itens;
begin
  if not eh_admin_loja() then
    raise exception 'Só a Administração mexe no estoque.' using errcode = '42501';
  end if;
  if p_quantidade is null or p_quantidade < 0 then
    raise exception 'Informe uma quantidade válida.';
  end if;
  if p_tipo in ('entrada', 'saida') and p_quantidade = 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;
  select quantidade into v_atual from estoque_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item de estoque não encontrado.';
  end if;
  v_delta := case p_tipo when 'entrada' then p_quantidade when 'saida' then -p_quantidade when 'ajuste' then p_quantidade - v_atual end;
  if v_delta is null then
    raise exception 'Tipo de movimento inválido.';
  end if;
  perform estoque_aplicar(p_item_id, v_delta, p_tipo, nullif(trim(p_motivo), ''));
  select * into v_item from estoque_itens where id = p_item_id;
  return v_item;
end;
$$;
revoke all on function movimentar_estoque(uuid, text, numeric, text) from public, anon;
grant execute on function movimentar_estoque(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------- baixa pelos pedidos
create or replace function estoque_consome(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, 'recebido') not in ('recebido', 'cancelado')
$$;

-- deixa o estoque igual ao que o pedido gasta agora (confirmado em diante) ou devolve tudo (consumir = false)
create or replace function estoque_sincronizar_pedido(p_pedido_id uuid, p_consumir boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_codigo text;
begin
  select coalesce(to_jsonb(p) ->> 'codigo', '') into v_codigo from pedidos p where p.id = p_pedido_id;
  for r in
    with desejado as (
      select c.item_id, sum(c.quantidade * i.quantidade * case when c.por_kg and i.peso_kg is not null then i.peso_kg else 1 end) as q
        from pedido_itens i
        join estoque_consumos c on c.produto_id = i.produto_id
       where i.pedido_id = p_pedido_id and p_consumir
       group by c.item_id
    ), aplicado as (
      select m.item_id, -sum(m.quantidade) as q
        from estoque_movimentos m
       where m.pedido_id = p_pedido_id and m.tipo = 'pedido'
       group by m.item_id
    )
    select coalesce(d.item_id, a.item_id) as item_id, coalesce(d.q, 0) - coalesce(a.q, 0) as falta
      from desejado d full join aplicado a on a.item_id = d.item_id
  loop
    if r.falta <> 0 then
      perform estoque_aplicar(r.item_id, -r.falta, 'pedido',
        trim(case when r.falta > 0 then 'Pedido ' else 'Devolvido do pedido ' end || coalesce(v_codigo, '')), p_pedido_id);
    end if;
  end loop;
end;
$$;
revoke all on function estoque_sincronizar_pedido(uuid, boolean) from public, anon, authenticated;

create or replace function estoque_pedido_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'DELETE' then
      perform estoque_sincronizar_pedido(old.id, false);
    elsif estoque_consome(old.status) is distinct from estoque_consome(new.status) then
      perform estoque_sincronizar_pedido(new.id, estoque_consome(new.status));
    end if;
  exception when others then
    raise warning 'estoque (pedido %): %', coalesce(new.id, old.id), sqlerrm;   -- o pedido segue normalmente
  end;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return null;
end;
$$;
drop trigger if exists estoque_pedido_status on pedidos;
create trigger estoque_pedido_status after update of status on pedidos
  for each row execute function estoque_pedido_status();
drop trigger if exists estoque_pedido_excluido on pedidos;
create trigger estoque_pedido_excluido before delete on pedidos
  for each row execute function estoque_pedido_status();

create or replace function estoque_pedido_itens()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pedido uuid := coalesce(new.pedido_id, old.pedido_id);
  v_status text;
begin
  begin
    select p.status into v_status from pedidos p where p.id = v_pedido;
    if found then
      perform estoque_sincronizar_pedido(v_pedido, estoque_consome(v_status));
    end if;
  exception when others then
    raise warning 'estoque (itens do pedido %): %', v_pedido, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists estoque_pedido_itens on pedido_itens;
create trigger estoque_pedido_itens after insert or update or delete on pedido_itens
  for each row execute function estoque_pedido_itens();

-- ---------------------------------------------------------------- avisos (sino do backoffice)
create table if not exists notificacoes (
  id        bigint generated always as identity primary key,
  tipo      text not null,                          -- topo_pronto, estoque_baixo, estoque_acabou
  titulo    text not null,
  texto     text,
  pedido_id uuid references pedidos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  lida_em   timestamptz                             -- visto por alguém da equipe: sai da lista de novos para todos
);
alter table notificacoes add column if not exists estoque_item_id uuid references estoque_itens(id) on delete cascade;
create index if not exists notificacoes_novas_idx on notificacoes (criado_em desc) where lida_em is null;

alter table notificacoes enable row level security;
drop policy if exists notificacoes_ler on notificacoes;
drop policy if exists notificacoes_marcar on notificacoes;
-- a equipe da loja vê os avisos; os de estoque, só a Administração (igual em sql/topos.sql)
create policy notificacoes_ler on notificacoes for select to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo)
         and (tipo not like 'estoque%' or eh_admin_loja()));
create policy notificacoes_marcar on notificacoes for update to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo)
         and (tipo not like 'estoque%' or eh_admin_loja()))
  with check (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo)
         and (tipo not like 'estoque%' or eh_admin_loja()));

create or replace function estoque_avisar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_acabou   boolean := new.quantidade <= 0 and old.quantidade > 0;
  v_acabando boolean := new.quantidade > 0 and new.quantidade <= new.minimo and old.quantidade > old.minimo;
begin
  if not new.ativo then
    return null;
  end if;
  -- reposto acima do mínimo: o aviso aberto some; e só fica o aviso mais novo de cada item
  if new.quantidade > new.minimo or v_acabou or v_acabando then
    update notificacoes set lida_em = now() where estoque_item_id = new.id and lida_em is null;
  end if;
  if v_acabou or v_acabando then
    insert into notificacoes (tipo, titulo, texto, estoque_item_id)
    values (case when v_acabou then 'estoque_acabou' else 'estoque_baixo' end,
            case when v_acabou then 'Estoque acabou' else 'Estoque acabando' end,
            case when v_acabou
                 then new.nome || ' acabou' || case when new.quantidade < 0 then ' (faltam ' || estoque_qtd(-new.quantidade, new.unidade) || ' para os pedidos)' else '' end || '.'
                 else new.nome || ': restam ' || estoque_qtd(new.quantidade, new.unidade) || ' (mínimo ' || estoque_qtd(new.minimo, new.unidade) || ').'
            end,
            new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists estoque_avisar on estoque_itens;
create trigger estoque_avisar after update of quantidade, minimo, ativo on estoque_itens
  for each row execute function estoque_avisar();

-- ---------------------------------------------------------------- tempo real
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes') then
    alter publication supabase_realtime add table notificacoes;
  end if;
end $$;
