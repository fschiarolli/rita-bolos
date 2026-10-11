-- Peso final do bolo e excesso de peso (prejuízo)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- 1. Peso final (pedido_itens.peso_final_kg): o peso do bolo pronto, na balança. Num item com mais de um bolo
--    (ex.: 2 bolos de 1 kg), é o peso de todos juntos.
-- 2. Tolerância: a de Ajustes > Loja ("Tolerância de peso do bolo"), a mesma que o site mostra ao cliente
--    ("O peso final pode passar até 300 g"). Vale para cada bolo.
-- 3. Passou do peso pedido + tolerância: o que passou vira prejuízo (excessos_peso), na seção "Excesso de peso"
--    dos Prejuízos. Ex.: pediu 1 kg, tolerância de 300 g: até 1,3 kg não há prejuízo; pesou 2 kg = 700 g de
--    prejuízo, no valor de 0,7 kg × o preço do kg daquele bolo.
-- 4. Mudou o peso final (ou o peso, a quantidade ou o preço do item): o lançamento é refeito, com a tolerância
--    daquele momento. Apagou o peso final ou ficou dentro da tolerância: o lançamento sai.
-- 5. O histórico fica mesmo se o pedido for apagado. A equipe vê; apagar um lançamento: só a Administração.

do $$
declare
  v_falta text;
begin
  select string_agg(c, ', ') into v_falta
    from unnest(array['pedido_id', 'nome', 'quantidade', 'peso_kg', 'preco_kg', 'preco_unitario']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'pedido_itens' and column_name = c);
  if v_falta is not null then
    raise exception 'A tabela pedido_itens não tem: %. Nada foi alterado.', v_falta;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'configuracoes' and column_name = 'tolerancia_peso_bolo_g') then
    raise exception 'As configurações não têm a tolerância de peso do bolo (tolerancia_peso_bolo_g). Nada foi alterado.';
  end if;
end $$;

-- ---------------------------------------------------------------- peso final do bolo
alter table pedido_itens add column if not exists peso_final_kg numeric(7, 3) check (peso_final_kg > 0);

-- ---------------------------------------------------------------- excesso de peso (prejuízo)
create table if not exists excessos_peso (
  id             uuid primary key default gen_random_uuid(),
  pedido_item_id text not null unique,                   -- o item do bolo: um lançamento por item
  pedido_id      uuid references pedidos(id) on delete set null,
  pedido_codigo  text,                                   -- cópias: o histórico continua se o pedido for apagado
  cliente_nome   text,
  item_nome      text not null,
  quantidade     integer not null default 1,             -- bolos no item
  peso_pedido_kg numeric(7, 3) not null,                 -- de cada bolo
  tolerancia_g   integer not null default 0,             -- de cada bolo, como estava na hora
  peso_final_kg  numeric(7, 3) not null,                 -- na balança (todos os bolos do item)
  excesso_kg     numeric(7, 3) not null check (excesso_kg > 0),
  preco_kg       numeric(10, 2) not null default 0,
  valor          numeric(10, 2) not null default 0,      -- excesso × preço do kg
  data           date not null,                          -- dia da retirada (ou da entrega)
  registrado_por uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists excessos_peso_data_idx on excessos_peso (data desc);
create index if not exists excessos_peso_pedido_idx on excessos_peso (pedido_id);

alter table excessos_peso enable row level security;
drop policy if exists excessos_peso_ler on excessos_peso;
drop policy if exists excessos_peso_apagar on excessos_peso;
-- ver: a equipe; apagar (ex.: pesagem errada num pedido que já sumiu): a Administração.
-- Criar e mudar: só pelo gatilho do peso final (abaixo).
create policy excessos_peso_ler on excessos_peso for select to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));
create policy excessos_peso_apagar on excessos_peso for delete to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo and a.papel = 'admin'));

-- O peso final (ou o peso pedido, a quantidade, o preço) mudou: refaz o lançamento do excesso daquele bolo.
create or replace function pedido_itens_peso_final()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ped     record;
  v_tol     integer;
  v_qtd     integer;
  v_excesso numeric;
  v_preco   numeric;
begin
  if tg_op = 'UPDATE'
     and new.peso_final_kg is not distinct from old.peso_final_kg and new.peso_kg is not distinct from old.peso_kg
     and new.quantidade is not distinct from old.quantidade and new.preco_kg is not distinct from old.preco_kg
     and new.preco_unitario is not distinct from old.preco_unitario and new.nome is not distinct from old.nome then
    return new;   -- nada que mude o excesso
  end if;
  if new.peso_final_kg is null or coalesce(new.peso_kg, 0) <= 0 then
    delete from excessos_peso where pedido_item_id = new.id::text;
    return new;
  end if;
  select coalesce(c.tolerancia_peso_bolo_g, 0) into v_tol from configuracoes c order by c.id limit 1;
  v_qtd := greatest(coalesce(new.quantidade, 1), 1);
  -- cada bolo pode passar até a tolerância: pediu 1 kg, tolerância de 300 g = até 1,3 kg
  v_excesso := round(new.peso_final_kg - v_qtd * (new.peso_kg + coalesce(v_tol, 0) / 1000.0), 3);
  if v_excesso <= 0 then
    delete from excessos_peso where pedido_item_id = new.id::text;
    return new;
  end if;
  v_preco := coalesce(nullif(new.preco_kg, 0), new.preco_unitario / nullif(new.peso_kg, 0), 0);
  select p.codigo, p.cliente_nome, p.data_retirada into v_ped from pedidos p where p.id = new.pedido_id;
  insert into excessos_peso (pedido_item_id, pedido_id, pedido_codigo, cliente_nome, item_nome, quantidade, peso_pedido_kg,
                             tolerancia_g, peso_final_kg, excesso_kg, preco_kg, valor, data)
  values (new.id::text, new.pedido_id, v_ped.codigo, v_ped.cliente_nome, new.nome, v_qtd, new.peso_kg,
          coalesce(v_tol, 0), new.peso_final_kg, v_excesso, round(v_preco, 2), round(v_excesso * v_preco, 2),
          coalesce(v_ped.data_retirada, (now() at time zone 'America/Sao_Paulo')::date))
  on conflict (pedido_item_id) do update set
    pedido_id = excluded.pedido_id, pedido_codigo = excluded.pedido_codigo, cliente_nome = excluded.cliente_nome,
    item_nome = excluded.item_nome, quantidade = excluded.quantidade, peso_pedido_kg = excluded.peso_pedido_kg,
    tolerancia_g = excluded.tolerancia_g, peso_final_kg = excluded.peso_final_kg, excesso_kg = excluded.excesso_kg,
    preco_kg = excluded.preco_kg, valor = excluded.valor, data = excluded.data,
    registrado_por = auth.uid(), atualizado_em = now();
  return new;
end $$;
drop trigger if exists pedido_itens_peso_final on pedido_itens;
create trigger pedido_itens_peso_final after insert or update on pedido_itens
  for each row execute function pedido_itens_peso_final();

-- Estoque (sql/estoque.sql): o gatilho dos itens passa a olhar só o que o estoque usa (produto, quantidade, peso).
-- Assim, gravar o peso final não mexe no estoque (nem dá baixa atrasada num pedido confirmado antes do estoque existir).
do $$
begin
  if to_regprocedure('estoque_pedido_itens()') is not null then
    drop trigger if exists estoque_pedido_itens on pedido_itens;
    create trigger estoque_pedido_itens after insert or delete or update of pedido_id, produto_id, quantidade, peso_kg on pedido_itens
      for each row execute function estoque_pedido_itens();
  end if;
end $$;

-- O pedido mudou de dia (ou de cliente): o lançamento acompanha
create or replace function pedidos_excesso_peso_dados()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update excessos_peso set data = coalesce(new.data_retirada, data), cliente_nome = new.cliente_nome, pedido_codigo = new.codigo
   where pedido_id = new.id;
  return new;
end $$;
drop trigger if exists pedidos_excesso_peso_dados on pedidos;
create trigger pedidos_excesso_peso_dados after update of data_retirada, cliente_nome on pedidos
  for each row when (new.data_retirada is distinct from old.data_retirada or new.cliente_nome is distinct from old.cliente_nome)
  execute function pedidos_excesso_peso_dados();

-- Conferir:
-- select data, pedido_codigo, item_nome, peso_pedido_kg, tolerancia_g, peso_final_kg, excesso_kg, valor
--   from excessos_peso order by data desc;
