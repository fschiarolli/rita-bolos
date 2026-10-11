-- Entregas: pedido com entrega (endereço, quem recebe e taxa) e os status "Saiu para entrega" e "Entregue"
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- 1. Taxa de entrega (pedidos.taxa_entrega): entra no total e no "falta receber". O sinal continua sendo
--    calculado só sobre os produtos: incluir a entrega depois não deixa um sinal já pago "faltando".
--    Pedidos sem entrega não mudam em nada.
-- 2. Endereço e quem recebe (pedido_entregas): um por pedido, com a taxa cobrada e a distância de carro
--    (quando a taxa foi calculada). Só a equipe vê e muda. Apagar a entrega tira a taxa do total.
-- 3. Status novos, logo depois de "Pronto": "Saiu para entrega" (em_rota) e "Entregue" (entregue, encerra o
--    pedido). Os status seguintes descem duas posições. Pedidos para retirar seguem como antes (Pronto > Retirado).
--    Se você já tinha criado um status parecido em Ajustes > Status, desligue o antigo ("Em uso").
-- 4. Regra da taxa (Ajustes > Loja > Entrega): endereço de onde sai a entrega, taxa mínima, quantos km ela
--    cobre, valor de cada km a mais e até onde entrega. O backoffice calcula a distância de carro pelo
--    OpenStreetMap e sugere a taxa; a equipe pode digitar outro valor.
-- 5. Recibo do cliente (o link que vai no WhatsApp): mostra a entrega e a taxa (função entrega_publica).

do $$
declare
  v_falta text;
begin
  select string_agg(c, ', ') into v_falta
    from unnest(array['subtotal', 'desconto', 'total', 'percentual_sinal', 'valor_sinal']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'pedidos' and column_name = c);
  if v_falta is not null then
    raise exception 'A tabela pedidos não tem: %. Nada foi alterado.', v_falta;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'pedidos'
                and column_name in ('total', 'valor_sinal') and is_generated = 'ALWAYS') then
    raise exception 'O total dos pedidos é uma coluna calculada (generated): este script precisa de ajuste. Nada foi alterado.';
  end if;
end $$;

-- ---------------------------------------------------------------- taxa no pedido
alter table pedidos add column if not exists taxa_entrega numeric(10, 2) not null default 0;
alter table pedidos drop constraint if exists pedidos_taxa_entrega_ck;
alter table pedidos add constraint pedidos_taxa_entrega_ck check (taxa_entrega >= 0);

-- Total com a entrega. Roda por último entre os gatilhos "antes" do pedido (nome começando por zzz_): o cálculo
-- do banco (itens, desconto, sinal) acontece antes, e aqui a taxa é somada ao que vem dos produtos.
-- Sem entrega (taxa zero antes e depois), não mexe em nada.
create or replace function pedidos_somar_entrega()
returns trigger language plpgsql as $$
declare
  v_produtos numeric;
begin
  if coalesce(new.taxa_entrega, 0) = 0 and (tg_op = 'INSERT' or coalesce(old.taxa_entrega, 0) = 0) then
    return new;
  end if;
  v_produtos := greatest(coalesce(new.subtotal, 0) - coalesce(new.desconto, 0), 0);
  new.total := v_produtos + coalesce(new.taxa_entrega, 0);
  new.valor_sinal := round(v_produtos * coalesce(new.percentual_sinal, 0) / 100, 2);   -- o sinal é só dos produtos
  return new;
end $$;
drop trigger if exists zzz_pedidos_somar_entrega on pedidos;
create trigger zzz_pedidos_somar_entrega before insert or update on pedidos
  for each row execute function pedidos_somar_entrega();

-- ---------------------------------------------------------------- endereço e quem recebe
create table if not exists pedido_entregas (
  pedido_id          uuid primary key references pedidos(id) on delete cascade,
  taxa               numeric(10, 2) not null default 0 check (taxa >= 0),   -- cobrada do cliente (vai para o total)
  cep                text,                                                  -- só os números
  endereco           text not null check (btrim(endereco) <> ''),          -- rua e número
  complemento        text,                                                  -- apartamento, bloco, ponto de referência
  bairro             text,
  cidade             text,
  recebedor_nome     text,                                                  -- quem recebe (em branco: o próprio cliente)
  recebedor_telefone text,
  distancia_km       numeric(7, 2),                                         -- de carro, saindo da loja (quando calculada)
  duracao_min        integer,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

alter table pedido_entregas enable row level security;
drop policy if exists pedido_entregas_equipe on pedido_entregas;
-- endereço e telefone de quem recebe: só a equipe da loja (quem faz os topos não vê)
create policy pedido_entregas_equipe on pedido_entregas for all to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo))
  with check (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));

create or replace function pedido_entregas_antes()
returns trigger language plpgsql as $$
begin
  new.endereco := btrim(new.endereco);
  new.cep := nullif(regexp_replace(coalesce(new.cep, ''), '\D', '', 'g'), '');
  new.complemento := nullif(btrim(coalesce(new.complemento, '')), '');
  new.bairro := nullif(btrim(coalesce(new.bairro, '')), '');
  new.cidade := nullif(btrim(coalesce(new.cidade, '')), '');
  new.recebedor_nome := nullif(btrim(coalesce(new.recebedor_nome, '')), '');
  new.recebedor_telefone := nullif(btrim(coalesce(new.recebedor_telefone, '')), '');
  new.taxa := coalesce(new.taxa, 0);
  if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  return new;
end $$;
drop trigger if exists pedido_entregas_antes on pedido_entregas;
create trigger pedido_entregas_antes before insert or update on pedido_entregas
  for each row execute function pedido_entregas_antes();

-- A taxa vai para o pedido (e o gatilho do pedido refaz o total). Mudar só o endereço também "mexe" no pedido:
-- assim o backoffice e o quadro, que acompanham os pedidos em tempo real, se atualizam.
create or replace function pedido_entregas_taxa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update pedidos set taxa_entrega = 0 where id = old.pedido_id;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.pedido_id <> old.pedido_id then
    update pedidos set taxa_entrega = 0 where id = old.pedido_id;
  end if;
  update pedidos set taxa_entrega = new.taxa where id = new.pedido_id;
  return new;
end $$;
drop trigger if exists pedido_entregas_taxa on pedido_entregas;
create trigger pedido_entregas_taxa after insert or update or delete on pedido_entregas
  for each row execute function pedido_entregas_taxa();

-- ---------------------------------------------------------------- recibo do cliente
-- Entrega do pedido para o recibo aberto pelo link do WhatsApp (token): endereço e taxa, sem telefone.
create or replace function entrega_publica(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v json;
begin
  if coalesce(btrim(p_token), '') = '' then return null; end if;
  select json_build_object('taxa', e.taxa, 'cep', e.cep, 'endereco', e.endereco, 'complemento', e.complemento,
                           'bairro', e.bairro, 'cidade', e.cidade, 'recebedor_nome', e.recebedor_nome)
    into v
    from pedidos p join pedido_entregas e on e.pedido_id = p.id
   where p.token::text = btrim(p_token)
   limit 1;
  return v;
end $$;
revoke all on function entrega_publica(text) from public;
grant execute on function entrega_publica(text) to anon, authenticated;

-- ---------------------------------------------------------------- status
do $$
declare
  v_pronto integer;
begin
  if exists (select 1 from status_pedido where codigo = 'em_rota')
     and exists (select 1 from status_pedido where codigo = 'entregue') then
    return;   -- já foi rodado
  end if;
  select ordem into v_pronto from status_pedido where codigo = 'pronto';
  if v_pronto is null then
    select coalesce(max(ordem), 0) into v_pronto from status_pedido where not finalizado;
  end if;
  -- duas posições logo depois de "Pronto"
  update status_pedido set ordem = ordem + 2 where ordem > v_pronto and codigo not in ('em_rota', 'entregue');
  insert into status_pedido (codigo, nome, descricao, cor, ordem, finalizado, ativo)
  select 'em_rota', 'Saiu para entrega', 'A caminho do endereço de entrega.', '#3F7CAC', v_pronto + 1, false, true
   where not exists (select 1 from status_pedido where codigo = 'em_rota');
  insert into status_pedido (codigo, nome, descricao, cor, ordem, finalizado, ativo)
  select 'entregue', 'Entregue', 'Entregue no endereço do cliente.', '#3B4A6B', v_pronto + 2, true, true
   where not exists (select 1 from status_pedido where codigo = 'entregue');
end $$;

-- ---------------------------------------------------------------- regra da taxa (Ajustes > Loja > Entrega)
alter table configuracoes add column if not exists entrega_origem text;                  -- endereço de onde sai a entrega
alter table configuracoes add column if not exists entrega_origem_lat double precision;  -- achados pelo backoffice ao salvar
alter table configuracoes add column if not exists entrega_origem_lng double precision;
alter table configuracoes add column if not exists entrega_taxa_minima numeric(10, 2) not null default 0;
alter table configuracoes add column if not exists entrega_km_incluidos numeric(6, 2) not null default 0;   -- km que a taxa mínima cobre
alter table configuracoes add column if not exists entrega_valor_km numeric(10, 2) not null default 0;      -- cada km a mais
alter table configuracoes add column if not exists entrega_raio_km numeric(6, 2);                            -- até onde entrega (vazio: sem limite)
alter table configuracoes drop constraint if exists configuracoes_entrega_ck;
alter table configuracoes add constraint configuracoes_entrega_ck check (
  entrega_taxa_minima >= 0 and entrega_km_incluidos >= 0 and entrega_valor_km >= 0
  and (entrega_raio_km is null or entrega_raio_km > 0));

-- Conferir:
-- select codigo, nome, ordem, finalizado, ativo from status_pedido order by ordem;
-- select p.codigo, p.subtotal, p.desconto, p.taxa_entrega, p.total, p.valor_sinal, e.endereco
--   from pedidos p join pedido_entregas e on e.pedido_id = p.id order by p.criado_em desc;
